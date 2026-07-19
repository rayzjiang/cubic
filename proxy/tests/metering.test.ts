import { describe, it, expect, vi, afterEach } from 'vitest';
import { costCentsForUsage, recordUsage } from '../src/metering.js';
import { parseUsageFromResponse } from '../src/usage-parse.js';
import type { Env } from '../src/index.js';

/**
 * §A-6 — cost math (USD × 100) + pulling token counts out of both response shapes. All offline.
 */

function streamOf(s: string): ReadableStream<Uint8Array> {
  return new Response(s).body as ReadableStream<Uint8Array>;
}

describe('costCentsForUsage', () => {
  it('prices Sonnet input+output and scales to cost-cents', () => {
    // 1M in @ $3 + 1M out @ $15 = $18 → 1800 cost-cents
    expect(costCentsForUsage('claude-sonnet-4-6', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(1800, 4);
  });

  it('applies the cache tiers (read 0.1x, write 2x — the 1-hour tier the proxy pins)', () => {
    // 1M cache-read @ 0.1×$3 = $0.30 → 30 cost-cents
    expect(costCentsForUsage('claude-sonnet-4-6', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(30, 4);
    // 1M cache-write @ 2×$3 = $6.00 → 600 cost-cents (1-hour write tier)
    expect(costCentsForUsage('claude-sonnet-4-6', { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(600, 4);
  });

  it('prices Sonnet 5 on its own row (same rate as 4-6)', () => {
    // 1M in @ $3 + 1M out @ $15 = $18 → 1800 cost-cents
    expect(costCentsForUsage('claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(1800, 4);
  });

  it('prices Haiku on its own row', () => {
    // 1M in @ $1 → 100 cost-cents
    expect(costCentsForUsage('claude-haiku-4-5', { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(100, 4);
  });

  it('throws for an unknown/unpriced model — drift is loud, never a silent fallback', () => {
    expect(() => costCentsForUsage('claude-unknown-9', { input_tokens: 1_000_000, output_tokens: 0 })).toThrow();
  });
});

const RU_ENV = { SUPABASE_URL: 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY: 'svc' } as Env;

describe('recordUsage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts once and stays quiet on success', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', spy);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await recordUsage('u1', '2026-07-01T00:00:00+00:00', 12.5, RU_ENV);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(err).not.toHaveBeenCalled();
  });

  it('logs and retries once on a non-ok response (never throws)', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    vi.stubGlobal('fetch', spy);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(recordUsage('u1', '2026-07-01T00:00:00+00:00', 12.5, RU_ENV)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(2); // one retry
    expect(err).toHaveBeenCalledTimes(2); // each failure logged
  });

  it('logs and retries on a fetch throw (never throws)', async () => {
    const spy = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', spy);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(recordUsage('u1', '2026-07-01T00:00:00+00:00', 12.5, RU_ENV)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalledTimes(2);
  });
});

describe('parseUsageFromResponse', () => {
  it('reads usage from a non-streaming JSON body', async () => {
    const body = streamOf(JSON.stringify({ usage: { input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 4 } }));
    const u = await parseUsageFromResponse(body, 'application/json');
    expect(u).toEqual({ input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 4 });
  });

  it('accumulates usage across an SSE stream (input from message_start, output from message_delta)', async () => {
    const sse = [
      'event: message_start',
      `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 40 } } })}`,
      '',
      'event: message_delta',
      `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 55 } })}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const u = await parseUsageFromResponse(streamOf(sse), 'text/event-stream');
    expect(u).toEqual({ input_tokens: 100, output_tokens: 55, cache_creation_input_tokens: 0, cache_read_input_tokens: 40 });
  });

  it('returns null when there is no usage / no body', async () => {
    expect(await parseUsageFromResponse(null, 'application/json')).toBeNull();
    expect(await parseUsageFromResponse(streamOf('{"content":[]}'), 'application/json')).toBeNull();
  });
});
