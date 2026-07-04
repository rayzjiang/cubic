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
vi.mock('../src/metering.js', () => ({ meterResponse: vi.fn() }));

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

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://proxy.example/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] }),
  });
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
});
