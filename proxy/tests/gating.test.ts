import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * §A-4..7 / §C-6 — the fetch handler's gate orchestration. auth/entitlement/metering are mocked so each
 * gate outcome is driven deterministically; the upstream `fetch` is stubbed. No network, no API spend.
 * Proves the status codes (401/402/429/200) and that a passed request is metered via ctx.waitUntil.
 */

vi.mock('../src/auth.js', () => ({
  verifyJwt: vi.fn(),
  // Keep the real (pure) bearer parser so header handling is exercised, not stubbed away.
  bearerToken: (h: string | null) => (h ?? '').replace(/^Bearer\s+/i, '').trim(),
}));
vi.mock('../src/entitlement.js', () => ({ getEntitlement: vi.fn() }));
// index.ts imports both meterResponse AND ALLOWED_MODELS from metering — the mock must supply both,
// or the model-allowlist gate throws on an undefined Set.
vi.mock('../src/metering.js', () => ({
  meterResponse: vi.fn(),
  ALLOWED_MODELS: new Set(['claude-sonnet-4-6', 'claude-haiku-4-5']),
}));

import worker, { type Env } from '../src/index.js';
import { verifyJwt } from '../src/auth.js';
import { getEntitlement } from '../src/entitlement.js';
import { meterResponse } from '../src/metering.js';

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

function env(overrides: Partial<Env> = {}): Env {
  return {
    ANTHROPIC_API_KEY: 'sk-test',
    SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    IP_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    ...overrides,
  } as Env;
}

function req(headers: Record<string, string> = {}, body: Record<string, unknown> = {}): Request {
  return new Request('https://proxy.example/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }], ...body }),
  });
}

/** A stubbed upstream 200 (with a usage body so the meter branch has something to read). Returns the
 *  spy so a test can inspect the forwarded request body. */
function stubUpstream200(): ReturnType<typeof vi.fn> {
  const spy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** Stub the upstream Anthropic fetch with an arbitrary status + headers + body — for the #5 non-2xx
 *  remap + header-strip assertions. Defaults to a JSON content-type so the meter branch has a type. */
function stubUpstream(
  status: number,
  headers: Record<string, string> = { 'content-type': 'application/json' },
  body = '{}',
): ReturnType<typeof vi.fn> {
  const spy = vi.fn().mockResolvedValue(new Response(body, { status, headers }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

const AUTHED = { authorization: 'Bearer good.jwt.token' };
const ENTITLED = {
  entitled: true, plan: 'pro', priceId: 'price_pro', allowanceCents: 50000, spentCents: 10,
  periodStart: '2026-07-01T00:00:00+00:00', periodEnd: '2026-08-01T00:00:00+00:00', status: 'active',
};

beforeEach(() => {
  vi.mocked(verifyJwt).mockResolvedValue({ userId: 'u1' });
  vi.mocked(getEntitlement).mockResolvedValue(ENTITLED);
  vi.mocked(meterResponse).mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('gate', () => {
  it('404s a wrong path', async () => {
    const res = await worker.fetch(new Request('https://proxy.example/nope', { method: 'POST' }), env(), ctx);
    expect(res.status).toBe(404);
  });

  it('401s a missing bearer token (JWT never checked)', async () => {
    const res = await worker.fetch(req(), env(), ctx);
    expect(res.status).toBe(401);
    expect(verifyJwt).not.toHaveBeenCalled();
  });

  it('401s an invalid/expired token', async () => {
    vi.mocked(verifyJwt).mockRejectedValueOnce(new Error('bad sig'));
    const res = await worker.fetch(req(AUTHED), env(), ctx);
    expect(res.status).toBe(401);
  });

  it('429s a pre-auth IP flood before touching the token', async () => {
    const e = env({ IP_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const res = await worker.fetch(req(AUTHED), e, ctx);
    expect(res.status).toBe(429);
    expect(verifyJwt).not.toHaveBeenCalled();
  });

  it('429s an over-limit user (post-auth)', async () => {
    const e = env({ RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: false }) } });
    const res = await worker.fetch(req(AUTHED), e, ctx);
    expect(res.status).toBe(429);
    expect(getEntitlement).not.toHaveBeenCalled();
  });

  it('402s a no-plan user with reason=no_plan (status null → never-subscribed/cancelled)', async () => {
    vi.mocked(getEntitlement).mockResolvedValueOnce({ ...ENTITLED, entitled: false, status: null });
    const res = await worker.fetch(req(AUTHED), env(), ctx);
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: { reason: string } };
    expect(body.error.reason).toBe('no_plan');
  });

  it('402s an over-cap user with reason=over_cap (active plan, spent >= allowance)', async () => {
    vi.mocked(getEntitlement).mockResolvedValueOnce({ ...ENTITLED, entitled: false, status: 'active', spentCents: 50000, allowanceCents: 50000 });
    const res = await worker.fetch(req(AUTHED), env(), ctx);
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: { reason: string } };
    expect(body.error.reason).toBe('over_cap');
  });

  it('402s a past_due user with reason=past_due (renewal failed → fix card, NOT an upsell)', async () => {
    vi.mocked(getEntitlement).mockResolvedValueOnce({ ...ENTITLED, entitled: false, status: 'past_due' });
    const res = await worker.fetch(req(AUTHED), env(), ctx);
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: { reason: string } };
    expect(body.error.reason).toBe('past_due');
  });

  it('503s (our-fault server issue, not a 402 upsell) an active subscriber whose allowance resolved to 0', async () => {
    // The mispriced-cohort edge (unknown/rotated price): a paying account must NOT be told "upgrade".
    vi.mocked(getEntitlement).mockResolvedValueOnce({ ...ENTITLED, entitled: false, status: 'active', allowanceCents: 0, spentCents: 0 });
    const res = await worker.fetch(req(AUTHED), env(), ctx);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { reason?: string } };
    expect(body.error.reason).toBeUndefined(); // not routed to the paywall (no over_cap/no_plan reason)
    expect(meterResponse).not.toHaveBeenCalled();
  });

  it('503s a trialing subscriber with allowance 0 too (same misconfig guard)', async () => {
    vi.mocked(getEntitlement).mockResolvedValueOnce({ ...ENTITLED, entitled: false, status: 'trialing', allowanceCents: 0, spentCents: 0 });
    const res = await worker.fetch(req(AUTHED), env(), ctx);
    expect(res.status).toBe(503);
  });

  it('503s when the entitlement lookup fails (strict fail-closed)', async () => {
    vi.mocked(getEntitlement).mockRejectedValueOnce(new Error('supabase down'));
    const res = await worker.fetch(req(AUTHED), env(), ctx);
    expect(res.status).toBe(503);
  });

  it('forwards + meters a fully-authorized request (200 + waitUntil meter)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ usage: { input_tokens: 5, output_tokens: 2 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const res = await worker.fetch(req(AUTHED), env(), ctx);
    expect(res.status).toBe(200);
    expect(meterResponse).toHaveBeenCalledTimes(1);
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    // Metering is stamped with the entitlement's period + the request's model.
    const args = vi.mocked(meterResponse).mock.calls[0];
    expect(args[2]).toBe('claude-sonnet-4-6'); // model
    expect(args[3]).toBe('u1'); // userId
    expect(args[4]).toBe(ENTITLED.periodStart); // periodStart
  });

  it('short-circuits to the canned response under MOCK_UPSTREAM (still gated)', async () => {
    const res = await worker.fetch(req(AUTHED), env({ MOCK_UPSTREAM: '1' }), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('msg_mock_upstream');
  });

  it('400s an unsupported model (allowlist, after entitlement, before any upstream spend)', async () => {
    const res = await worker.fetch(req(AUTHED, { model: 'claude-opus-4-8' }), env(), ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe('unsupported model');
    expect(meterResponse).not.toHaveBeenCalled();
  });

  it('400s a request with no model', async () => {
    const res = await worker.fetch(req(AUTHED, { model: undefined }), env(), ctx);
    expect(res.status).toBe(400);
  });

  it('clamps an oversized max_tokens to the server ceiling before forwarding', async () => {
    const fetchSpy = stubUpstream200();
    const res = await worker.fetch(req(AUTHED, { max_tokens: 100000 }), env(), ctx);
    expect(res.status).toBe(200);
    const sent = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.max_tokens).toBe(8192);
  });

  it('utility mode forwards the client body bare (no AE injection) and still meters', async () => {
    const fetchSpy = stubUpstream200();
    const res = await worker.fetch(
      req({ ...AUTHED, 'x-cubic-request': 'utility' }, { system: 'SUMMARY INSTRUCTION' }),
      env(),
      ctx,
    );
    expect(res.status).toBe(200);
    const sent = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.system).toBe('SUMMARY INSTRUCTION'); // the call's own prompt is kept…
    expect(sent.tools).toBeUndefined(); // …no AE tools injected
    expect(sent.tool_choice).toBeUndefined();
    expect(meterResponse).toHaveBeenCalledTimes(1); // still metered
  });

  // ── #5 upstream error remap: a non-2xx from Anthropic is NEVER piped verbatim ──────────────────────
  it('remaps an upstream 401 (our rotated key) to 502 — not a client 401 "sign in again" dead-end', async () => {
    stubUpstream(
      401,
      { 'content-type': 'application/json', 'request-id': 'req_123', 'anthropic-organization-id': 'org_secret' },
      JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
    );
    const res = await worker.fetch(req(AUTHED), env(), ctx);
    expect(res.status).toBe(502); // NOT 401
    const body = (await res.json()) as { error: { type: string } };
    expect(body.error.type).toBe('api_error');
    // upstream infra headers are stripped, never leaked to the client
    expect(res.headers.get('request-id')).toBeNull();
    expect(res.headers.get('anthropic-organization-id')).toBeNull();
    expect(meterResponse).not.toHaveBeenCalled(); // no billable usage on an error
  });

  it('remaps an upstream 403 to 502', async () => {
    stubUpstream(403);
    expect((await worker.fetch(req(AUTHED), env(), ctx)).status).toBe(502);
  });

  it('remaps upstream 500 and 503 to 502', async () => {
    stubUpstream(500);
    expect((await worker.fetch(req(AUTHED), env(), ctx)).status).toBe(502);
    stubUpstream(503);
    expect((await worker.fetch(req(AUTHED), env(), ctx)).status).toBe(502);
  });

  it('remaps an upstream 429 to a 429 rate_limit_error (retryable "busy")', async () => {
    stubUpstream(429);
    const res = await worker.fetch(req(AUTHED), env(), ctx);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { type: string } };
    expect(body.error.type).toBe('rate_limit_error');
  });

  it('remaps an upstream 529 (overloaded) to 429', async () => {
    stubUpstream(529);
    expect((await worker.fetch(req(AUTHED), env(), ctx)).status).toBe(429);
  });

  it('remaps another upstream 4xx (400) to a 400 invalid_request_error', async () => {
    stubUpstream(400);
    const res = await worker.fetch(req(AUTHED), env(), ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { type: string } };
    expect(body.error.type).toBe('invalid_request_error');
  });

  it('on a 200, forwards ONLY content-type — strips the request-id / anthropic-* leak', async () => {
    stubUpstream(
      200,
      {
        'content-type': 'application/json',
        'request-id': 'req_abc',
        'anthropic-organization-id': 'org_secret',
        'anthropic-ratelimit-requests-remaining': '99',
      },
      JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } }),
    );
    const res = await worker.fetch(req(AUTHED), env(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('request-id')).toBeNull();
    expect(res.headers.get('anthropic-organization-id')).toBeNull();
    expect(res.headers.get('anthropic-ratelimit-requests-remaining')).toBeNull();
    expect(meterResponse).toHaveBeenCalledTimes(1);
  });

  // ── #6 rate limiter fails CLOSED when its binding is missing (deploy misconfig, not fail-open) ─────
  it('503s (fail-closed) when the IP_RATE_LIMITER binding is missing — pre-auth, JWT never checked', async () => {
    const res = await worker.fetch(req(AUTHED), env({ IP_RATE_LIMITER: undefined }), ctx);
    expect(res.status).toBe(503);
    expect(verifyJwt).not.toHaveBeenCalled();
  });

  it('503s (fail-closed) when the RATE_LIMITER binding is missing — post-auth, entitlement never read', async () => {
    const res = await worker.fetch(req(AUTHED), env({ RATE_LIMITER: undefined }), ctx);
    expect(res.status).toBe(503);
    expect(getEntitlement).not.toHaveBeenCalled();
  });
});
