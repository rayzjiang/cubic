import type { Env } from './index.js';
import { parseUsageFromResponse } from './usage-parse.js';

/**
 * §A-6 — after each response, convert Anthropic's token counts to cost-cents and ADD them to the
 * user's usage counter (via the `record_usage` RPC). Runs async in `ctx.waitUntil()` so the user never
 * waits on billing bookkeeping. Best-effort by design: the gate already confirmed entitlement BEFORE we
 * spent, so a rare post-hoc metering-write failure loses one increment (it can't un-send the response) —
 * strict fail-closed lives at the gate, not here.
 *
 * `MODEL_PRICING` mirrors `server/ai/src/llm/anthropic.ts` (USD per 1M tokens; cache reads ~0.1×, cache
 * writes ~1.25× input). Kept as its own copy because the Worker is the metering authority now and can't
 * import the client package. cost-cents = USD × 100 (the denomination of allowance_cents / spent_cents).
 */

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

const MODEL_PRICING: Record<string, { inPerM: number; outPerM: number }> = {
  'claude-sonnet-4-6': { inPerM: 3, outPerM: 15 },
  'claude-haiku-4-5': { inPerM: 1, outPerM: 5 },
};
const DEFAULT_PRICING = { inPerM: 3, outPerM: 15 };

/** Cost of one call in cost-cents (USD × 100), accounting for the discounted cache tiers. */
export function costCentsForUsage(model: string | undefined, u: AnthropicUsage): number {
  const p = (model ? MODEL_PRICING[model] : undefined) ?? DEFAULT_PRICING;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const usd =
    (u.input_tokens * p.inPerM +
      cacheWrite * p.inPerM * 1.25 +
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
  await fetch(new URL('/rest/v1/rpc/record_usage', env.SUPABASE_URL), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ p_user_id: userId, p_period_start: periodStart, p_cents: cents }),
  });
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
  } catch {
    /* best-effort: a metering parse/write failure must never surface to the user */
  }
}
