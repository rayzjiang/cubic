import { app, BrowserWindow } from 'electron'
import { loadConfig } from './config.js'
import { createWindow } from './window.js'
import { buildAppMenu } from './menu.js'
import { registerIpc } from './ipc.js'
import { BackendSupervisor } from './backend.js'

// Single-instance lock FIRST — load-bearing: a 2nd instance would spawn a 2nd backend that
// hard-fails binding the fixed port 17923 (no fallback). The 2nd process quits immediately;
// the existing window just refocuses.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  const config = loadConfig()
  const backend = new BackendSupervisor(config)

  // Observability only — no auto-restart here (worktree ⑦ owns recovery + connection UX).
  backend.on('died', (exit) =>
    console.error('[main] backend died; not restarting (worktree ⑦):', exit),
  )
  backend.on('error', (err: Error) => console.error('[main] backend error:', err.message))

  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    registerIpc(config)
    buildAppMenu()
    backend.start()
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
