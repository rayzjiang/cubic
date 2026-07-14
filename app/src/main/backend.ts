import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import type { BackendConfig } from './config.js'
import type { BackendStatus, BackendConn } from '../shared/ipc.js'
import type { InstallResult } from './installBridge.js'

export interface BackendExit {
  code: number | null
  signal: NodeJS.Signals | null
}

// Mirrors server/ae-bridge/src/startBackend.ts (EXIT_PORT_IN_USE) so main maps a port conflict by
// exit code instead of scraping stderr — distinct from a generic crash (exit 1).
const EXIT_PORT_IN_USE = 17
const MAX_RESTARTS = 3
const RESTART_BACKOFF_MS = [400, 1000, 2000]
// A child that stays alive this long is considered healthy → reset the restart budget. Decoupled
// from the renderer↔backend WS on purpose (the two links stay independent).
const SETTLED_MS = 3000

/**
 * Spawns + supervises the standalone backend (server/ae-bridge/build/serve.js). Owns the backend-link
 * lifecycle and exposes it as a `BackendStatus` (emitted on every change via the `status` event):
 *  - bounded auto-restart on an unexpected crash (`reconnecting` → `running`, or `stopped` after the
 *    budget), so a transient crash self-heals invisibly while the renderer shows "Reconnecting…",
 *  - a port conflict (child exit 17) is terminal `port-in-use` — NO restart (a respawn would just
 *    re-collide on the fixed port),
 *  - clean teardown on quit (SIGTERM → serve.ts's installShutdown frees the port).
 */
export class BackendSupervisor extends EventEmitter {
  private child: ChildProcess | null = null
  private intentionalStop = false
  private restarts = 0
  private restartTimer: NodeJS.Timeout | null = null
  private settleTimer: NodeJS.Timeout | null = null
  status: BackendStatus = { phase: 'starting', install: 'ok' }
  /** The backend-reported connection info ({port, token}), set on each `bridgeReady`. Null until the
   *  child first reports; re-set on every (re)start so a crash+restart hands out fresh values. */
  private conn: BackendConn | null = null

  constructor(private readonly config: BackendConfig) {
    super()
  }

  /** The current backend connection ({port, token}) or null if the child hasn't reported yet. */
  getConn(): BackendConn | null {
    return this.conn
  }

  /**
   * Non-destructive AE reconnect: re-write ~/.cubic/conn.json with the CURRENT {port, token} the child
   * already reported. Re-writing bumps the file's mtime, so the panel's `fs.watch` on ~/.cubic fires and
   * a dormant-but-alive panel reconnects (it re-reads conn.json + re-auths against the still-running
   * backend) — WITHOUT dropping in-flight turns or the renderer's WS. Same content + mode as the child's
   * own writer (wsBridge.ts). Returns false when the backend hasn't reported ready (nothing to poke with
   * → the user must reopen Cubic/AE); the panel-actually-landing signal is the `aeStatus` push.
   */
  repokeConn(): boolean {
    if (!this.conn) return false
    try {
      writeFileSync(join(homedir(), '.cubic', 'conn.json'), JSON.stringify(this.conn), { mode: 0o600 })
      return true
    } catch (err) {
      console.error('[backend] reconnect re-poke failed:', err)
      return false
    }
  }

  /** Resolve with {port, token} once the backend reports ready (immediately if already reported).
   *  Rejects on timeout so a dead backend surfaces as a failed connect instead of hanging forever;
   *  the renderer treats a rejection like a dropped socket and retries. */
  whenReady(timeoutMs = 8000): Promise<BackendConn> {
    if (this.conn) return Promise.resolve(this.conn)
    return new Promise((resolve, reject) => {
      const onReady = (conn: BackendConn): void => {
        clearTimeout(timer)
        resolve(conn)
      }
      const timer = setTimeout(() => {
        this.off('ready', onReady)
        reject(new Error('backend did not report ready in time'))
      }, timeoutMs)
      this.once('ready', onReady)
    })
  }

  private setStatus(patch: Partial<BackendStatus>): void {
    this.status = { ...this.status, ...patch }
    this.emit('status', this.status)
  }

  /** Fold the §B5 provisioning outcome into status. AE-only + non-blocking: 'failed' degrades AE
   *  connectivity (the dot), never the app; 'fresh'/'updated' = a copy happened → "restart AE" hint. */
  markInstall(result: InstallResult): void {
    if (result.outcome === 'failed') {
      console.error('[main] bridge provisioning failed:', result.error?.message)
      this.setStatus({ install: 'failed' })
    } else if (result.outcome === 'unchanged') {
      this.setStatus({ install: 'ok' })
    } else {
      this.setStatus({ install: 'updated' }) // fresh | updated
    }
  }

  /**
   * Absolute path to serve.js. Dev: walk up from out/main to the sibling server package.
   * Packaged (Phase 5, out of scope): electron-builder would ship serve.js under
   * resourcesPath/backend — branch kept as the seam, not implemented.
   */
  private resolveBackendEntry(): string {
    const here = dirname(fileURLToPath(import.meta.url)) // .../app/out/main
    const dev = join(here, '..', '..', '..', 'server', 'ae-bridge', 'build', 'serve.js')
    if (app.isPackaged) {
      const packaged = join(process.resourcesPath, 'backend', 'serve.js')
      if (existsSync(packaged)) return packaged
    }
    return dev
  }

  start(): void {
    if (this.child) return // already running
    const entry = this.resolveBackendEntry()
    if (!existsSync(entry)) {
      this.emit(
        'error',
        new Error(
          `Backend bundle not found at ${entry}. Build it first: ` +
            `(cd server/ae-bridge && npm run build:serve)`,
        ),
      )
      this.setStatus({ phase: 'stopped' })
      return
    }

    this.intentionalStop = false
    this.setStatus({ phase: this.restarts > 0 ? 'reconnecting' : 'starting' })
    // Run via Electron's bundled Node (ELECTRON_RUN_AS_NODE) so a packaged app needs no
    // system `node`; in dev this is the same binary running the app. The 4th stdio slot is an IPC
    // channel: the backend OS-assigns its own port + mints the session token, then reports {port,token}
    // back up here via `process.send` (see startBackend.ts). Any AE_BRIDGE_PORT override rides through
    // `...process.env` untouched — main no longer decides the port.
    this.child = spawn(process.execPath, [entry], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        ...this.config.childEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })

    this.child.stdout?.on('data', (d) => console.log('[backend]', d.toString().trimEnd()))
    this.child.stderr?.on('data', (d) => console.error('[backend]', d.toString().trimEnd()))

    this.child.on('message', (m: unknown) => {
      const msg = m as { type?: string; port?: number; token?: string }
      if (msg?.type === 'bridgeReady' && typeof msg.port === 'number' && typeof msg.token === 'string') {
        this.conn = { port: msg.port, token: msg.token }
        this.emit('ready', this.conn)
      }
    })

    this.child.on('error', (err) => this.emit('error', err))

    // If it survives the settle window it's healthy → reset the budget + mark running.
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      this.restarts = 0
      this.setStatus({ phase: 'running' })
    }, SETTLED_MS)

    this.child.on('exit', (code, signal) => {
      if (this.settleTimer) {
        clearTimeout(this.settleTimer)
        this.settleTimer = null
      }
      const exit: BackendExit = { code, signal }
      this.child = null
      this.conn = null // the reported port/token died with the child; the restart mints fresh ones

      if (this.intentionalStop) {
        console.log('[backend] stopped cleanly', exit)
        return
      }

      this.emit('died', exit)

      if (code === EXIT_PORT_IN_USE) {
        console.error('[backend] port in use — another Cubic is running; not restarting', exit)
        this.setStatus({ phase: 'port-in-use' })
        return
      }

      if (this.restarts < MAX_RESTARTS) {
        const delay = RESTART_BACKOFF_MS[this.restarts] ?? RESTART_BACKOFF_MS[RESTART_BACKOFF_MS.length - 1]
        this.restarts++
        console.error(`[backend] crashed; restart ${this.restarts}/${MAX_RESTARTS} in ${delay}ms`, exit)
        this.setStatus({ phase: 'reconnecting' })
        this.restartTimer = setTimeout(() => this.start(), delay)
      } else {
        console.error('[backend] crashed; restart budget exhausted — stopped', exit)
        this.setStatus({ phase: 'stopped' })
      }
    })
  }

  /** Clean shutdown: cancel any pending restart, SIGTERM the child — serve.ts frees the port. */
  stop(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    if (this.settleTimer) {
      clearTimeout(this.settleTimer)
      this.settleTimer = null
    }
    if (!this.child) return
    this.intentionalStop = true
    this.child.kill('SIGTERM')
  }
}
