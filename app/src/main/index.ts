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
 * DEV-ONLY: ensure the open AE panel runs the latest handler bundle. The panel bakes its bundle in
 * at open, so editing a .jsx doesn't take effect until it reloads. After the backend is up (so the
 * panel can reconnect + be queried), the preflight rebuilds from source; if the panel is stale it
 * reloads it and exits 1 — we then quit so the dev re-runs clean. Runs non-blocking so a fresh panel
 * (or AE closed) never delays launch. No-op when packaged (prod auto-updater handles real users).
 */
function runDevPreflight(): void {
  if (app.isPackaged) return
  const here = dirname(fileURLToPath(import.meta.url)) // app/out/main
  const script = join(here, '..', '..', '..', 'server', 'ae-bridge', 'scripts', 'preflight-panel.mjs')
  if (!existsSync(script)) return
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  child.on('exit', (code) => {
    if (code === 1) {
      console.error('[main] AE panel was running a stale bundle — rebuilt + reloaded it. Re-run `npm run dev`.')
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
  app.on('before-quit', () => backend.stop())

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
