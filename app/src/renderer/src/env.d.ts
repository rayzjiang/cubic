/// <reference types="vite/client" />
import type { CubicApi } from '@shared/ipc'

declare global {
  interface Window {
    cubic: CubicApi
  }
}

export {}
