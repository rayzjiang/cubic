import { app, BrowserWindow, ipcMain } from 'electron'
import { CHANNELS, type AuthProvider, type AuthState, type BackendStatus, type BillingState, type PlanId } from '../shared/ipc.js'
import type { BackendConfig } from './config.js'
import type { BackendSupervisor } from './backend.js'
import type { AuthManager } from './auth.js'
import type { BillingManager } from './billing.js'
import type { AnalyticsManager } from './analytics.js'

/**
 * §0 + §B6 + §B + §??? — main↔renderer IPC. `getBackendPort` is the one connection-discovery call: it
 * resolves the backend's {port, token} once the child reports them up (see backend.whenReady) — the
 * renderer echoes the token in its first WS `hello` frame. `getBackendStatus` returns the current
 * backend-link status as a snapshot (for a renderer that mounts/reloads mid-run), and we broadcast every
 * `status` change so the dot updates live even while the renderer's own WS is down (e.g. during a
 * backend crash + reconnect). The auth surface mirrors that shape exactly: snapshot getters + a `change`
 * broadcast. No filesystem access; the renderer stays sandboxed.
 */
export function registerIpc(config: BackendConfig, backend: BackendSupervisor, auth: AuthManager, billing: BillingManager, analytics: AnalyticsManager): void {
  ipcMain.handle(CHANNELS.getBackendPort, () => backend.whenReady())
  ipcMain.handle(CHANNELS.getBackendStatus, () => backend.status)
  // Non-destructive AE reconnect (§D-1a companion): re-poke conn.json to wake a dormant panel.
  ipcMain.handle(CHANNELS.reconnectAe, () => backend.repokeConn())
  backend.on('status', (status: BackendStatus) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(CHANNELS.backendStatus, status)
    }
  })

  ipcMain.handle(CHANNELS.getAppVersion, () => app.getVersion())

  // §B auth. The renderer drives sign-in/out and reads state; main owns the Supabase session.
  ipcMain.handle(CHANNELS.getCubicEnv, () => config.cubicEnv)
  ipcMain.handle(CHANNELS.authSignIn, (_e, provider: AuthProvider) => auth.signIn(provider))
  ipcMain.handle(CHANNELS.authSignOut, () => auth.signOut())
  ipcMain.handle(CHANNELS.authDeleteAccount, () => auth.deleteAccount())
  ipcMain.handle(CHANNELS.authGetState, () => auth.state)
  ipcMain.handle(CHANNELS.authGetAccessToken, () => auth.getAccessToken())
  auth.on('change', (state: AuthState) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(CHANNELS.authChanged, state)
    }
  })

  // §D billing/entitlement DISPLAY. Same shape as auth: snapshot getter + a `change` broadcast; the
  // renderer reads state + triggers Checkout/Portal, main owns the Supabase/Stripe calls.
  ipcMain.handle(CHANNELS.billingGetState, () => billing.snapshot)
  ipcMain.handle(CHANNELS.billingRefresh, () => billing.refresh())
  ipcMain.handle(CHANNELS.billingOpenCheckout, (_e, plan: PlanId) => billing.openCheckout(plan))
  ipcMain.handle(CHANNELS.billingOpenPortal, (_e, flow?: 'cancel' | 'update_card' | 'switch', plan?: PlanId) => billing.openPortal(flow, plan))
  ipcMain.handle(CHANNELS.billingGetDetails, () => billing.getBillingDetails())
  ipcMain.handle(CHANNELS.billingOpenInvoice, (_e, url: string) => billing.openInvoice(url))
  billing.on('change', (state: BillingState) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(CHANNELS.billingChanged, state)
    }
  })

  // §H analytics — one-way (fire-and-forget) forward of a renderer event to main, which stamps identity
  // + captures. `.on`, not `.handle`: the renderer needs no ack (see preload trackEvent).
  ipcMain.on(CHANNELS.analyticsTrack, (_e, event: string, props?: Record<string, unknown>) =>
    analytics.captureFromRenderer(event, props),
  )
}
