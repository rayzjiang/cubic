import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type BackendStatus, type CubicApi } from '../shared/ipc.js'

// Sandbox-safe bridge: with sandbox:true the preload may use contextBridge + ipcRenderer
// but NOT fs/ws/arbitrary node — exactly the intent. The renderer touches main only
// through this minimal `window.cubic` surface.
const api: CubicApi = {
  getBackendPort: () => ipcRenderer.invoke(CHANNELS.getBackendPort),
  getBackendStatus: () => ipcRenderer.invoke(CHANNELS.getBackendStatus),
  onBackendStatus: (cb) => {
    // Strip the IpcRendererEvent before handing the payload to the renderer (never expose the raw
    // event), and return an unsubscribe so the renderer can clean up on unmount.
    const listener = (_e: unknown, status: BackendStatus): void => cb(status)
    ipcRenderer.on(CHANNELS.backendStatus, listener)
    return () => ipcRenderer.removeListener(CHANNELS.backendStatus, listener)
  },
}

contextBridge.exposeInMainWorld('cubic', api)
