import { app, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.js'
import { createWindow } from './window.js'
import { buildAppMenu } from './menu.js'
import { registerIpc } from './ipc.js'
import { BackendSupervisor } from './backend.js'
import { provisionBridge } from './installBridge.js'

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
// hard-fails binding the fixed port 17923 (no fallback). The 2nd process quits immediately;
// the existing window just refocuses.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  const config = loadConfig()
  const backend = new BackendSupervisor(config)

  // Backend crash recovery + connection-state UX now live in the supervisor (§B6): it bounded-restarts
  // and emits `status` (broadcast to the renderer by registerIpc). Keep only spawn-error logging here.
  backend.on('error', (err: Error) => console.error('[main] backend error:', err.message))

  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    // §B5 — provision the AE bridge (idempotent, content-hash gated) BEFORE the backend/UI come up.
    // Never throws; a failure only degrades AE connectivity (the status dot), never blocks launch.
    const install = await provisionBridge()
    registerIpc(config, backend) // subscribe to status before markInstall/start so pushes broadcast
    backend.markInstall(install)
    buildAppMenu()
    backend.start()
    runDevPreflight() // dev-only; non-blocking, quits the app if the panel was stale + reloaded
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // SIGTERM the child on quit so it frees the WS port (serve.ts's installShutdown).
  app.on('before-quit', () => {
    backend.stop()
    preflightChild?.kill() // don't leave a dev preflight waiter polling after the app quits
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
