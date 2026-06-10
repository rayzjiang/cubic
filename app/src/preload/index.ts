import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type CubicApi } from '../shared/ipc.js'

// Sandbox-safe bridge: with sandbox:true the preload may use contextBridge + ipcRenderer
// but NOT fs/ws/arbitrary node — exactly the intent. The renderer touches main only
// through this minimal `window.cubic` surface.
const api: CubicApi = {
  getBackendPort: () => ipcRenderer.invoke(CHANNELS.getBackendPort),
}

contextBridge.exposeInMainWorld('cubic', api)
