// §F — auto-update (electron-updater). One UpdateManager in main, mirroring AuthManager/BillingManager:
// an EventEmitter with a `snapshot` getter + a `change` broadcast. Wraps electron-updater's autoUpdater,
// downloads a new version silently in the background, and STAGES it to apply on the next restart (never
// mid-run). All electron/electron-updater specifics live here; the pure transitions live in
// updater-state.ts. The feed URL is NOT here — electron-builder bakes it into app-update.yml from the
// electron-builder.yml `publish` block, and autoUpdater reads that.

import { EventEmitter } from 'node:events'
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '../shared/ipc.js'
import { INITIAL_UPDATE_STATE, reduceUpdate, type UpdateEvent } from './updater-state.js'

// electron-updater is CommonJS; under ESM the named `autoUpdater` export isn't reliably synthesized, so
// take it off the default import (the documented electron-updater ESM pattern).
const { autoUpdater } = electronUpdater

// Re-check cadence while the app stays open (video editors keep it running for days) — a launch-only
// check would never learn of an update mid-session. Background + cheap (one latest-mac.yml fetch/tick);
// the swap still only applies on restart.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
// Small delay after launch so the first check never competes with cold-start work (window/backend/auth).
const INITIAL_CHECK_DELAY_MS = 10_000

export class UpdateManager extends EventEmitter {
  private state: UpdateState = INITIAL_UPDATE_STATE
  private timer: NodeJS.Timeout | null = null
  private initial: NodeJS.Timeout | null = null
  private started = false

  /** Current update state — the snapshot returned over IPC and the payload of every `change` event. */
  get snapshot(): UpdateState {
    return this.state
  }

  /** True once an update is downloaded + staged. The before-quit handler (index.ts) routes through
   *  quitAndInstall() instead of a hard app.exit(0) when this is true, so the staged update applies. */
  isUpdateStaged(): boolean {
    return this.state.phase === 'ready'
  }

  /** Begin background update checks. No-op unless packaged — electron-updater can't self-update a dev run
   *  (Squirrel needs the real signed .app) — except with the CUBIC_UPDATER_DEV=1 escape hatch for local
   *  testing against a dev-app-update.yml. Idempotent. */
  start(): void {
    if (this.started) return
    const devForce = process.env.CUBIC_UPDATER_DEV === '1'
    if (!app.isPackaged && !devForce) return
    this.started = true

    autoUpdater.autoDownload = true // silent background download
    autoUpdater.autoInstallOnAppQuit = true // "Later" + a normal quit still updates on next launch
    // Route electron-updater's own diagnostics to the console (visible when the app is launched from a
    // terminal). Without this the whole flow is a black box — no way to tell "checking" from "downloading"
    // from a silent verify failure. Cheap + prod-safe (stderr goes nowhere for a Finder launch).
    autoUpdater.logger = console
    if (devForce) autoUpdater.forceDevUpdateConfig = true

    autoUpdater.on('checking-for-update', () => {
      console.log('[updater] checking for updates…')
      this.apply({ type: 'checking' })
    })
    autoUpdater.on('update-available', (info: { version?: string }) => {
      console.log('[updater] update available:', info?.version)
      this.apply({ type: 'available', version: info?.version ?? '' })
    })
    autoUpdater.on('update-not-available', () => {
      console.log('[updater] no update (already current)')
      this.apply({ type: 'none' })
    })
    let lastPct = -1
    autoUpdater.on('download-progress', (p: { percent?: number }) => {
      const pct = Math.floor(p?.percent ?? 0)
      if (pct >= lastPct + 10) {
        console.log(`[updater] downloading ${pct}%`)
        lastPct = pct
      }
      this.apply({ type: 'progress' })
    })
    autoUpdater.on('update-downloaded', (info: { version?: string }) => {
      console.log('[updater] downloaded + staged:', info?.version, '→ quit/restart to apply')
      this.apply({ type: 'downloaded', version: info?.version ?? '' })
    })
    // Fail-silent for the UI, but ALWAYS log so a feed outage / offline / signature mismatch is visible.
    autoUpdater.on('error', (err: Error) => {
      console.error('[updater] error:', err?.message ?? err)
      this.apply({ type: 'error' })
    })

    console.log(`[updater] started (packaged=${app.isPackaged}, first check in ${INITIAL_CHECK_DELAY_MS / 1000}s)`)
    this.initial = setTimeout(() => this.check(), INITIAL_CHECK_DELAY_MS)
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS)
  }

  /** Apply the staged update now: quit → swap → relaunch into the new version. Called from the before-quit
   *  install branch in index.ts — either via the "Restart now" button (app.quit()) or a passive quit with
   *  a staged update. isSilent=true (no extra Squirrel UI), isForceRunAfter=true (relaunch after install). */
  quitAndInstall(): void {
    autoUpdater.quitAndInstall(true, true)
  }

  /** Stop the timers (call on quit so nothing keeps the process alive). */
  dispose(): void {
    if (this.initial) clearTimeout(this.initial)
    if (this.timer) clearInterval(this.timer)
    this.initial = null
    this.timer = null
  }

  private check(): void {
    console.log('[updater] running check…')
    // checkForUpdates() rejects on a network/feed error AND fires 'error'; swallow the reject so it can't
    // surface as an unhandled rejection.
    void autoUpdater.checkForUpdates().catch((err: Error) => {
      console.error('[updater] check failed:', err?.message ?? err)
    })
  }

  private apply(event: UpdateEvent): void {
    const next = reduceUpdate(this.state, event)
    if (next === this.state) return // reduceUpdate returns the same ref on a no-op
    this.state = next
    this.emit('change', this.state)
  }
}
