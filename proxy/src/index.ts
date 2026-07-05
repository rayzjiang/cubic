import { injectedSystem, injectedTools } from './inject.js';
import { verifyJwt, bearerToken } from './auth.js';
import { getEntitlement } from './entitlement.js';
import { meterResponse, ALLOWED_MODELS } from './metering.js';

/**
 * WT-PROXY-CORE — Anthropic-shaped passthrough Worker (Phase 5 §A-2).
 *
 * Holds the Anthropic key + injects the secret system prompt/tool catalog, then
 * forwards to api.anthropic.com and streams the body straight back. The agent loop
 * stays client-side (one Claude response per call → stateless, serverless-friendly).
 *
 * NOT yet gated: JWT verify / entitlement / metering / rate-limit are Wave 2
 * (WT-PROXY-GATING). This Worker is "testable with just the API key".
 */

/**
 * Cloudflare native Rate Limiting binding (subset we use). Configured in wrangler.jsonc; the runtime
 * enforces it at the edge. `limit({ key })` → `{ success }` — false once the key is over its window.
 */
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  /** Anthropic key — set as a Worker secret (`wrangler secret put ANTHROPIC_API_KEY`). */
  ANTHROPIC_API_KEY: string;
  /** Pinned Anthropic API version header. */
  ANTHROPIC_VERSION?: string;
  // ─── Wave 2 (WT-PROXY-GATING) — required at runtime for the gate; optional in the type so the
  //     pure-function unit tests (prepareUpstream/mockResponse) still construct a minimal Env. ───
  /** Supabase project URL — derives the JWKS endpoint (JWT verify, §A-4) + the PostgREST base
   *  (entitlement read + usage write, §A-5/6). A plain var. */
  SUPABASE_URL?: string;
  /** Override the JWKS endpoint (default `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`). Lets
   *  full-stack-local point at the mint-test-jwt helper's local JWKS; unset in prod. */
  SUPABASE_JWKS_URL?: string;
  /** Supabase service-role key — Worker SECRET. Reads any user's entitlement + writes usage (both
   *  bypass RLS). `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`; never committed. */
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Cloudflare Rate Limiting binding — keyed by user id (post-auth per-user cap). The limit/period
   *  live in wrangler.jsonc (`unsafe.bindings`), not here. */
  RATE_LIMITER?: RateLimit;
  /** Cloudflare Rate Limiting binding — keyed by client IP (pre-auth flood guard). */
  IP_RATE_LIMITER?: RateLimit;
  /** When set, return a canned Anthropic-shaped response instead of calling upstream —
   *  lets full-stack-local exercise the whole client→Worker path at zero API spend. */
  MOCK_UPSTREAM?: string;
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
/** Server-authoritative cap on client-requested output tokens — bounds worst-case per-call spend no
 *  matter what the client (or a raw curl) asks for. The desktop client's own default is 4096. */
const MAX_OUTPUT_TOKENS = 8192;

/** The auth + version headers every upstream call carries. The real Anthropic key is attached here
 *  server-side (the client never holds it). */
function upstreamHeaders(env: Env): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': env.ANTHROPIC_API_KEY,
    'anthropic-version': env.ANTHROPIC_VERSION ?? DEFAULT_ANTHROPIC_VERSION,
  };
}

/**
 * Build the upstream request for an AGENT call: inject system + tools + tool_choice (overwriting
 * anything the client sent) and set the auth + version headers. Pure + exported so unit tests can
 * assert injection with no network and no API spend.
 */
export function prepareUpstream(
  body: Record<string, unknown>,
  env: Env,
): { url: string; body: Record<string, unknown>; headers: Record<string, string> } {
  const injected: Record<string, unknown> = {
    ...body,
    system: injectedSystem(),
    tools: injectedTools(),
    tool_choice: { type: 'auto' },
  };
  return { url: ANTHROPIC_URL, body: injected, headers: upstreamHeaders(env) };
}

/**
 * Build the upstream request for a UTILITY call (e.g. the agent loop's history-compaction summary):
 * forward the client body AS-IS — no system/tools/tool_choice injection. A utility call carries its own
 * NON-secret system prompt (the summary instruction) and needs no AE tools, so the crown jewels are
 * never sent. Still fully gated + metered by the handler. Selected via the `x-cubic-request: utility`
 * request header. Pure + exported for unit tests.
 */
export function prepareBareUpstream(
  body: Record<string, unknown>,
  env: Env,
): { url: string; body: Record<string, unknown>; headers: Record<string, string> } {
  return { url: ANTHROPIC_URL, body, headers: upstreamHeaders(env) };
}

/** A minimal Anthropic Messages-shaped response for MOCK_UPSTREAM (no real call). */
export function mockResponse(body: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'msg_mock_upstream',
    type: 'message',
    role: 'assistant',
    model: typeof body.model === 'string' ? body.model : 'claude-mock',
    content: [{ type: 'text', text: 'MOCK_UPSTREAM: injected system+tools, no real Anthropic call.' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

/** Anthropic-shaped error envelope with an HTTP status the client SDK surfaces as `.status`
 *  (401 = signed out, 402 = not paid / over cap, 429 = rate limited, 503 = gate unavailable). An
 *  optional machine-readable `reason` rides in the body (SDK exposes it via `.error`) so the client +
 *  Wave-3 §D paywall can route the right screen — e.g. 'no_plan' vs 'over_cap' on a 402. */
function errorResponse(type: string, message: string, status: number, reason?: string): Response {
  return json({ type: 'error', error: { type, message, ...(reason ? { reason } : {}) } }, status);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== 'POST' || url.pathname !== '/v1/messages') {
      return json({ type: 'error', error: { type: 'not_found', message: 'POST /v1/messages only' } }, 404);
    }

    // §A-7 pre-auth flood guard: throttle by client IP BEFORE any parsing/verification, so an
    // unauthenticated flood is dropped cheapest. Cloudflare's edge DDoS protection sits in front of this.
    const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
    if (env.IP_RATE_LIMITER && !(await env.IP_RATE_LIMITER.limit({ key: ip })).success) {
      return errorResponse('rate_limit_error', 'Too many requests — slow down.', 429);
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return errorResponse('invalid_request_error', 'invalid JSON body', 400);
    }

    // §A-4 verify the Supabase JWT (stateless, JWKS) → user id, else 401.
    const token = bearerToken(req.headers.get('authorization'));
    if (!token) return errorResponse('authentication_error', 'missing bearer token', 401);
    const caller = await verifyJwt(token, env).catch(() => null);
    if (!caller) return errorResponse('authentication_error', 'invalid or expired token', 401);
    const userId = caller.userId;

    // §A-7 per-user rate limit — bounds the soft-cap overshoot + runaway/abuse spend on the one key.
    if (env.RATE_LIMITER && !(await env.RATE_LIMITER.limit({ key: userId })).success) {
      return errorResponse('rate_limit_error', 'Too many requests — slow down.', 429);
    }

    // §A-5/§C-6 entitlement gate. STRICT fail-closed: any lookup failure blocks (503), never spends;
    // a not-entitled user (no active plan or monthly allowance reached) → 402.
    const entitlement = await getEntitlement(userId, env).catch(() => null);
    if (!entitlement) return errorResponse('api_error', 'entitlement check unavailable — try again shortly', 503);
    if (!entitlement.entitled) {
      const st = entitlement.status;
      // Our OWN misconfiguration, not the user's problem: an eligible-status subscriber (active/trialing)
      // whose allowance resolved to 0 means we couldn't map their price → allowance (e.g. an unknown/
      // rotated price). Surface it as a transient server issue (503, retryable), never a 402 "upgrade"
      // upsell on a paying account — and it makes a mispricing show up as 503s in the logs.
      if ((st === 'active' || st === 'trialing') && entitlement.allowanceCents === 0) {
        return errorResponse('api_error', 'entitlement temporarily unavailable — try again shortly', 503);
      }
      // Route the block reason so the client + §D paywall show the right screen:
      //   past_due → renewal payment failed (fix card); over_cap → a live plan over its monthly cap;
      //   no_plan  → never-subscribed / canceled / unpaid / incomplete / paused (must (re)subscribe).
      const reason = st === 'past_due' ? 'past_due'
        : st === 'active' || st === 'trialing' ? 'over_cap'
        : 'no_plan';
      const message = reason === 'past_due' ? 'payment failed'
        : reason === 'over_cap' ? 'monthly allowance reached'
        : 'no active plan';
      return errorResponse('entitlement_error', message, 402, reason);
    }

    // Server-authoritative request bounds (applies to every path — app OR raw curl). Reject any model the
    // proxy can't price (ALLOWED_MODELS is derived from the pricing map), so nothing reaches Anthropic
    // without a known meter rate; then clamp max_tokens so one call can't request a huge (expensive) output.
    const model = typeof body.model === 'string' ? body.model : undefined;
    if (!model || !ALLOWED_MODELS.has(model)) {
      return errorResponse('invalid_request_error', 'unsupported model', 400);
    }
    if (typeof body.max_tokens === 'number') {
      body.max_tokens = Math.min(body.max_tokens, MAX_OUTPUT_TOKENS);
    }

    // Gate passed — forward. An agent call gets the crown jewels injected; a UTILITY call (e.g. the
    // compaction summary, flagged `x-cubic-request: utility`) forwards the client body as-is (its own
    // non-secret prompt, no AE tools). Both are gated above and metered below.
    const utility = req.headers.get('x-cubic-request') === 'utility';
    const { url: upstreamUrl, body: upstreamBody, headers } = utility
      ? prepareBareUpstream(body, env)
      : prepareUpstream(body, env);
    if (env.MOCK_UPSTREAM) return json(mockResponse(upstreamBody), 200);

    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(upstreamBody),
      });
    } catch {
      // Network/TLS failure reaching Anthropic — return an Anthropic-shaped envelope so the
      // client SDK surfaces a clean error instead of a bare 500.
      return errorResponse('api_error', 'upstream request to Anthropic failed', 502);
    }

    // Transparent body pipe (§A-2) + §A-6 metering. Strip body-framing headers: the Workers runtime
    // may have already decompressed the body, so a copied `content-encoding`/`content-length` would
    // make the client double-decode. The platform re-adds correct framing for the bytes we emit.
    const respHeaders = new Headers(upstream.headers);
    respHeaders.delete('content-encoding');
    respHeaders.delete('content-length');
    respHeaders.delete('transfer-encoding');

    // No body to meter (non-2xx with empty body etc.) → pipe as-is.
    if (!upstream.body) {
      return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
    }
    // Tee: one branch streams to the client now; the other is drained async (waitUntil) to pull the
    // token counts → cost-cents → the usage counter, stamped with the subscription's current period.
    const [clientBody, meterBody] = upstream.body.tee();
    const contentType = upstream.headers.get('content-type') ?? '';
    ctx.waitUntil(meterResponse(meterBody, contentType, model, userId, entitlement.periodStart, env));
    return new Response(clientBody, { status: upstream.status, headers: respHeaders });
  },
};
