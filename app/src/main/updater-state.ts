// §F — pure state reducer for the auto-updater. Deliberately electron-free so the transitions are
// unit-testable in a plain node/vitest env (updater.ts holds the electron-updater glue and feeds these
// events in). Mirrors the billing/entitlement.ts ↔ entitlement.test.ts pure-logic split.

import type { UpdateState } from '../shared/ipc.js'

export const INITIAL_UPDATE_STATE: UpdateState = { phase: 'idle', version: null }

/** The autoUpdater signals we care about, normalized to a small tagged union. */
export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'progress' }
  | { type: 'downloaded'; version: string }
  | { type: 'none' } // update-not-available (already current)
  | { type: 'error' } // any updater failure — fail-silent

/**
 * Pure transition. Two invariants: (1) a staged update (`ready`) is STICKY — a later periodic check
 * (checking/none/error) must not wipe the "restart to update" state; (2) failures fail-SILENT — `error`
 * (and `none`) fall back to `idle`, never a surfaced error state. Returns the SAME reference when nothing
 * changes so the caller can dedupe broadcasts by identity.
 */
export function reduceUpdate(prev: UpdateState, event: UpdateEvent): UpdateState {
  switch (event.type) {
    case 'checking':
      if (prev.phase === 'ready' || prev.phase === 'checking') return prev
      return { phase: 'checking', version: null }
    case 'available':
      return { phase: 'available', version: event.version || null }
    case 'progress':
      if (prev.phase === 'downloading') return prev
      return { phase: 'downloading', version: prev.version }
    case 'downloaded':
      return { phase: 'ready', version: event.version || null }
    case 'none':
    case 'error':
      return prev.phase === 'ready' ? prev : INITIAL_UPDATE_STATE
    default:
      return prev
  }
}
