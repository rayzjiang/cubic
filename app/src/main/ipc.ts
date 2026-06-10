import { ipcMain } from 'electron'
import { CHANNELS } from '../shared/ipc.js'
import type { BackendConfig } from './config.js'

/**
 * §0 — the one port-discovery IPC. Returns the SAME port main spawned the backend with
 * (config.port), so renderer and child never drift. No filesystem access; the renderer
 * stays sandboxed and learns the port only through this call.
 */
export function registerIpc(config: BackendConfig): void {
  ipcMain.handle(CHANNELS.getBackendPort, () => config.port)
}
