// Shared between main (handler) and preload (invoker). Single place that names the
// IPC channels + types the surface exposed to the renderer as `window.cubic`.

export const CHANNELS = {
  getBackendPort: 'cubic:getBackendPort',
  getBackendStatus: 'cubic:getBackendStatus',
  backendStatus: 'cubic:backendStatus',
} as const

/**
 * Backend-link state, owned by main and pushed to the renderer over IPC. This is DISTINCT from the
 * renderer's own WS link (`connection` in ws.ts) and from AE-worker liveness (`aeConnected`, pushed by
 * the backend over the WS as `aeStatus`). It must come from main because during a backend crash the
 * renderer's WS is down — so it can't learn "the backend is reconnecting" over that socket.
 *  - phase: lifecycle of the spawned backend child.
 *      starting     — initial spawn, not yet confirmed healthy
 *      running      — child alive + settled
 *      reconnecting — child died, bounded auto-restart in flight
 *      port-in-use  — child exited EADDRINUSE (blocking; another Cubic is running)
 *      stopped      — auto-restart budget exhausted (blocking; reopen the app)
 *  - install: provisioning outcome (AE-only, NEVER blocks the app).
 *      ok      — extension already current
 *      updated — a copy happened this launch (fresh install or changed) → renderer may show "restart AE"
 *      failed  — provisioning threw → "Couldn't install — restart Cubic"
 */
export type BackendPhase = 'starting' | 'running' | 'reconnecting' | 'port-in-use' | 'stopped'
export type InstallState = 'ok' | 'updated' | 'failed'
export interface BackendStatus {
  phase: BackendPhase
  install: InstallState
}

/** The API the preload bridges onto `window.cubic` in the renderer. */
export interface CubicApi {
  /** The WS port the backend bound — resolved by main (the single source of truth). */
  getBackendPort(): Promise<number>
  /** Current backend-link status (snapshot) — for a renderer that mounts/reloads mid-run. */
  getBackendStatus(): Promise<BackendStatus>
  /** Subscribe to backend-link status pushes. Returns an unsubscribe fn. */
  onBackendStatus(cb: (status: BackendStatus) => void): () => void
}
