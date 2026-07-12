// §B — Supabase auth, owned entirely by the main process. The renderer is sandboxed and only ever
// sees a serializable `AuthState` + an access token over IPC; all Supabase/PKCE/token work lives here
// because the two things it needs — the `cubic://` deep link and the OS keychain (safeStorage) — are
// both main-process-only. Mirrors BackendSupervisor's EventEmitter shape: every state change emits
// `change`, which ipc.ts broadcasts to the renderer.
//
// Flow (PKCE, system browser): signIn() → signInWithOAuth (we open the URL ourselves) → the browser
// returns to `cubic://auth/callback?code=…` → handleCallback() exchanges the code for a session →
// persist (safeStorage) + schedule a refresh. We drive token refresh ourselves (autoRefreshToken is
// off — supabase-js's timer doesn't tick reliably in a headless main).

import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage, shell } from 'electron'
import { createClient, isAuthRetryableFetchError, type Session, type SupabaseClient } from '@supabase/supabase-js'
import type { BackendConfig } from './config.js'
import type { AuthProvider, AuthState, AuthStatus, AuthUser, BillingActionResult } from '../shared/ipc.js'

// The deep link the OAuth flow returns to. Must match the redirect allow-list in the Supabase
// dashboard (and the scheme registered via setAsDefaultProtocolClient in index.ts).
export const AUTH_REDIRECT = 'cubic://auth/callback'
// Refresh this far before expiry (and treat a token within this window as "needs refresh on demand").
// 10 min (not 60s) so a token handed to a chat turn always has ≥10 min of life — longer than any
// realistic multi-step turn — closing the mid-turn-expiry hole (#4A). Tunable.
const REFRESH_SKEW_MS = 600_000
// After a TRANSIENT refresh failure (offline / server blip) we keep the session and retry this often,
// rather than deleting it — a bounded fixed interval, NOT scheduleRefresh's expiry-based timing (which
// would hot-loop once the token is already expired + offline). Recovers automatically on reconnect (#12).
const REFRESH_RETRY_MS = 60_000

/** Derive the renderer-facing user from a Supabase session (name/avatar come from the OAuth provider's
 *  `user_metadata`, which varies by provider — fall back across the common keys). */
function toUser(session: Session): AuthUser {
  const u = session.user
  const m = (u.user_metadata ?? {}) as Record<string, unknown>
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
  return {
    id: u.id,
    email: u.email ?? str(m.email) ?? '',
    name: str(m.full_name) ?? str(m.name),
    avatarUrl: str(m.avatar_url) ?? str(m.picture),
  }
}

/** Turn a raw OAuth error into something a non-technical user can read. */
function friendlyAuthError(raw: string): string {
  if (/access_denied|denied|cancel/i.test(raw)) return 'Sign-in was cancelled.'
  return "Couldn't sign in. Please try again."
}

/** Is a refresh failure DEFINITIVE (the refresh token is genuinely revoked/invalid) vs transient
 *  (offline / DNS / timeout / 5xx / rate-limit)? Only a definitive failure should drop the persisted
 *  session; everything else must be kept and retried, or launching offline wipes the login (#12).
 *  A revoked token comes back as an AuthApiError (HTTP 400, invalid_grant / refresh_token_not_found);
 *  a gone session as AuthSessionMissingError. Network/5xx are AuthRetryableFetchError → never definitive. */
function isDefinitiveInvalidGrant(error: unknown): boolean {
  if (!error || typeof error !== 'object' || isAuthRetryableFetchError(error)) return false
  const e = error as { name?: string; status?: number; code?: string; message?: string }
  if (e.name === 'AuthSessionMissingError') return true
  const text = `${e.code ?? ''} ${e.message ?? ''}`
  return e.status === 400 && /invalid.?grant|invalid.?refresh|refresh_token_not_found/i.test(text)
}

/** Simple in-memory storage for supabase-js. With persistSession off + a headless main there is no
 *  localStorage, and — critically — the PKCE *code verifier* created during signInWithOAuth must
 *  survive until the cubic:// callback fires so exchangeCodeForSession can read it back. The main
 *  process stays alive across the browser round-trip, so an in-memory Map is sufficient. */
function memoryStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  const store = new Map<string, string>()
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  }
}

export class AuthManager extends EventEmitter {
  private readonly client: SupabaseClient | null
  private readonly supabaseUrl: string
  private readonly anonKey: string
  private session: Session | null = null
  private status: AuthStatus = 'loading'
  private errorMsg: string | undefined
  private refreshTimer: NodeJS.Timeout | null = null

  constructor(config: BackendConfig) {
    super()
    this.supabaseUrl = config.supabaseUrl
    this.anonKey = config.supabaseAnonKey
    // No Supabase configured (e.g. a local-dev machine without SUPABASE_URL) → auth is simply
    // unavailable: the app stays usable signed-out, signIn() reports a friendly error, no throw.
    this.client = config.supabaseUrl && config.supabaseAnonKey
      ? createClient(config.supabaseUrl, config.supabaseAnonKey, {
          auth: {
            flowType: 'pkce',
            persistSession: false, // we own persistence (safeStorage), not localStorage
            autoRefreshToken: false, // we drive refresh ourselves (see scheduleRefresh)
            detectSessionInUrl: false, // there is no browser URL in the main process
            storage: memoryStorage(),
          },
        })
      : null
  }

  /** Current auth state — the snapshot returned over IPC and the payload of every `change` event. */
  get state(): AuthState {
    return {
      status: this.status,
      user: this.session ? toUser(this.session) : null,
      ...(this.errorMsg ? { error: this.errorMsg } : {}),
    }
  }

  /** Restore a persisted session on launch (refresh it if stale), then report the resolved state. Until
   *  this runs the status is 'loading', so the renderer holds the gate instead of flashing sign-in. */
  async init(): Promise<void> {
    if (!this.client) return this.setStatus('signedOut')
    const restored = this.loadPersisted()
    if (!restored) return this.setStatus('signedOut')
    this.session = restored
    const expSoon = !restored.expires_at || restored.expires_at * 1000 - Date.now() < REFRESH_SKEW_MS
    if (expSoon) {
      await this.refresh() // refreshes (or signs out on failure) and emits
    } else {
      this.status = 'signedIn'
      this.errorMsg = undefined
      this.scheduleRefresh()
      this.emitChange()
    }
  }

  /** Begin the OAuth flow: get the provider authorize URL and open it in the system browser. The flow
   *  completes asynchronously when the browser returns to cubic://auth/callback (→ handleCallback). */
  async signIn(provider: AuthProvider): Promise<void> {
    if (!this.client) return this.setError('Sign-in isn’t configured on this build.')
    this.status = 'signingIn'
    this.errorMsg = undefined
    this.emitChange()
    try {
      const { data, error } = await this.client.auth.signInWithOAuth({
        provider,
        options: { redirectTo: AUTH_REDIRECT, skipBrowserRedirect: true },
      })
      if (error || !data?.url) return this.setError(friendlyAuthError(error?.message ?? 'no url'))
      await shell.openExternal(data.url)
    } catch (e) {
      this.setError(friendlyAuthError(e instanceof Error ? e.message : String(e)))
    }
  }

  /** Handle the cubic://auth/callback deep link: exchange the PKCE code for a session. Tolerant of a
   *  user-denied consent (error params) and of non-auth cubic:// links (ignored). */
  async handleCallback(url: string): Promise<void> {
    if (!this.client) return
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return
    }
    if (parsed.host !== 'auth') return // not an auth callback
    const errDesc = parsed.searchParams.get('error_description') ?? parsed.searchParams.get('error')
    if (errDesc) return this.setError(friendlyAuthError(errDesc))
    const code = parsed.searchParams.get('code')
    if (!code) return
    try {
      const { data, error } = await this.client.auth.exchangeCodeForSession(code)
      if (error || !data.session) return this.setError(friendlyAuthError(error?.message ?? 'no session'))
      this.applySession(data.session)
    } catch (e) {
      this.setError(friendlyAuthError(e instanceof Error ? e.message : String(e)))
    }
  }

  /** The current (fresh) access token, refreshing on demand if it's within the skew window. Null when
   *  signed out. The Wave-2 proxy will read this per request; not yet attached to the WS chat frame. */
  async getAccessToken(): Promise<string | null> {
    if (!this.session) return null
    const expSoon = this.session.expires_at ? this.session.expires_at * 1000 - Date.now() < REFRESH_SKEW_MS : false
    if (expSoon) await this.refresh()
    return this.session?.access_token ?? null
  }

  /** Sign out: server-side revoke (default 'global' scope), then clear the persisted session. */
  async signOut(): Promise<void> {
    if (this.client) {
      try {
        // Default 'global' scope revokes the refresh token(s) server-side, so a leaked/copied token
        // can't mint fresh access tokens after sign-out (scope:'local' only cleared local state). We
        // clear our own state regardless of the network result, so this stays best-effort.
        await this.client.auth.signOut()
      } catch {
        /* revoke is best-effort; we clear our own state regardless */
      }
    }
    this.clearSession('signedOut')
  }

  /** Permanently delete the account (P2). Calls the service-role `delete-account` edge function (which
   *  cancels the Stripe subscription FIRST, then deletes the Supabase user — cascading billing rows),
   *  then clears the local session → the renderer flips to the signed-out AuthScreen. On any failure the
   *  session is LEFT intact (nothing was deleted, or only billing was stopped) so the user can retry. */
  async deleteAccount(): Promise<BillingActionResult> {
    if (!this.client) return { ok: false, error: 'unavailable' }
    const token = await this.getAccessToken()
    if (!token) return { ok: false, error: 'signed_out' }
    try {
      const res = await fetch(new URL('/functions/v1/delete-account', this.supabaseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: this.anonKey, authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (res.ok && data?.ok) {
        this.clearSession('signedOut') // account is gone server-side → drop the local session
        return { ok: true }
      }
      // Surface the edge fn's machine code (e.g. 502 cancel_failed / 500 delete_failed) so the renderer
      // can toast the right copy; fall back to the HTTP status.
      return { ok: false, error: data?.error ?? `http_${res.status}` }
    } catch {
      return { ok: false, error: 'failed' }
    }
  }

  /** Cancel the refresh timer (call on app quit so no interval keeps the process busy). */
  dispose(): void {
    this.clearRefresh()
  }

  // ── internals ──

  private applySession(session: Session): void {
    this.session = session
    this.status = 'signedIn'
    this.errorMsg = undefined
    this.persist(session)
    this.scheduleRefresh()
    this.emitChange()
  }

  private async refresh(): Promise<void> {
    if (!this.client || !this.session?.refresh_token) return this.clearSession('signedOut')
    try {
      const { data, error } = await this.client.auth.refreshSession({ refresh_token: this.session.refresh_token })
      if (error) return this.handleRefreshFailure(error) // definitive → sign out; transient → keep + retry
      if (!data.session) return this.clearSession('signedOut')
      this.applySession(data.session)
    } catch (e) {
      // A revoked token is RETURNED as `error` (handled above), so a throw here is unexpected/transient —
      // keep the session and retry rather than nuking it (unless it's clearly an invalid-grant).
      this.handleRefreshFailure(e)
    }
  }

  /** Only a definitive invalid-grant drops the persisted session; a transient failure (offline / blip)
   *  keeps it, stays signed in, and retries on a bounded timer so it recovers on reconnect (#12). */
  private handleRefreshFailure(error: unknown): void {
    if (isDefinitiveInvalidGrant(error)) return this.clearSession('signedOut')
    // If init() left us 'loading', resolve to signedIn so the gate doesn't flash the sign-in screen offline.
    if (this.status !== 'signedIn') {
      this.status = 'signedIn'
      this.errorMsg = undefined
      this.emitChange()
    }
    this.clearRefresh()
    this.refreshTimer = setTimeout(() => void this.refresh(), REFRESH_RETRY_MS)
  }

  private scheduleRefresh(): void {
    this.clearRefresh()
    if (!this.session?.expires_at) return
    const msUntil = this.session.expires_at * 1000 - Date.now() - REFRESH_SKEW_MS
    // A late timer (laptop sleep) is covered by the on-demand refresh in getAccessToken().
    this.refreshTimer = setTimeout(() => void this.refresh(), Math.max(0, msUntil))
  }

  private clearRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  private clearSession(status: AuthStatus): void {
    this.clearRefresh()
    this.session = null
    this.status = status
    this.errorMsg = undefined
    this.deletePersisted()
    this.emitChange()
  }

  private setStatus(status: AuthStatus): void {
    this.status = status
    this.errorMsg = undefined
    this.emitChange()
  }

  private setError(msg: string): void {
    this.status = 'error'
    this.errorMsg = msg
    this.emitChange()
  }

  private emitChange(): void {
    this.emit('change', this.state)
  }

  // ── persistence (safeStorage / OS keychain) ──
  // Gated on isEncryptionAvailable(): if the keychain is unavailable we keep the session in memory only
  // (re-login per launch) rather than ever writing a plaintext token to disk.

  private get sessionPath(): string {
    return join(app.getPath('userData'), 'auth.bin')
  }

  private persist(session: Session): void {
    if (!safeStorage.isEncryptionAvailable()) return
    try {
      writeFileSync(this.sessionPath, safeStorage.encryptString(JSON.stringify(session)))
    } catch (e) {
      console.error('[auth] failed to persist session:', e instanceof Error ? e.message : e)
    }
  }

  private loadPersisted(): Session | null {
    if (!safeStorage.isEncryptionAvailable()) return null
    try {
      if (!existsSync(this.sessionPath)) return null
      return JSON.parse(safeStorage.decryptString(readFileSync(this.sessionPath))) as Session
    } catch {
      // Decrypt/parse failure (e.g. keychain rotated) → discard and start signed-out.
      this.deletePersisted()
      return null
    }
  }

  private deletePersisted(): void {
    try {
      if (existsSync(this.sessionPath)) unlinkSync(this.sessionPath)
    } catch {
      /* best-effort */
    }
  }
}
