// §D — billing/entitlement DISPLAY, owned entirely by the main process. Mirrors AuthManager: the
// renderer is sandboxed and only ever sees a serializable `BillingState` over IPC; every Supabase/Stripe
// call lives here. This is the DISPLAY side (plan tag, usage %-bar, paywall) — the enforcement GATE is
// the Wave-2 proxy (a 402 on a blocked send). We read the `get_entitlement` RPC with the user's OWN JWT
// (self-read, IDOR-guarded to their row — no service-role key on device) and open Checkout/Portal in the
// system browser; the browser returns via `cubic://billing/*` (routed from index.ts → handleReturn).
//
// Fail-OPEN on a fetch error (keep the last known state) — this is display only; the proxy is the real
// gate, so a transient display-read blip must never flip a paying user to "blocked". Contrast the proxy,
// which fail-CLOSES.

import { EventEmitter } from 'node:events'
import { shell } from 'electron'
import type { BackendConfig } from './config.js'
import type { BillingActionResult, BillingDetails, BillingState, Entitlement, PlanId, SubscriptionStatus } from '../shared/ipc.js'

// Post-Checkout/Portal-return webhook lag: Stripe's webhook is the only writer of paid-state and can lag
// the browser return by a few seconds, so an immediate refetch may still show the old state. Poll on a
// bounded backoff until `entitled` flips / `status` changes / we run out — then stop. Event-triggered and
// bounded (NOT an idle poll). Sums to ~19s of coverage.
const RETURN_POLL_DELAYS_MS = [800, 1200, 1600, 2000, 2500, 3000, 3500, 4000]

/** Map the snake_case `get_entitlement` row → our camelCase shape. `spent_cents`/`allowance_cents` arrive
 *  as numeric strings over PostgREST (mirrors proxy/src/entitlement.ts). */
function toEntitlement(row: Record<string, unknown>): Entitlement {
  const numOr0 = (v: unknown): number => (v == null ? 0 : Number(v))
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
  return {
    entitled: row.entitled === true,
    plan: str(row.plan),
    priceId: str(row.price_id),
    allowanceCents: numOr0(row.allowance_cents),
    spentCents: numOr0(row.spent_cents),
    periodStart: str(row.period_start),
    periodEnd: str(row.period_end),
    status: str(row.status) as SubscriptionStatus | null,
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
  }
}

export class BillingManager extends EventEmitter {
  private readonly supabaseUrl: string
  private readonly anonKey: string
  private readonly getAccessToken: () => Promise<string | null>
  private state: BillingState
  private returnPoll: NodeJS.Timeout | null = null

  constructor(config: BackendConfig, getAccessToken: () => Promise<string | null>) {
    super()
    this.supabaseUrl = config.supabaseUrl
    this.anonKey = config.supabaseAnonKey
    this.getAccessToken = getAccessToken
    // No Supabase configured (e.g. a local-dev machine) → billing is simply unavailable, exactly like
    // AuthManager's null client. The app stays usable; the paywall never blocks in local dev.
    this.state = this.configured()
      ? { status: 'loading', entitlement: null, activating: false }
      : { status: 'unavailable', entitlement: null, activating: false }
  }

  private configured(): boolean {
    return Boolean(this.supabaseUrl && this.anonKey)
  }

  /** Current billing state — the snapshot returned over IPC and the payload of every `change` event. */
  get snapshot(): BillingState {
    return this.state
  }

  /** Single entitlement refetch — used on sign-in, window-focus, and the 402 backstop. Fire-and-forget:
   *  the result is broadcast via `change`. A fetch failure is a no-op (keeps the last known state). */
  async refresh(): Promise<void> {
    const ent = await this.fetchEntitlement()
    if (ent === undefined) return
    this.setState({ status: 'ready', entitlement: ent })
  }

  /** Handle a `cubic://billing/*` return. success / portal-return → run the activation poll (absorbs
   *  webhook lag); cancel → a single refresh (nothing changed, just re-sync). */
  async handleReturn(url: string): Promise<void> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return
    }
    if (parsed.host !== 'billing') return
    const path = parsed.pathname.replace(/^\//, '') // 'success' | 'cancel' | 'portal-return'
    if (path === 'cancel') return void this.refresh()
    this.startReturnPoll()
  }

  /** Open Stripe Checkout for the first paid conversion. */
  async openCheckout(plan: PlanId): Promise<BillingActionResult> {
    return this.openBrowserFlow('create-checkout', { plan })
  }

  /** Open the Stripe Customer Portal. A `flow` deep-links straight to the exact action instead of the
   *  Portal home: 'cancel' (cancel confirmation), 'update_card' (payment-method update, past_due), or
   *  'switch' (confirm switching to `plan` — Pro⇄Max). */
  async openPortal(flow?: 'cancel' | 'update_card' | 'switch', plan?: PlanId): Promise<BillingActionResult> {
    const body: Record<string, string> = {}
    if (flow) body.flow = flow
    if (plan) body.plan = plan
    return this.openBrowserFlow('create-portal', body)
  }

  /** Read-only billing detail (default card + recent invoices) for the Settings → Billing tab. Like
   *  `fetchEntitlement`, this returns DATA (not a browser open); `null` on any failure so the tab keeps
   *  its other fields. The edge fn resolves the Stripe customer from the caller's JWT. */
  async getBillingDetails(): Promise<BillingDetails | null> {
    if (!this.configured()) return null
    const token = await this.getAccessToken()
    if (!token) return null
    try {
      const res = await fetch(new URL('/functions/v1/billing-details', this.supabaseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: this.anonKey, authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      })
      // Surface WHY it failed in the dev log — a 404 means the function isn't deployed to this Supabase
      // project; a 500 is a runtime error in the function (check its logs). Otherwise this fails silently.
      if (!res.ok) {
        console.error(`billing-details fetch failed: HTTP ${res.status} — ${await res.text().catch(() => '')}`)
        return null
      }
      const data = (await res.json().catch(() => null)) as BillingDetails | null
      if (!data || !Array.isArray(data.invoices)) {
        console.error('billing-details: malformed response (missing invoices array)')
        return null
      }
      return data
    } catch (e) {
      console.error('billing-details fetch threw', e)
      return null
    }
  }

  /** Open a Stripe-hosted invoice page (the "View" link) in the system browser. Guarded to https Stripe
   *  hosts — the URL originates from our own edge fn, but we never hand an unvalidated string to the OS. */
  async openInvoice(url: string): Promise<BillingActionResult> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { ok: false, error: 'invalid_url' }
    }
    if (parsed.protocol !== 'https:' || !/(^|\.)stripe\.com$/.test(parsed.hostname)) {
      return { ok: false, error: 'invalid_url' }
    }
    await shell.openExternal(parsed.href)
    return { ok: true }
  }

  /** Clear entitlement on sign-out (the row belongs to a now-signed-out user). Keeps 'unavailable'. */
  clear(): void {
    this.clearReturnPoll()
    if (this.state.status === 'unavailable') return
    this.setState({ status: 'ready', entitlement: null, activating: false })
  }

  /** Cancel the return poll (call on app quit so no timer keeps the process busy). */
  dispose(): void {
    this.clearReturnPoll()
  }

  // ── internals ──

  private setState(patch: Partial<BillingState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('change', this.state)
  }

  /** Fetch the current entitlement via the RPC with the user's own JWT. Returns `undefined` (a no-op for
   *  callers) when unavailable / signed-out / the read fails — never clobbers state on a transient error. */
  private async fetchEntitlement(): Promise<Entitlement | undefined> {
    if (!this.configured()) return undefined
    const token = await this.getAccessToken()
    if (!token) return undefined
    try {
      const res = await fetch(new URL('/rest/v1/rpc/get_entitlement', this.supabaseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: this.anonKey, authorization: `Bearer ${token}` },
        body: JSON.stringify({}), // p_user_id defaults to auth.uid() — the caller's own row
      })
      if (!res.ok) return undefined
      // A `returns table(...)` RPC comes back as a JSON array with exactly one row (a never-subscribed
      // user gets an all-null/entitled=false row, not an empty array). An empty/malformed body is a read
      // failure → undefined (keep last state), never a fabricated "no plan".
      const rows = (await res.json().catch(() => null)) as Array<Record<string, unknown>> | null
      if (!rows || rows.length === 0 || typeof rows[0] !== 'object' || rows[0] === null) return undefined
      return toEntitlement(rows[0])
    } catch {
      return undefined
    }
  }

  /** POST a Supabase edge function → open the returned Stripe URL in the system browser. */
  private async openBrowserFlow(fn: 'create-checkout' | 'create-portal', body: object): Promise<BillingActionResult> {
    if (!this.configured()) return { ok: false, error: 'unavailable' }
    const token = await this.getAccessToken()
    if (!token) return { ok: false, error: 'signed_out' }
    try {
      const res = await fetch(new URL(`/functions/v1/${fn}`, this.supabaseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: this.anonKey, authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null
      if (res.ok && data?.url) {
        await shell.openExternal(data.url)
        return { ok: true }
      }
      // Surface the edge fn's machine code (e.g. 409 already_subscribed / 404 no subscription) so the
      // renderer can toast the right copy; fall back to the HTTP status.
      return { ok: false, error: data?.error ?? `http_${res.status}` }
    } catch {
      return { ok: false, error: 'failed' }
    }
  }

  /** Bounded-backoff refetch after a billing return: poll until `entitled` flips / `status` changes /
   *  the schedule is exhausted, flagging `activating` so the UI can show "Activating…". Cancellable. */
  private startReturnPoll(): void {
    this.clearReturnPoll()
    const before = this.state.entitlement
    this.setState({ activating: true })
    let i = 0
    const tick = async (): Promise<void> => {
      const ent = await this.fetchEntitlement()
      if (ent !== undefined) {
        this.setState({ status: 'ready', entitlement: ent })
        const changed = ent.entitled !== (before?.entitled ?? false) || ent.status !== (before?.status ?? null)
        if (ent.entitled || changed) {
          this.clearReturnPoll()
          this.setState({ activating: false })
          return
        }
      }
      if (i >= RETURN_POLL_DELAYS_MS.length) {
        this.clearReturnPoll()
        this.setState({ activating: false })
        return
      }
      this.returnPoll = setTimeout(() => void tick(), RETURN_POLL_DELAYS_MS[i++])
    }
    void tick()
  }

  private clearReturnPoll(): void {
    if (this.returnPoll) {
      clearTimeout(this.returnPoll)
      this.returnPoll = null
    }
  }
}
