// Shared between main (handler) and preload (invoker). Single place that names the
// IPC channels + types the surface exposed to the renderer as `window.cubic`.

export const CHANNELS = {
  getBackendPort: 'cubic:getBackendPort',
} as const

/** The API the preload bridges onto `window.cubic` in the renderer. */
export interface CubicApi {
  /** The WS port the backend bound — resolved by main (the single source of truth). */
  getBackendPort(): Promise<number>
}
