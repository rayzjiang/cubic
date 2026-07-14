import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type AuthState, type BackendStatus, type BillingState, type CubicApi } from '../shared/ipc.js'

// Sandbox-safe bridge: with sandbox:true the preload may use contextBridge + ipcRenderer
// but NOT fs/ws/arbitrary node — exactly the intent. The renderer touches main only
// through this minimal `window.cubic` surface. (No supabase import here — all auth work is in main.)
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
  getAppVersion: () => ipcRenderer.invoke(CHANNELS.getAppVersion),
  getCubicEnv: () => ipcRenderer.invoke(CHANNELS.getCubicEnv),
  authSignIn: (provider) => ipcRenderer.invoke(CHANNELS.authSignIn, provider),
  authSignOut: () => ipcRenderer.invoke(CHANNELS.authSignOut),
  deleteAccount: () => ipcRenderer.invoke(CHANNELS.authDeleteAccount),
  getAuthState: () => ipcRenderer.invoke(CHANNELS.authGetState),
  getAccessToken: () => ipcRenderer.invoke(CHANNELS.authGetAccessToken),
  onAuthChanged: (cb) => {
    const listener = (_e: unknown, state: AuthState): void => cb(state)
    ipcRenderer.on(CHANNELS.authChanged, listener)
    return () => ipcRenderer.removeListener(CHANNELS.authChanged, listener)
  },
  getBilling: () => ipcRenderer.invoke(CHANNELS.billingGetState),
  refreshBilling: () => ipcRenderer.invoke(CHANNELS.billingRefresh),
  openCheckout: (plan) => ipcRenderer.invoke(CHANNELS.billingOpenCheckout, plan),
  openPortal: (flow, plan) => ipcRenderer.invoke(CHANNELS.billingOpenPortal, flow, plan),
  onBillingChanged: (cb) => {
    const listener = (_e: unknown, state: BillingState): void => cb(state)
    ipcRenderer.on(CHANNELS.billingChanged, listener)
    return () => ipcRenderer.removeListener(CHANNELS.billingChanged, listener)
  },
}

contextBridge.exposeInMainWorld('cubic', api)
