import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type AuthState, type BackendStatus, type BillingState, type CubicApi, type UpdateState } from '../shared/ipc.js'

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
  reconnectAe: () => ipcRenderer.invoke(CHANNELS.reconnectAe),
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
  getBillingDetails: () => ipcRenderer.invoke(CHANNELS.billingGetDetails),
  openInvoice: (url) => ipcRenderer.invoke(CHANNELS.billingOpenInvoice, url),
  onBillingChanged: (cb) => {
    const listener = (_e: unknown, state: BillingState): void => cb(state)
    ipcRenderer.on(CHANNELS.billingChanged, listener)
    return () => ipcRenderer.removeListener(CHANNELS.billingChanged, listener)
  },
  // §H — one-way send (no invoke): the renderer fires analytics events, main stamps identity + sends.
  trackEvent: (event, props) => ipcRenderer.send(CHANNELS.analyticsTrack, event, props),
  // §F auto-update — snapshot + subscribe (same shape as backend/auth/billing); restart is a one-way send.
  getUpdateState: () => ipcRenderer.invoke(CHANNELS.updateGetState),
  onUpdateChanged: (cb) => {
    const listener = (_e: unknown, state: UpdateState): void => cb(state)
    ipcRenderer.on(CHANNELS.updateChanged, listener)
    return () => ipcRenderer.removeListener(CHANNELS.updateChanged, listener)
  },
  restartToUpdate: () => ipcRenderer.send(CHANNELS.updateRestart),
}

contextBridge.exposeInMainWorld('cubic', api)
