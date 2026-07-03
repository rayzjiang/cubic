import { BrowserWindow, ipcMain } from 'electron'
import { CHANNELS, type AuthProvider, type AuthState, type BackendStatus } from '../shared/ipc.js'
import type { BackendConfig } from './config.js'
import type { BackendSupervisor } from './backend.js'
import type { AuthManager } from './auth.js'

/**
 * §0 + §B6 + §B + §??? — main↔renderer IPC. `getBackendPort` is the one connection-discovery call: it
 * resolves the backend's {port, token} once the child reports them up (see backend.whenReady) — the
 * renderer echoes the token in its first WS `hello` frame. `getBackendStatus` returns the current
 * backend-link status as a snapshot (for a renderer that mounts/reloads mid-run), and we broadcast every
 * `status` change so the dot updates live even while the renderer's own WS is down (e.g. during a
 * backend crash + reconnect). The auth surface mirrors that shape exactly: snapshot getters + a `change`
 * broadcast. No filesystem access; the renderer stays sandboxed.
 */
export function registerIpc(config: BackendConfig, backend: BackendSupervisor, auth: AuthManager): void {
  ipcMain.handle(CHANNELS.getBackendPort, () => backend.whenReady())
  ipcMain.handle(CHANNELS.getBackendStatus, () => backend.status)
  backend.on('status', (status: BackendStatus) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(CHANNELS.backendStatus, status)
    }
  })

  // §B auth. The renderer drives sign-in/out and reads state; main owns the Supabase session.
  ipcMain.handle(CHANNELS.getCubicEnv, () => config.cubicEnv)
  ipcMain.handle(CHANNELS.authSignIn, (_e, provider: AuthProvider) => auth.signIn(provider))
  ipcMain.handle(CHANNELS.authSignOut, () => auth.signOut())
  ipcMain.handle(CHANNELS.authGetState, () => auth.state)
  ipcMain.handle(CHANNELS.authGetAccessToken, () => auth.getAccessToken())
  auth.on('change', (state: AuthState) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(CHANNELS.authChanged, state)
    }
  })
}
