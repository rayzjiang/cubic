import type { Env } from './index.js';
import { parseUsageFromResponse } from './usage-parse.js';
import { fetchWithTimeout, RPC_TIMEOUT_MS } from './http.js';

/**
 * §A-6 — after each response, convert Anthropic's token counts to cost-cents and ADD them to the
 * user's usage counter (via the `record_usage` RPC). Runs async in `ctx.waitUntil()` so the user never
 * waits on billing bookkeeping. Best-effort by design: the gate already confirmed entitlement BEFORE we
 * spent, so a rare post-hoc metering-write failure loses one increment (it can't un-send the response) —
 * strict fail-closed lives at the gate, not here.
 *
 * `MODEL_PRICING` mirrors `server/ai/src/llm/anthropic.ts` (USD per 1M tokens; cache reads ~0.1×, cache
 * writes ~2× input — the 1-hour tier, which the Worker pins for every write via inject.ts +
 * normalizeCacheControlTo1h, so the flat 2× is exact). Kept as its own copy because the Worker is the metering authority now and can't
 * import the client package. cost-cents = USD × 100 (the denomination of allowance_cents / spent_cents).
 */

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// USD per 1M tokens, keyed by model id. This map is BOTH the billing authority AND the allowlist source
// (ALLOWED_MODELS is derived from it), so no model can reach Anthropic without a known price — closing
// the hole where an unpriced/expensive model was silently billed at a cheaper fallback rate. Adding a
// model = one row here (+ the client-side debug mirror in server/ai/src/llm/anthropic.ts).
const MODEL_PRICING: Record<string, { inPerM: number; outPerM: number }> = {
  'claude-sonnet-4-6': { inPerM: 3, outPerM: 15 },
  'claude-haiku-4-5': { inPerM: 1, outPerM: 5 },
};

/** The models the proxy will forward + price. Derived from MODEL_PRICING so allowlist and pricing can't
 *  drift; the gate rejects (400) anything not in this set. */
export const ALLOWED_MODELS = new Set(Object.keys(MODEL_PRICING));

/** Cost of one call in cost-cents (USD × 100), accounting for the discounted cache tiers. */
export function costCentsForUsage(model: string | undefined, u: AnthropicUsage): number {
  const p = model ? MODEL_PRICING[model] : undefined;
  // The gate (ALLOWED_MODELS) guarantees only a priced model reaches here — a miss means drift, so fail
  // loud (caught + logged by meterResponse) rather than silently under-bill at a fallback rate.
  if (!p) throw new Error(`no pricing for model ${model ?? '(none)'}`);
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const usd =
    (u.input_tokens * p.inPerM +
      cacheWrite * p.inPerM * 2.0 + // 1-hour cache-write tier (proxy pins ttl:'1h' on every breakpoint)
      cacheRead * p.inPerM * 0.1 +
      u.output_tokens * p.outPerM) /
    1_000_000;
  return usd * 100;
}

/** Atomic increment of the user's current-cycle usage counter (service-role → record_usage RPC). */
export async function recordUsage(
  userId: string,
  periodStart: string,
  cents: number,
  env: Env,
): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const url = new URL('/rest/v1/rpc/record_usage', env.SUPABASE_URL);
  const init: RequestInit = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ p_user_id: userId, p_period_start: periodStart, p_cents: cents }),
  };
  // A single write is best-effort (the gate already confirmed entitlement before we spent), but a
  // SYSTEMATIC failure — rotated key, dropped grant, renamed RPC — would silently stop metering for
  // everyone. So check the status, LOG every failure (visible in Cloudflare observability), and try
  // once more. Never throws: a metering write must not surface to the user.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init, RPC_TIMEOUT_MS);
      if (res.ok) return;
      const detail = await res.text().catch(() => '');
      console.error(`record_usage HTTP ${res.status} (attempt ${attempt}/2): ${detail}`);
    } catch (e) {
      console.error(`record_usage fetch failed (attempt ${attempt}/2): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/**
 * The `ctx.waitUntil()` target: parse the teed response, price it, and record it. Stamped with the
 * subscription's `periodStart` (from the entitlement result) so the write lands on the CURRENT cycle's
 * counter row — not a now()-derived month boundary. Never throws (best-effort — see file header).
 */
export async function meterResponse(
  body: ReadableStream<Uint8Array> | null,
  contentType: string,
  model: string | undefined,
  userId: string,
  periodStart: string | null,
  env: Env,
): Promise<void> {
  try {
    const usage = await parseUsageFromResponse(body, contentType);
    if (!usage) return;
    const cents = costCentsForUsage(model, usage);
    if (cents <= 0 || !periodStart) return;
    await recordUsage(userId, periodStart, cents, env);
  } catch (e) {
    // best-effort: a metering parse/price failure must never surface to the user — but LOG it (rather
    // than swallow silently) so a systematic outage is visible in observability instead of zeroing
    // everyone's usage undetected.
    console.error(`meterResponse failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
