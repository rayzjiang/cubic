import type { BillingState } from '@shared/ipc'
import { isBlocked } from './billing/entitlement'

/**
 * §D-1a — the file-access gate condition. Single source of truth (mirrors the role of
 * `billing/entitlement.ts`'s `isBlocked`): Cubic can't save frames / take pre-turn backups when AE's
 * "Allow Scripts to Write Files and Access Network" setting is off, so we hard-gate sending until it's on.
 *
 * True ONLY when:
 *  - AE is connected (`aeConnected`) — a disconnected panel can't be probed, and the AE-status dot owns
 *    that state; AND
 *  - we have an EXPLICIT `false` from the backend probe (`canWriteFiles === false`) — never on `null`
 *    (unknown / not yet checked), so the gate never flashes before we actually know; AND
 *  - the user is NOT subscription-blocked (`!isBlocked(billing)`) — the paywall takes precedence (a
 *    blocked user is stuck at the paywall, not this gate). This term also makes the gate work in local
 *    dev, where billing is `unavailable` → `isBlocked` is false.
 *
 * Takes a structural subset of the store state so `useChatStore(isFileBlocked)` can pass the full state.
 */
export function isFileBlocked(s: {
  aeConnected: boolean
  canWriteFiles: boolean | null
  billing: BillingState
}): boolean {
  return s.aeConnected && s.canWriteFiles === false && !isBlocked(s.billing)
}
