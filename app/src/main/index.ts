import { app, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.js'
import { createWindow } from './window.js'
import { buildAppMenu } from './menu.js'
import { registerIpc } from './ipc.js'
import { BackendSupervisor } from './backend.js'
import { AuthManager } from './auth.js'
import { BillingManager } from './billing.js'
import { AnalyticsManager } from './analytics.js'
import { provisionBridge } from './installBridge.js'
import { UpdateManager } from './updater.js'
import type { AuthState, AuthStatus } from '../shared/ipc.js'

/**
 * DEV-ONLY: ensure the open AE panel AND the running Node backend match the source. The panel bakes
 * its bundle in at open and the backend runs from a pre-built serve.js (+ the cubic-ai brain), so
 * editing a .jsx or any backend .ts doesn't take effect until they're rebuilt/reloaded. After the
 * backend is up (so it + the reconnecting panel can be queried), the unified preflight rebuilds from
 * source; if either is stale it reloads/rebuilds and exits 1 — we then quit so the dev re-runs clean
 * on fresh code. Runs non-blocking so a fresh setup (or AE closed) never delays launch. No-op when
 * packaged (prod auto-updater handles real users).
 */
let preflightChild: ReturnType<typeof spawn> | null = null
function runDevPreflight(): void {
  if (app.isPackaged) return
  const here = dirname(fileURLToPath(import.meta.url)) // app/out/main
  const script = join(here, '..', '..', '..', 'server', 'ae-bridge', 'scripts', 'preflight.mjs')
  if (!existsSync(script)) return
  // The panel/backend reconnect to the just-spawned backend a few seconds after launch, so give them
  // a generous window to appear before deciding (vs the short default the tests use). Runs in the
  // background — launch isn't delayed; it's killed on quit so it never lingers if AE is closed.
  preflightChild = spawn(process.execPath, [script], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CUBIC_PREFLIGHT_WAIT_MS: '30000' },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  preflightChild.on('exit', (code) => {
    preflightChild = null
    if (code === 1) {
      console.error('[main] Cubic panel and/or backend was stale — rebuilt + reloaded. Re-run `npm run dev`.')
      app.quit()
    }
  })
}

// Single-instance lock FIRST — load-bearing: a 2nd instance would spawn a 2nd backend that
// overwrites ~/.cubic/conn.json and races for the single AE CEP worker connection. The 2nd process
// quits immediately; the existing window just refocuses.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  const config = loadConfig()
  const backend = new BackendSupervisor(config)
  const auth = new AuthManager(config)
  // §D billing DISPLAY — reads entitlement with the user's own JWT (via auth.getAccessToken) + opens
  // Checkout/Portal. Refetch on the sign-in transition, clear on sign-out (mirrors how auth drives the
  // renderer). A transition guard avoids redundant refetches on the many intermediate auth `change`s.
  const billing = new BillingManager(config, () => auth.getAccessToken())
  // §H analytics — one PostHog client in main; renderer + backend forward events here to be stamped with
  // identity + sent. Off by default in dev (config.analyticsEnabled). Identity rides the same auth
  // transition guard: identify on sign-in (aliasing pre-sign-in anonymous events), rotate on real sign-out.
  const analytics = new AnalyticsManager(config)
  // §F auto-update — electron-updater in main; checks/downloads in the background and stages for the next
  // restart. No-op unless packaged (started below, after the window).
  const updater = new UpdateManager()
  let lastAuthStatus: AuthStatus | null = null
  auth.on('change', (state: AuthState) => {
    if (state.status === 'signedIn' && lastAuthStatus !== 'signedIn') {
      void billing.refresh()
      // `interactive` = they just completed the OAuth flow (signingIn→signedIn), NOT a silent session
      // restore (loading→signedIn) — so signed_in only fires for a real sign-in-page pass.
      if (state.user) analytics.onSignIn(state.user.id, lastAuthStatus === 'signingIn')
    } else if (state.status === 'signedOut') {
      billing.clear()
      // Only a genuine sign-out (was signedIn) rotates the anonymous id; the initial boot signed-out
      // must keep it stable so app_opened + the later sign-in alias share one id and stitch.
      if (lastAuthStatus === 'signedIn') analytics.onSignOut()
    }
    lastAuthStatus = state.status
  })

  // Backend crash recovery + connection-state UX now live in the supervisor (§B6): it bounded-restarts
  // and emits `status` (broadcast to the renderer by registerIpc). Keep only spawn-error logging here.
  backend.on('error', (err: Error) => console.error('[main] backend error:', err.message))
  // §H — the backend child forwards command_run / first_edit signals up; main stamps identity + sends.
  backend.on('analytics', (e: { event: string; props?: Record<string, unknown> }) =>
    analytics.captureFromBackend(e.event, e.props),
  )

  // §B — register the cubic:// scheme so OAuth can return to the app. In dev (run via the electron
  // binary) the handler must point at this script so the OS launches the right process.
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('cubic', process.execPath, [resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient('cubic')
  }

  // The OAuth callback can arrive before `auth.init()` has run (cold start launched BY the deep link on
  // macOS, where open-url fires before whenReady). Buffer it until auth is ready, then flush.
  let authReady = false
  let pendingDeepLink: string | null = null
  // Billing returns (cubic://billing/*) can likewise arrive before the managers are ready on a cold
  // start launched BY the deep link — buffer + flush the same way auth does.
  let billingReady = false
  let pendingBillingLink: string | null = null
  const focusMainWindow = (): void => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  }
  const routeDeepLink = (url: string): void => {
    if (!url.startsWith('cubic://')) return
    focusMainWindow() // user is returning from the system browser
    if (url.startsWith('cubic://auth')) {
      if (authReady) void auth.handleCallback(url)
      else pendingDeepLink = url
    } else if (url.startsWith('cubic://billing')) {
      if (billingReady) void billing.handleReturn(url)
      else pendingBillingLink = url
    }
  }

  // macOS delivers the deep link here (not via argv). Registered before whenReady so a cold-start URL
  // isn't dropped.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    routeDeepLink(url)
  })

  app.on('second-instance', (_event, argv) => {
    focusMainWindow()
    // Windows/Linux deliver the deep link as an argv entry to the primary instance.
    const deepLink = argv.find((a) => a.startsWith('cubic://'))
    if (deepLink) routeDeepLink(deepLink)
  })

  app.whenReady().then(async () => {
    // §B5 — provision the AE bridge (idempotent, content-hash gated) BEFORE the backend/UI come up.
    // Never throws; a failure only degrades AE connectivity (the status dot), never blocks launch.
    const install = await provisionBridge()
    registerIpc(config, backend, auth, billing, analytics, updater) // subscribe to status/auth/billing/update before markInstall/start so pushes broadcast
    backend.markInstall(install)
    buildAppMenu()
    backend.start()
    // Wait for the backend to OS-assign its port + mint the session token and report them up (it also
    // writes ~/.cubic/conn.json here), so getBackendPort() has a value and the preflight/panel/loopback
    // can discover the connection. Non-fatal on timeout — the renderer retries and the dot shows the
    // real cause (reconnecting/stopped) from the supervisor status.
    await backend.whenReady().catch((e: Error) => console.error('[main] backend not ready:', e.message))
    runDevPreflight() // dev-only; non-blocking, quits the app if the panel was stale + reloaded
    createWindow()
    // §F — begin background update checks (no-op unless packaged). After the window so a check never
    // competes with cold-start work; it downloads silently + stages the update for the next restart.
    updater.start()

    // §B — restore any persisted session, then flush a deep link that arrived during cold start.
    void auth.init()
    authReady = true
    if (pendingDeepLink) {
      const url = pendingDeepLink
      pendingDeepLink = null
      void auth.handleCallback(url)
    }
    // §D — billing is ready as soon as the window exists (no async init); flush any buffered return.
    billingReady = true
    if (pendingBillingLink) {
      const url = pendingBillingLink
      pendingBillingLink = null
      void billing.handleReturn(url)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // SIGTERM the child on quit so it frees the WS port (serve.ts's installShutdown). PostHog's flush is
  // async, so defer termination until it resolves: prevent-default once, do the sync teardown, flush, then
  // app.exit(0) — a HARD exit, NOT app.quit(). A signal-initiated quit (Ctrl+C / SIGTERM) that we
  // preventDefault can't be reliably resumed with app.quit(): the process survives, orphans (PPID 1), and
  // keeps holding the single-instance lock, silently blocking the next launch. app.exit bypasses
  // before-quit/window-all-closed and always terminates.
  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) return
    quitting = true
    e.preventDefault()
    backend.stop()
    auth.dispose() // cancel the token-refresh timer so it doesn't keep the process busy
    billing.dispose() // cancel any in-flight billing return poll
    updater.dispose() // stop the periodic update-check timer
    preflightChild?.kill() // don't leave a dev preflight waiter polling after the app quits
    void analytics.shutdown().finally(() => {
      // §F — if an update was downloaded + staged, apply it now (quit → swap → relaunch) instead of a
      // hard exit. app.exit(0) would BYPASS electron-updater's install step. This one branch serves BOTH
      // the "Restart now" button (which just calls app.quit()) AND a passive quit with a staged update
      // (autoInstallOnAppQuit). The `quitting` guard above no-ops the re-entrant before-quit that
      // quitAndInstall triggers.
      if (updater.isUpdateStaged()) updater.quitAndInstall()
      else app.exit(0) // flush the analytics tail, then really exit
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
