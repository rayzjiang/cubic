import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import type { BackendConfig } from './config.js'

export interface BackendExit {
  code: number | null
  signal: NodeJS.Signals | null
}

/**
 * Spawns + supervises the standalone backend (server/ae-bridge/build/serve.js) — the WS
 * bridge + agent loop the renderer talks to. Lifecycle owner only:
 *  - clean teardown on quit (SIGTERM → serve.ts's installShutdown frees the port),
 *  - logs all child output,
 *  - on an UNEXPECTED exit, emits `died` (observable hook) but does NOT auto-restart.
 *
 * Auto-restart + the reconnecting / connection-state UX are a later worktree (§B6); this
 * deliberately stops at making the failure observable.
 */
export class BackendSupervisor extends EventEmitter {
  private child: ChildProcess | null = null
  private intentionalStop = false

  constructor(private readonly config: BackendConfig) {
    super()
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
      return
    }

    this.intentionalStop = false
    // Run via Electron's bundled Node (ELECTRON_RUN_AS_NODE) so a packaged app needs no
    // system `node`; in dev this is the same binary running the app.
    this.child = spawn(process.execPath, [entry], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        AE_BRIDGE_PORT: String(this.config.port),
        ...this.config.childEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    this.child.stdout?.on('data', (d) => console.log('[backend]', d.toString().trimEnd()))
    this.child.stderr?.on('data', (d) => console.error('[backend]', d.toString().trimEnd()))

    this.child.on('error', (err) => this.emit('error', err))
    this.child.on('exit', (code, signal) => {
      const exit: BackendExit = { code, signal }
      this.child = null
      if (this.intentionalStop) {
        console.log('[backend] stopped cleanly', exit)
      } else {
        console.error('[backend] exited UNEXPECTEDLY (no auto-restart — see worktree ⑦)', exit)
        this.emit('died', exit)
      }
    })
  }

  /** Clean shutdown: SIGTERM the child — serve.ts handles it + frees the port. */
  stop(): void {
    if (!this.child) return
    this.intentionalStop = true
    this.child.kill('SIGTERM')
  }
}
