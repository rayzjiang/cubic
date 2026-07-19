/**
 * §G-? prod config — the Worker-override half.
 *
 * A packaged app has an EMPTY `process.env`, so every config value needs a prod home. The frozen public
 * values are BAKED into the build (`app/.env.production` → electron-vite `define`); the handful of values
 * we want live control over are served from HERE, at `GET /config`.
 *
 * Change a value = edit this file + `npm run deploy` (which runs the bounds test first). No app release,
 * no auto-update rollout. The client fetches this once per launch, caches it to disk, and applies it at
 * the NEXT launch (stale-while-revalidate) — so none of this is ever on the per-request path.
 *
 * Every key is OPTIONAL. An omitted key means "the client keeps what it already has" — its last cached
 * value, else the baked in-code default. That is the normal state: an empty `CONFIG` means every client
 * behaves exactly as it does today.
 */

/** The values the Worker may override on the client. Each maps to an env var the backend already reads. */
export interface RemoteConfig {
  /** → `CUBIC_MODEL`. A full model id or a friendly alias (`sonnet`|`sonnet5`|`haiku`|`opus`). */
  model?: string;
  /** → `CUBIC_MAX_ITERATIONS`. The agent loop's per-turn iteration budget. */
  maxIters?: number;
  /** → `CUBIC_COMPACT_THRESHOLD`. Fraction of the context window that triggers compaction. */
  compactThreshold?: number;
  /** → `CUBIC_KEEP_RECENT_TURNS`. Turns kept verbatim through a compaction. */
  keepRecentTurns?: number;
  /** → `CUBIC_CONTEXT_WINDOW`. Overrides the per-model window used for the compaction math. */
  contextWindow?: number;
}

/**
 * SANITY bounds — garbage guards, NOT policy. They exist to reject `-5`, `0`, `NaN`, `"abc"` and absurd
 * magnitudes; they must never second-guess a real decision, so every value you'd plausibly ship sits well
 * inside them. Widening one costs an app release (the client's copy is baked per version), which is
 * exactly why they're set generously rather than at the values we actually expect to use.
 *
 * MIRRORED in `app/src/main/remoteConfig.ts` — the same duplicate-plus-guard-test pattern already used
 * for `MODEL_PRICING` (see `metering.ts`). `tests/config.test.ts` keeps this copy honest.
 *
 * `model` is deliberately NOT checked against a model list: doing so would re-couple "add a model" to an
 * app release, on the value most likely to change. `ALLOWED_MODELS` (metering.ts) is the real gate, and
 * it lives server-side where a `wrangler deploy` updates it.
 */
export const BOUNDS = {
  maxIters: { min: 1, max: 100, int: true },
  compactThreshold: { min: 0.3, max: 0.98, int: false },
  keepRecentTurns: { min: 1, max: 50, int: true },
  contextWindow: { min: 10_000, max: 2_000_000, int: true },
} as const;

/** HERE HERE HERE
 * THE LIVE CONFIG — what every client fetches. Empty means "keep the baked defaults", i.e. today's
 * behavior. Set a key + `npm run deploy` to roll it out; it lands on each user's *next* launch after the
 * one that fetches it (see the SWR note above), so it is not an instant control — `FORCE_MODEL` is.
 */
export const CONFIG: RemoteConfig = {};

/**
 * EMERGENCY BRAKE — normally `undefined`, and it should stay that way.
 *
 * Unlike `CONFIG`, this is NOT served to clients: the Worker applies it server-side by rewriting
 * `body.model` on every request, so it takes effect on the very NEXT request for every user — no
 * relaunch, no config propagation, no waiting. Use it only to pull a bad model immediately. The ordinary
 * way to change the model is `CONFIG.model`.
 *
 * Must be a member of `ALLOWED_MODELS` or the gate would 400 every request and metering would have no
 * price for it — `tests/config.test.ts` enforces that.
 */
export const FORCE_MODEL: string | undefined = undefined;

/**
 * Per-model `thinking` param, applied when `FORCE_MODEL` rewrites the model. MIRRORS
 * `MODEL_REQUEST_CONFIG` in `server/ai/src/llm/anthropic.ts`: a model absent here sends no `thinking`
 * param, but Sonnet 5 MUST send `{type:'disabled'}` explicitly — omitting it silently enables adaptive
 * thinking at high effort and burns extra output tokens every turn. Without this, forcing a client from
 * 4-6 onto 5 would quietly change the cost profile of every request.
 */
const MODEL_THINKING: Record<string, { type: string }> = {
  'claude-sonnet-5': { type: 'disabled' },
};

/**
 * Rewrite the request body onto `FORCE_MODEL` (+ its thinking preset). No-op when the brake is off.
 * Mutates `body` in place; the caller re-reads `body.model` afterwards so metering prices what we
 * actually sent. Clears a client-sent `thinking` when the forced model has no preset, so a param meant
 * for one model never rides along to another.
 */
export function applyForceModel(body: Record<string, unknown>): void {
  if (!FORCE_MODEL) return;
  body.model = FORCE_MODEL;
  const thinking = MODEL_THINKING[FORCE_MODEL];
  if (thinking) body.thinking = thinking;
  else delete body.thinking;
}

/**
 * Bounds violations in a config object — `[]` when clean. This is the pre-deploy control: it backs
 * `tests/config.test.ts`, which `npm run deploy` runs before `wrangler deploy`, so an out-of-range value
 * can't ship unnoticed (this repo has no CI — that npm gate is the whole safety net).
 */
export function configViolations(config: RemoteConfig): string[] {
  const problems: string[] = [];
  if (config.model !== undefined && (typeof config.model !== 'string' || config.model.trim() === '')) {
    problems.push('model must be a non-empty string');
  }
  for (const key of Object.keys(BOUNDS) as (keyof typeof BOUNDS)[]) {
    const value = config[key];
    const bound = BOUNDS[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push(`${key} must be a finite number`);
    } else if (bound.int && !Number.isInteger(value)) {
      problems.push(`${key} must be an integer`);
    } else if (value < bound.min || value > bound.max) {
      problems.push(`${key} must be within ${bound.min}–${bound.max} (got ${value})`);
    }
  }
  return problems;
}
