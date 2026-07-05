import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getEntitlement, _resetEntitlementCache } from '../src/entitlement.js';
import type { Env } from '../src/index.js';

/**
 * §A-5 — entitlement read + ~60s cache + STRICT fail-closed, all with a stubbed fetch (no network).
 */

const ENV = { SUPABASE_URL: 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY: 'svc' } as Env;

const ENTITLED_ROW = {
  entitled: true,
  plan: 'pro',
  price_id: 'price_pro',
  allowance_cents: '50000.0000',
  spent_cents: '12.5000',
  period_start: '2026-07-01T00:00:00+00:00',
  period_end: '2026-08-01T00:00:00+00:00',
  status: 'active',
};

function stubFetch(impl: () => unknown): ReturnType<typeof vi.fn> {
  const spy = vi.fn(impl as never);
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => _resetEntitlementCache());
afterEach(() => vi.unstubAllGlobals());

describe('getEntitlement', () => {
  it('reads the RPC row, maps it, and caches (one fetch for two calls)', async () => {
    const spy = stubFetch(() => ({ ok: true, json: async () => [ENTITLED_ROW] }));
    const a = await getEntitlement('u1', ENV);
    const b = await getEntitlement('u1', ENV);
    expect(a.entitled).toBe(true);
    expect(a.spentCents).toBe(12.5);
    expect(a.allowanceCents).toBe(50000);
    expect(a.periodStart).toBe('2026-07-01T00:00:00+00:00');
    expect(b).toEqual(a);
    expect(spy).toHaveBeenCalledTimes(1); // second call served from cache
  });

  it('maps a not-entitled row (over cap / no plan)', async () => {
    stubFetch(() => ({ ok: true, json: async () => [{ ...ENTITLED_ROW, entitled: false, status: 'canceled' }] }));
    const e = await getEntitlement('u2', ENV);
    expect(e.entitled).toBe(false);
  });

  it('fails closed (throws) when the RPC network call errors', async () => {
    stubFetch(() => { throw new Error('network down'); });
    await expect(getEntitlement('u3', ENV)).rejects.toThrow();
  });

  it('fails closed (throws) on a non-2xx RPC response', async () => {
    stubFetch(() => ({ ok: false, status: 500 }));
    await expect(getEntitlement('u4', ENV)).rejects.toThrow();
  });

  it('fails closed (throws) on an EMPTY body — a missing row must not silently become no_plan', async () => {
    stubFetch(() => ({ ok: true, json: async () => [] }));
    await expect(getEntitlement('u6', ENV)).rejects.toThrow();
  });

  it('fails closed (throws) on a malformed body (null / non-row)', async () => {
    stubFetch(() => ({ ok: true, json: async () => null }));
    await expect(getEntitlement('u7', ENV)).rejects.toThrow();
  });

  it('fails closed (throws) when misconfigured (no service-role key)', async () => {
    stubFetch(() => ({ ok: true, json: async () => [ENTITLED_ROW] }));
    await expect(getEntitlement('u5', { SUPABASE_URL: 'http://x' } as Env)).rejects.toThrow();
  });
});
