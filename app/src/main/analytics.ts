// §H — PostHog product analytics, owned entirely by the main process. This is the ONE place that
// holds the PostHog client, stamps identity, and captures — the renderer and the backend child both
// forward their raw events here (over IPC) and main sends them. Main is the only process that always
// holds a verified user id (auth.ts), so every event is attributed correctly; posthog-node has no
// autocapture, so it can only ever send the explicit, whitelisted fields below — prompt text and AE
// project content can never leak. Computes no statistics: PostHog does all funnels/retention/ranking.
//
// Kill switch: disabled unless a key is set AND CUBIC_ANALYTICS !== 'off' (config.analyticsEnabled) —
// so dev is OFF by default (leave POSTHOG_KEY unset), a verify session sets it, prod bakes it.

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { PostHog } from 'posthog-node'
import type { BackendConfig } from './config.js'

// The only events we send. Anything else (the legacy renderer `track()` names — message_sent,
// turn_done, …) is silently dropped, so those call sites cost nothing and stay ready for later.
const ALLOWED_EVENTS = new Set([
  'app_opened',
  'signed_in',
  'ae_connected',
  'first_prompt_sent',
  'first_edit_succeeded',
  'paywall_hit',
  'command_run',
  'config_value_rejected',
])

// Per-event property whitelist — the privacy guarantee by construction: only these keys are forwarded,
// so even if a caller passes extra props (or content) they are stripped before send. Events not listed
// carry no custom props. `is_edit` is deliberately NOT whitelisted on command_run: it drives the
// first_edit_succeeded derivation here in main but never needs to be a stored property.
const PROP_WHITELIST: Record<string, readonly string[]> = {
  paywall_hit: ['reason'],
  command_run: ['command', 'ok', 'error_code', 'noop', 'retried', 'via_batch', 'session_id', 'turn_id'],
  first_edit_succeeded: ['command'],
  // §G-? — which Worker-override key was ignored and what value was rejected. Both are OUR OWN config
  // (a model id or a tuning number), never user or project content, so this stays inside the privacy
  // guarantee. `app_version` rides on every event automatically, which is the point: bounds are baked
  // per version, so this is how a widened bound rejected by older installs becomes visible.
  config_value_rejected: ['key', 'value'],
}

export class AnalyticsManager {
  private readonly client: PostHog | null
  private readonly cubicEnv: string
  /** Anonymous per-install id used as distinct_id while signed out; rotated on sign-out so a different
   *  account on this device is never merged with the previous one. */
  private anonId: string
  private currentUserId: string | null = null
  /** distinct_ids that have already fired first_edit_succeeded (persisted → "once per user, ever"). */
  private readonly firstEditDone: Set<string>

  constructor(config: BackendConfig) {
    this.cubicEnv = config.cubicEnv
    let client: PostHog | null = null
    if (config.analyticsEnabled) {
      try {
        client = new PostHog(config.posthogKey, {
          host: config.posthogHost,
          flushAt: 20, // batch; command_run can fan out per batch sub-verb
          flushInterval: 30_000, // long desktop sessions — before-quit flushes the tail
        })
      } catch {
        client = null // a client-construction failure must NEVER crash app startup — analytics stays off
      }
    }
    this.client = client
    // Only mint the anonymous id + read first-edit state when analytics is actually on. When off (no
    // key, or the client failed to construct) every method no-ops on the null client, so these are never
    // read — don't touch disk or create an analytics identity for a disabled analytics system.
    this.anonId = client ? this.loadOrCreateAnonId() : ''
    this.firstEditDone = client ? this.loadFirsts() : new Set<string>()
  }

  /** On the signed-out→signed-in transition: alias the pre-sign-in anonymous events (app_opened, …) to
   *  this user so they stitch onto the person, then identify so later events carry the user id.
   *  `interactive` = the user actually completed the sign-in flow this launch (vs a silent session
   *  restore) → only then fire `signed_in`, so the app_opened→signed_in funnel measures real sign-in
   *  friction and isn't inflated by returning users' auto-restores. */
  onSignIn(userId: string, interactive: boolean): void {
    if (!this.client || this.currentUserId === userId) return
    try {
      this.client.alias({ distinctId: userId, alias: this.anonId })
      this.client.identify({ distinctId: userId })
    } catch {
      /* analytics never throws into the app */
    }
    this.currentUserId = userId
    if (interactive) this.capture('signed_in', undefined, 'main')
  }

  /** On sign-out: drop the user id and rotate to a fresh anonymous id (avoids cross-account merges). */
  onSignOut(): void {
    if (!this.client) return
    this.currentUserId = null
    this.anonId = this.rotateAnonId()
  }

  captureFromRenderer(event: string, props?: Record<string, unknown>): void {
    if (!this.client) return
    this.capture(event, props, 'renderer')
  }

  captureFromBackend(event: string, props?: Record<string, unknown>): void {
    if (!this.client) return
    this.capture(event, props, 'backend')
    // first_edit_succeeded is derived here so READ_ONLY_COMMANDS + the edit classification stay in the
    // backend (executeTool), while the "once per user" guard lives where identity + persistence are.
    if (event === 'command_run' && props?.is_edit === true) this.maybeFirstEdit(props.command)
  }

  /**
   * §G-? — a Worker-override value this install refused (out of range / wrong type) and fell back from.
   * The rejection happens on the USER's machine, so a console log is invisible to us; this is the only
   * way it surfaces. Should be ~never: proxy/tests/config.test.ts gates a bad value before deploy.
   */
  onConfigRejected(rejections: readonly { key: string; value: unknown }[]): void {
    if (!this.client) return
    for (const r of rejections) this.capture('config_value_rejected', { key: r.key, value: r.value }, 'main')
  }

  /** Flush + stop the client (call on app quit before the process exits). */
  async shutdown(): Promise<void> {
    if (!this.client) return
    // Cap the flush so a hung/slow network can NEVER block app quit. posthog-node's shutdown has its
    // own timeout, but race a hard 2.5s fallback so before-quit always proceeds; any un-flushed events
    // are simply dropped (analytics is best-effort).
    try {
      await Promise.race([
        this.client.shutdown(),
        new Promise<void>((resolve) => setTimeout(resolve, 2500)),
      ])
    } catch {
      /* best-effort flush on quit */
    }
  }

  // ── internals ──

  private maybeFirstEdit(command: unknown): void {
    const id = this.distinctId()
    if (this.firstEditDone.has(id)) return
    this.firstEditDone.add(id)
    this.persistFirsts()
    this.capture('first_edit_succeeded', typeof command === 'string' ? { command } : {}, 'backend')
  }

  private capture(event: string, props: Record<string, unknown> | undefined, source: 'renderer' | 'backend' | 'main'): void {
    if (!this.client || !ALLOWED_EVENTS.has(event)) return
    const allowed = PROP_WHITELIST[event] ?? []
    const properties: Record<string, unknown> = {}
    if (props) for (const k of allowed) if (props[k] !== undefined) properties[k] = props[k]
    properties.source = source
    properties.cubic_env = this.cubicEnv
    try {
      properties.app_version = app.getVersion() // inside the try: keep every throwable inside the guard
      this.client.capture({ distinctId: this.distinctId(), event, properties })
    } catch {
      /* analytics never throws into the app */
    }
  }

  private distinctId(): string {
    return this.currentUserId ?? this.anonId
  }

  // ── anonymous id + first-edit persistence (userData; mode 0600) ──

  private get anonPath(): string {
    return join(app.getPath('userData'), 'analytics-id')
  }

  private get firstsPath(): string {
    return join(app.getPath('userData'), 'analytics-firsts.json')
  }

  private loadOrCreateAnonId(): string {
    try {
      if (existsSync(this.anonPath)) {
        const v = readFileSync(this.anonPath, 'utf8').trim()
        if (v) return v
      }
    } catch {
      /* fall through to a fresh id */
    }
    return this.rotateAnonId()
  }

  private rotateAnonId(): string {
    const id = randomUUID()
    try {
      writeFileSync(this.anonPath, id, { mode: 0o600 })
    } catch {
      /* in-memory only if userData is unwritable — non-fatal */
    }
    return id
  }

  private loadFirsts(): Set<string> {
    try {
      if (existsSync(this.firstsPath)) {
        const arr = JSON.parse(readFileSync(this.firstsPath, 'utf8')) as unknown
        if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === 'string'))
      }
    } catch {
      /* malformed → start empty (worst case: first_edit re-fires once) */
    }
    return new Set()
  }

  private persistFirsts(): void {
    try {
      writeFileSync(this.firstsPath, JSON.stringify([...this.firstEditDone]), { mode: 0o600 })
    } catch {
      /* best-effort */
    }
  }
}
