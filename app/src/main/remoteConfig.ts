// §G-? prod config — the client half of the Worker-override channel.
//
// A packaged app has an EMPTY process.env, so the frozen public values are BAKED into the build
// (app/.env.production → electron-vite define, see config.ts). A handful of values we want live control
// over instead come from the Worker's `GET /config` — changed with a `wrangler deploy` instead of an app
// release + auto-update rollout.
//
// STALE-WHILE-REVALIDATE, mirroring Firebase Remote Config, and NEVER on the per-request path:
//   1. at launch, read the disk cache SYNCHRONOUSLY and use it immediately (no network on the startup
//      path — loadConfig() feeds these into childEnv before the backend child is spawned);
//   2. later, in the background, fire ONE GET /config and write the result to disk.
// So a fetched value applies at the NEXT launch, not this one. That is deliberate: nothing blocks
// startup, nothing changes mid-session. The instant lever is the Worker's FORCE_MODEL, which rewrites
// the model server-side on the next request (see proxy/src/config.ts).
//
// Pure SWR: a present, parseable cache is used no matter how old. The min-interval floor rate-limits the
// REFRESH; it never invalidates the cache for use. A value set in the Worker therefore sticks until the
// next successful fetch instead of silently reverting because a user was away or the Worker blipped.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** The values the Worker may override. Mirrors `RemoteConfig` in proxy/src/config.ts. */
export interface RemoteConfig {
  model?: string
  maxIters?: number
  compactThreshold?: number
  keepRecentTurns?: number
  contextWindow?: number
}

/** A value the Worker sent (or the cache held) that failed validation and was ignored. */
export interface ConfigRejection {
  key: string
  value: unknown
}

/**
 * Which env var each key becomes when forwarded into the backend child. The child ALREADY reads every
 * one of these from process.env (agentChat.ts for the tuning knobs, defaultModel() for the model), so
 * "applying" remote config is just main populating these — no new consumer code.
 */
export const CONFIG_ENV_VARS: Record<keyof RemoteConfig, string> = {
  model: 'CUBIC_MODEL',
  maxIters: 'CUBIC_MAX_ITERATIONS',
  compactThreshold: 'CUBIC_COMPACT_THRESHOLD',
  keepRecentTurns: 'CUBIC_KEEP_RECENT_TURNS',
  contextWindow: 'CUBIC_CONTEXT_WINDOW',
}

/**
 * SANITY bounds — garbage guards, NOT policy. They reject -5 / 0 / NaN / "abc" / absurd magnitudes and
 * nothing else: every value we'd plausibly ship sits well inside them, so a real decision never trips
 * one. MIRRORS proxy/src/config.ts (the same duplicate-plus-guard-test pattern as MODEL_PRICING);
 * proxy/tests/config.test.ts is the pre-deploy gate that keeps the Worker's copy honest.
 *
 * `model` is deliberately NOT checked against a model list — that would re-couple "add a model" to an
 * app release, on the value most likely to change. ALLOWED_MODELS in the Worker is the real gate.
 *
 * NOTE these bounds are baked per app VERSION. Widening one only reaches users who have updated, so an
 * older install can reject a value newer builds accept — which is exactly why a rejection is reported to
 * analytics rather than only logged locally.
 */
const BOUNDS: Record<string, { min: number; max: number; int: boolean }> = {
  maxIters: { min: 1, max: 100, int: true },
  compactThreshold: { min: 0.3, max: 0.98, int: false },
  keepRecentTurns: { min: 1, max: 50, int: true },
  contextWindow: { min: 10_000, max: 2_000_000, int: true },
}

/** Sits beside the backend's own ~/.cubic files (conn.json, sessions/). */
const CACHE_PATH = join(homedir(), '.cubic', 'remote-config.json')
/** Don't re-fetch more often than this, so rapid relaunches can't spam the Worker (Firebase RC's default). */
const MIN_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000
/** A background fetch that hangs must not linger; nothing waits on it, so this is just hygiene. */
const FETCH_TIMEOUT_MS = 10_000

interface CacheFile {
  fetchedAt: number
  config: RemoteConfig
}

/** True when `value` is a usable value for `key`. Unknown keys are never accepted. */
function isValid(key: string, value: unknown): boolean {
  if (key === 'model') return typeof value === 'string' && value.trim() !== ''
  const bound = BOUNDS[key]
  if (!bound) return false
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (bound.int && !Number.isInteger(value)) return false
  return value >= bound.min && value <= bound.max
}

/**
 * Keep the valid keys of `incoming`, dropping the rest.
 *
 * `previous` (the last known-good cache) backstops a key that is PRESENT but INVALID, so one bad push
 * doesn't drop users all the way to the baked default. A key that is ABSENT is genuinely absent —
 * removing it from the Worker's CONFIG is how you revert clients to the baked default, so it must not be
 * resurrected from the cache.
 */
export function validateConfig(incoming: unknown, previous: RemoteConfig = {}): { config: RemoteConfig; rejected: ConfigRejection[] } {
  const config: RemoteConfig = {}
  const rejected: ConfigRejection[] = []
  if (!incoming || typeof incoming !== 'object') return { config, rejected }
  const raw = incoming as Record<string, unknown>
  for (const key of Object.keys(CONFIG_ENV_VARS) as (keyof RemoteConfig)[]) {
    if (!(key in raw)) continue
    const value = raw[key]
    if (isValid(key, value)) {
      ;(config as Record<string, unknown>)[key] = value
    } else {
      rejected.push({ key, value })
      const fallback = previous[key]
      if (fallback !== undefined) (config as Record<string, unknown>)[key] = fallback
    }
  }
  return { config, rejected }
}

/** Parse the cache file, or null when absent/corrupt (→ baked defaults, never a throw). */
function readCacheFile(): CacheFile | null {
  try {
    if (!existsSync(CACHE_PATH)) return null
    const parsed = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as Partial<CacheFile>
    if (!parsed || typeof parsed !== 'object') return null
    return { fetchedAt: typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : 0, config: (parsed.config ?? {}) as RemoteConfig }
  } catch (e) {
    console.warn('[config] remote-config cache unreadable — using baked defaults:', (e as Error).message)
    return null
  }
}

/**
 * The cached override values, validated. Synchronous + tiny by design: loadConfig() calls this on the
 * startup path, before the backend child is spawned. Re-validating on READ (not just on fetch) matters
 * because the cache is a plain JSON file in the user's home directory — it is hand-editable.
 */
export function readCachedConfig(): { config: RemoteConfig; rejected: ConfigRejection[] } {
  const cached = readCacheFile()
  if (!cached) return { config: {}, rejected: [] }
  return validateConfig(cached.config)
}

/**
 * ONE background `GET <proxyUrl>/config` → validate → write to disk for the next launch. Resolves to the
 * rejected values (for analytics). NEVER throws and nothing awaits its effect: an offline user, a 404, or
 * a hung Worker simply leaves the existing cache in place.
 *
 * Only valid keys are persisted, so the cache is always known-good and a bad push can never be "stuck"
 * on disk in a form the reader has to defend against twice.
 */
export async function refreshRemoteConfig(proxyUrl: string): Promise<ConfigRejection[]> {
  if (!proxyUrl) return []
  const cached = readCacheFile()
  if (cached && Date.now() - cached.fetchedAt < MIN_REFRESH_INTERVAL_MS) return []
  try {
    const res = await fetch(`${proxyUrl.replace(/\/$/, '')}/config`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.warn(`[config] /config returned ${res.status} — keeping cached values`)
      return []
    }
    const { config, rejected } = validateConfig(await res.json(), cached?.config ?? {})
    for (const r of rejected) {
      console.warn(`[config] rejected out-of-range value for ${r.key}: ${JSON.stringify(r.value)}`)
    }
    mkdirSync(dirname(CACHE_PATH), { recursive: true })
    writeFileSync(CACHE_PATH, JSON.stringify({ fetchedAt: Date.now(), config } satisfies CacheFile, null, 2), 'utf8')
    return rejected
  } catch (e) {
    // Offline, DNS failure, timeout, malformed JSON — all non-events. The cache (or the baked defaults)
    // already carried this launch; we simply try again next launch.
    console.warn('[config] /config refresh failed — keeping cached values:', (e as Error).message)
    return []
  }
}
