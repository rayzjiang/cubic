import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithTimeout } from '../src/http.js';

/**
 * P5W2 audit (LOW) — the Supabase RPC calls now bound their wait via fetchWithTimeout so a hung
 * Supabase can't stall the request. Offline: stub global fetch, no network.
 */

afterEach(() => vi.restoreAllMocks());

describe('fetchWithTimeout', () => {
  it('attaches an AbortSignal and rejects when the upstream outlives the timeout', async () => {
    // A fetch that only settles when its signal aborts — simulates a hung upstream.
    vi.stubGlobal('fetch', (_url: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        expect(init.signal).toBeInstanceOf(AbortSignal);
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
      }),
    );
    await expect(fetchWithTimeout('https://example.test', { method: 'GET' }, 20)).rejects.toBeTruthy();
  });

  it('resolves normally when the upstream responds before the timeout', async () => {
    vi.stubGlobal('fetch', async () => new Response('ok', { status: 200 }));
    const res = await fetchWithTimeout('https://example.test', {}, 1000);
    expect(res.status).toBe(200);
  });
});
