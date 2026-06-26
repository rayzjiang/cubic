import { injectedSystem, injectedTools } from './inject.js';

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

export interface Env {
  /** Anthropic key — set as a Worker secret (`wrangler secret put ANTHROPIC_API_KEY`). */
  ANTHROPIC_API_KEY: string;
  /** Pinned Anthropic API version header. */
  ANTHROPIC_VERSION?: string;
  /** When set, return a canned Anthropic-shaped response instead of calling upstream —
   *  lets full-stack-local exercise the whole client→Worker path at zero API spend. */
  MOCK_UPSTREAM?: string;
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

/**
 * Build the upstream request: inject system + tools + tool_choice (overwriting
 * anything the client sent) and set the auth + version headers. Pure + exported
 * so unit tests can assert injection with no network and no API spend.
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
  return {
    url: ANTHROPIC_URL,
    body: injected,
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': env.ANTHROPIC_VERSION ?? DEFAULT_ANTHROPIC_VERSION,
    },
  };
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== 'POST' || url.pathname !== '/v1/messages') {
      return json({ type: 'error', error: { type: 'not_found', message: 'POST /v1/messages only' } }, 404);
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ type: 'error', error: { type: 'invalid_request_error', message: 'invalid JSON body' } }, 400);
    }

    // Auth seam (Wave 2 enforces) — read but do NOT verify/reject yet.
    void req.headers.get('authorization');

    const { url: upstreamUrl, body: upstreamBody, headers } = prepareUpstream(body, env);

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
      return json({ type: 'error', error: { type: 'api_error', message: 'upstream request to Anthropic failed' } }, 502);
    }

    // Transparent body pipe — handles streaming and non-streaming identically (§A-2).
    // Strip body-framing headers: the Workers runtime may have already decompressed the body,
    // so a copied `content-encoding`/`content-length` would make the client double-decode or
    // mis-read the stream. The platform re-adds correct framing for the bytes we actually emit.
    const respHeaders = new Headers(upstream.headers);
    respHeaders.delete('content-encoding');
    respHeaders.delete('content-length');
    respHeaders.delete('transfer-encoding');
    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  },
};
