// Shared between main (handler) and preload (invoker). Single place that names the
// IPC channels + types the surface exposed to the renderer as `window.cubic`.

export const CHANNELS = {
  getBackendPort: 'cubic:getBackendPort',
  getBackendStatus: 'cubic:getBackendStatus',
  backendStatus: 'cubic:backendStatus',
  // Non-destructive AE reconnect: re-write ~/.cubic/conn.json so the dormant CEP panel's fs.watch fires
  // and it reconnects — without dropping in-flight turns. Fired from the AeStatus "Reconnect" button.
  reconnectAe: 'cubic:reconnectAe',
  // App version (for the Settings → General "About" card). Read from the packaged app in main.
  getAppVersion: 'cubic:getAppVersion',
  // §B auth — main owns the Supabase session; the renderer drives sign-in and reads state over these.
  getCubicEnv: 'cubic:getCubicEnv',
  authSignIn: 'cubic:auth:signIn',
  authCancelSignIn: 'cubic:auth:cancelSignIn',
  authSignOut: 'cubic:auth:signOut',
  authGetState: 'cubic:auth:getState',
  authGetAccessToken: 'cubic:auth:getAccessToken',
  authDeleteAccount: 'cubic:auth:deleteAccount',
  authChanged: 'cubic:auth:changed',
  // §D — billing/entitlement DISPLAY (main owns every Supabase/Stripe call; the renderer only reads
  // state + triggers). Distinct from the proxy GATE (Wave-2, 402). Same snapshot + `change` broadcast
  // shape as auth.
  billingGetState: 'cubic:billing:getState',
  billingRefresh: 'cubic:billing:refresh',
  billingOpenCheckout: 'cubic:billing:openCheckout',
  billingOpenPortal: 'cubic:billing:openPortal',
  billingChanged: 'cubic:billing:changed',
  // Read-only billing detail for the Settings → Billing tab (default card + invoice history), fetched
  // on-demand when the tab opens; and open a Stripe-hosted invoice page in the system browser.
  billingGetDetails: 'cubic:billing:getDetails',
  billingOpenInvoice: 'cubic:billing:openInvoice',
  // §H — one-way (fire-and-forget) forward of a renderer analytics event to main, which stamps the
  // user id + sends to PostHog. `send`/`.on` (no ack), unlike every other channel here (all `invoke`).
  analyticsTrack: 'cubic:analytics:track',
  // §F auto-update — main owns electron-updater; the renderer reads state + triggers a restart-to-install.
  // Same snapshot getter + `change` broadcast shape as backend/auth/billing; `updateRestart` is a
  // fire-and-forget `send` (the app quits, so there's no ack to await).
  updateGetState: 'cubic:update:getState',
  updateChanged: 'cubic:update:changed',
  updateRestart: 'cubic:update:restart',
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

/**
 * §F auto-update state, owned by main's UpdateManager and pushed to the renderer (same snapshot +
 * `change` shape as BackendStatus). Download is silent/background; the renderer acts ONLY on `ready`
 * (shows the restart-to-update bar + Settings indicator). A failed/absent check never surfaces — it
 * stays `idle` (fail-silent).
 *  - idle        — nothing pending / already current / a check failed
 *  - checking    — a check is in flight
 *  - available   — a newer version was found (download starting)
 *  - downloading — downloading in the background
 *  - ready       — downloaded + STAGED; applies on the next restart (the only state the UI acts on)
 */
export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready'
export interface UpdateState {
  phase: UpdatePhase
  /** The version being offered/staged (from `available` onward); null when idle. */
  version: string | null
}

/** The backend's WS connection info, discovered by main from the child's `bridgeReady` report and
 *  handed to the renderer via getBackendPort(). `port` is OS-assigned (dynamic); `token` is the
 *  per-launch session secret every client must echo in its first `hello` frame. */
export interface BackendConn {
  port: number
  token: string
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

/**
 * Billing/entitlement (§D), owned by the main-process BillingManager and pushed to the renderer over IPC
 * (same snapshot + broadcast shape as AuthState). This is the DISPLAY side (plan tag, usage %-bar,
 * paywall) — the enforcement GATE lives in the Wave-2 proxy (a 402 on a blocked send). Main reads the
 * `get_entitlement` RPC with the user's own JWT (self-read, IDOR-guarded to their row) and opens
 * Checkout/Portal; the renderer never touches Supabase/Stripe.
 */
export type PlanId = 'pro' | 'max'
/** The 8 Stripe-mirrored statuses (`public.subscription_status`); null = never subscribed (no row). */
export type SubscriptionStatus =
  | 'incomplete' | 'incomplete_expired' | 'trialing' | 'active'
  | 'past_due' | 'canceled' | 'unpaid' | 'paused'
/** The `get_entitlement` row, mapped to camelCase (mirrors proxy/src/entitlement.ts). `entitled` = the
 *  proxy's own gate predicate (spent < allowance AND a live paid state); `status` is the REAL row status
 *  even when blocked, so the paywall can route (past_due vs over-cap vs no-plan). */
export interface Entitlement {
  entitled: boolean
  /** 'pro' | 'max' | 'unknown' (unmapped price) | null (never subscribed). */
  plan: string | null
  priceId: string | null
  allowanceCents: number
  spentCents: number
  periodStart: string | null
  periodEnd: string | null
  status: SubscriptionStatus | null
  /** True once cancellation is scheduled (Stripe `cancel_at_period_end`) — the row is still `active`
   *  but won't renew. Drives the account-delete gate (P2): a scheduled cancel unlocks Delete same-day. */
  cancelAtPeriodEnd: boolean
}
export interface BillingState {
  /** 'loading' — before the first fetch; 'ready' — a fetch has resolved (entitlement may be null when
   *  signed out); 'unavailable' — Supabase isn't configured on this build (billing degrades, never throws). */
  status: 'loading' | 'ready' | 'unavailable'
  entitlement: Entitlement | null
  /** True while a post-Checkout/Portal-return bounded refetch is in flight (drives "Activating…"). */
  activating: boolean
}
/** Result of an openCheckout/openPortal trigger. `error` is a machine code the renderer maps to copy:
 *  'unavailable' | 'signed_out' | 'already_subscribed' | 'no_subscription' | 'failed'. */
export interface BillingActionResult {
  ok: boolean
  error?: string
}

/** The default card shown in Settings → Billing → Payment (from Stripe, read-only). */
export interface PaymentMethod {
  brand: string
  last4: string
}
/** One past invoice for the Settings → Billing invoice table. Amounts are cents; dates are unix seconds
 *  (as Stripe returns them). `hostedUrl` is the Stripe-hosted invoice page the "View" link opens. */
export interface Invoice {
  id: string
  number: string | null
  created: number
  dueDate: number | null
  total: number
  currency: string
  status: string | null
  hostedUrl: string | null
  pdfUrl: string | null
}
/** The Billing tab's on-demand read (default card + recent invoices), fetched when the tab opens. */
export interface BillingDetails {
  paymentMethod: PaymentMethod | null
  invoices: Invoice[]
}

/** The API the preload bridges onto `window.cubic` in the renderer. */
export interface CubicApi {
  /** The backend WS connection — its OS-assigned port + the per-launch session token the renderer must
   *  send in its first `hello` frame. Resolves once the backend child has reported them up to main. */
  getBackendPort(): Promise<BackendConn>
  /** Current backend-link status (snapshot) — for a renderer that mounts/reloads mid-run. */
  getBackendStatus(): Promise<BackendStatus>
  /** Subscribe to backend-link status pushes. Returns an unsubscribe fn. */
  onBackendStatus(cb: (status: BackendStatus) => void): () => void
  /** Non-destructively nudge a disconnected AE panel to reconnect (re-writes ~/.cubic/conn.json → the
   *  panel's fs.watch fires → it reconnects, dropping no in-flight turn). Resolves `true` if the poke was
   *  written, `false` if the backend isn't ready (nothing to poke with — the user must reopen Cubic/AE).
   *  Success (the panel actually landing) is observed via the `aeStatus` push flipping `aeConnected`. */
  reconnectAe(): Promise<boolean>
  /** The app version (from package.json / the packaged build) for the Settings "About" card. */
  getAppVersion(): Promise<string>
  /** Which deployment we're running as — the gate uses this to block only in prod. */
  getCubicEnv(): Promise<CubicEnvName>
  /** Start the OAuth flow for a provider (opens the system browser). Resolves once the browser opens. */
  authSignIn(provider: AuthProvider): Promise<void>
  /** Abandon an in-flight sign-in (the user closed/gave up on the browser tab) → back to a clickable
   *  signed-out state. The system browser is external, so its tab can't be observed; this is the manual
   *  escape hatch out of the 'signingIn' wait. */
  authCancelSignIn(): Promise<void>
  /** Sign out — clears the persisted session and returns to signed-out. */
  authSignOut(): Promise<void>
  /** Permanently delete the account (P2): cancels the Stripe sub + deletes the Supabase user server-side,
   *  then clears the local session (→ AuthScreen). `ok:false` leaves the session intact so the user can
   *  retry. Only reachable after the client-side gate (sub must be cancelled first). */
  deleteAccount(): Promise<BillingActionResult>
  /** Current auth state (snapshot) — for a renderer that mounts/reloads mid-run. */
  getAuthState(): Promise<AuthState>
  /** The current (fresh) Supabase access token, or null when signed out. Wave-2 proxy seam — not yet
   *  attached to the WS chat frame; exposed here so that wiring is mechanical later. */
  getAccessToken(): Promise<string | null>
  /** Subscribe to auth-state pushes. Returns an unsubscribe fn. */
  onAuthChanged(cb: (state: AuthState) => void): () => void
  /** Current billing/entitlement state (snapshot) — for a renderer that mounts/reloads mid-run. */
  getBilling(): Promise<BillingState>
  /** Force a fresh entitlement refetch (sign-in, window-focus, and the 402 backstop). Fire-and-forget:
   *  the resolved state arrives via onBillingChanged. */
  refreshBilling(): Promise<void>
  /** Open Stripe Checkout for a plan in the system browser (first paid conversion). */
  openCheckout(plan: PlanId): Promise<BillingActionResult>
  /** Open the Stripe Customer Portal in the system browser. Default = Portal home; a `flow` deep-links
   *  straight to the exact action: 'cancel' (cancel confirmation), 'update_card' (payment-method update,
   *  past_due), or 'switch' (confirm switching to `plan` — Pro⇄Max upgrade/downgrade). */
  openPortal(flow?: 'cancel' | 'update_card' | 'switch', plan?: PlanId): Promise<BillingActionResult>
  /** Read-only billing detail (default card + recent invoices) for the Settings → Billing tab, fetched
   *  on-demand when the tab opens. `null` = the read failed (keep the tab's other fields); an empty
   *  `invoices` array = subscribed but nothing billed yet. Main resolves the customer from the JWT. */
  getBillingDetails(): Promise<BillingDetails | null>
  /** Open a Stripe-hosted invoice page (the invoice table's "View" link) in the system browser. Main
   *  guards the URL to https Stripe hosts before opening. */
  openInvoice(url: string): Promise<BillingActionResult>
  /** Subscribe to billing-state pushes. Returns an unsubscribe fn. */
  onBillingChanged(cb: (state: BillingState) => void): () => void
  /** §H — fire-and-forget: forward a renderer analytics event to main (main stamps identity + captures,
   *  applies the event/property whitelist, and sends to PostHog). No return; telemetry never blocks the
   *  UI. Unknown event names / non-whitelisted props are dropped in main. */
  trackEvent(event: string, props?: Record<string, unknown>): void
  /** §F — current auto-update state (snapshot), for a renderer that mounts/reloads mid-run. */
  getUpdateState(): Promise<UpdateState>
  /** §F — subscribe to update-state pushes. Returns an unsubscribe fn. */
  onUpdateChanged(cb: (state: UpdateState) => void): () => void
  /** §F — apply a staged update: quit + swap + relaunch into the new version. Fire-and-forget (the app
   *  quits). Only meaningful when the phase is 'ready'; a no-op otherwise. */
  restartToUpdate(): void
}
