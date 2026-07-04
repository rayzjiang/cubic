import { describe, it, expect } from 'vitest';
import { costCentsForUsage } from '../src/metering.js';
import { parseUsageFromResponse } from '../src/usage-parse.js';

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

  it('applies the discounted cache tiers (read 0.1x, write 1.25x)', () => {
    // 1M cache-read @ 0.1×$3 = $0.30 → 30 cost-cents
    expect(costCentsForUsage('claude-sonnet-4-6', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(30, 4);
    // 1M cache-write @ 1.25×$3 = $3.75 → 375 cost-cents
    expect(costCentsForUsage('claude-sonnet-4-6', { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(375, 4);
  });

  it('prices Haiku on its own row', () => {
    // 1M in @ $1 → 100 cost-cents
    expect(costCentsForUsage('claude-haiku-4-5', { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(100, 4);
  });

  it('falls back to default pricing for an unknown model', () => {
    expect(costCentsForUsage('claude-unknown-9', { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(300, 4);
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
