// Shared between main (handler) and preload (invoker). Single place that names the
// IPC channels + types the surface exposed to the renderer as `window.cubic`.

export const CHANNELS = {
  getBackendPort: 'cubic:getBackendPort',
  getBackendStatus: 'cubic:getBackendStatus',
  backendStatus: 'cubic:backendStatus',
  // §B auth — main owns the Supabase session; the renderer drives sign-in and reads state over these.
  getCubicEnv: 'cubic:getCubicEnv',
  authSignIn: 'cubic:auth:signIn',
  authSignOut: 'cubic:auth:signOut',
  authGetState: 'cubic:auth:getState',
  authGetAccessToken: 'cubic:auth:getAccessToken',
  authChanged: 'cubic:auth:changed',
} as const

/**
 * Backend-link state, owned by main and pushed to the renderer over IPC. This is DISTINCT from the
 * renderer's own WS link (`connection` in ws.ts) and from AE-worker liveness (`aeConnected`, pushed by
 * the backend over the WS as `aeStatus`). It must come from main because during a backend crash the
 * renderer's WS is down — so it can't learn "the backend is reconnecting" over that socket.
 *  - phase: lifecycle of the spawned backend child.
 *      starting     — initial spawn, not yet confirmed healthy
 *      running      — child alive + settled
 *      reconnecting — child died, bounded auto-restart in flight
 *      port-in-use  — child exited EADDRINUSE (blocking; another Cubic is running)
 *      stopped      — auto-restart budget exhausted (blocking; reopen the app)
 *  - install: provisioning outcome (AE-only, NEVER blocks the app).
 *      ok      — extension already current
 *      updated — a copy happened this launch (fresh install or changed) → renderer may show "restart AE"
 *      failed  — provisioning threw → "Couldn't install — restart Cubic"
 */
export type BackendPhase = 'starting' | 'running' | 'reconnecting' | 'port-in-use' | 'stopped'
export type InstallState = 'ok' | 'updated' | 'failed'
export interface BackendStatus {
  phase: BackendPhase
  install: InstallState
}

/** Which deployment the app runs as — mirrors main's `CubicEnv`, surfaced to the renderer so the
 *  prod-only sign-in gate knows whether to block (see App.tsx). Defined here (not imported from main's
 *  config) to keep the renderer free of main-process modules. */
export type CubicEnvName = 'local' | 'prod'

/**
 * Auth state (§B), owned by the main-process AuthManager and pushed to the renderer over IPC (same
 * snapshot + broadcast shape as BackendStatus). DISTINCT from billing/entitlement — there is no plan
 * here (that lands with WT-BILLING / §D-5). The renderer is presentational: it renders this and calls
 * signIn/signOut; all Supabase/PKCE/token work stays in main.
 *  - status: 'loading'   — main hasn't reported yet (boot, before the persisted session is restored)
 *            'signedOut' — no session
 *            'signingIn' — OAuth round-trip in flight (browser open, awaiting the cubic:// callback)
 *            'signedIn'  — a valid session is held
 *            'error'     — the last sign-in attempt failed (e.g. consent denied)
 */
export type AuthStatus = 'loading' | 'signedOut' | 'signingIn' | 'signedIn' | 'error'
/** The OAuth providers the sign-in flow supports. Google ships now; Apple is a config-only follow-up. */
export type AuthProvider = 'google' | 'apple'
export interface AuthUser {
  id: string
  email: string
  /** From the OAuth provider's `user_metadata` (may be absent). */
  name?: string
  avatarUrl?: string
}
export interface AuthState {
  status: AuthStatus
  user: AuthUser | null
  /** Friendly message when `status === 'error'`. */
  error?: string
}

/** The API the preload bridges onto `window.cubic` in the renderer. */
export interface CubicApi {
  /** The WS port the backend bound — resolved by main (the single source of truth). */
  getBackendPort(): Promise<number>
  /** Current backend-link status (snapshot) — for a renderer that mounts/reloads mid-run. */
  getBackendStatus(): Promise<BackendStatus>
  /** Subscribe to backend-link status pushes. Returns an unsubscribe fn. */
  onBackendStatus(cb: (status: BackendStatus) => void): () => void
  /** Which deployment we're running as — the gate uses this to block only in prod. */
  getCubicEnv(): Promise<CubicEnvName>
  /** Start the OAuth flow for a provider (opens the system browser). Resolves once the browser opens. */
  authSignIn(provider: AuthProvider): Promise<void>
  /** Sign out — clears the persisted session and returns to signed-out. */
  authSignOut(): Promise<void>
  /** Current auth state (snapshot) — for a renderer that mounts/reloads mid-run. */
  getAuthState(): Promise<AuthState>
  /** The current (fresh) Supabase access token, or null when signed out. Wave-2 proxy seam — not yet
   *  attached to the WS chat frame; exposed here so that wiring is mechanical later. */
  getAccessToken(): Promise<string | null>
  /** Subscribe to auth-state pushes. Returns an unsubscribe fn. */
  onAuthChanged(cb: (state: AuthState) => void): () => void
}
