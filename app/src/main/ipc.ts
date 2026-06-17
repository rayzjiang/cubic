import { BrowserWindow, ipcMain } from 'electron'
import { CHANNELS, type BackendStatus } from '../shared/ipc.js'
import type { BackendConfig } from './config.js'
import type { BackendSupervisor } from './backend.js'

/**
 * §0 + §B6 — main↔renderer IPC. `getBackendPort` is the one port-discovery call (returns the SAME
 * port main spawned the backend with, so renderer + child never drift). `getBackendStatus` returns
 * the current backend-link status as a snapshot (for a renderer that mounts/reloads mid-run), and we
 * broadcast every `status` change so the dot updates live even while the renderer's own WS is down
 * (e.g. during a backend crash + reconnect). No filesystem access; the renderer stays sandboxed.
 */
export function registerIpc(config: BackendConfig, backend: BackendSupervisor): void {
  ipcMain.handle(CHANNELS.getBackendPort, () => config.port)
  ipcMain.handle(CHANNELS.getBackendStatus, () => backend.status)
  backend.on('status', (status: BackendStatus) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(CHANNELS.backendStatus, status)
    }
  })
}
