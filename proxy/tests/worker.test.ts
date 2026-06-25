import { describe, it, expect } from 'vitest';
import { prepareUpstream, mockResponse, type Env } from '../src/index.js';
import { injectedSystem, injectedTools } from '../src/inject.js';

/**
 * WT-PROXY-CORE — the Worker injects the crown jewels server-side (§A-1/2/9) and is
 * an Anthropic-shaped passthrough. These are offline checks of the request SHAPE +
 * injection — no real Anthropic call, no API spend.
 */

const ENV: Env = { ANTHROPIC_API_KEY: 'sk-test-secret', ANTHROPIC_VERSION: '2023-06-01' };

describe('inject', () => {
  it('system carries the static prefix with a cache_control breakpoint (§A-9)', () => {
    const sys = injectedSystem();
    expect(sys).toHaveLength(1);
    expect(sys[0].type).toBe('text');
    expect(sys[0].text.length).toBeGreaterThan(100); // the real rules+catalog prefix
    expect(sys[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('tools expose the full catalog with JSON-Schema input_schema', () => {
    const tools = injectedTools();
    expect(tools.map((t) => t.name)).toEqual(['runScript', 'batch', 'createComposition']);
    for (const t of tools) {
      expect(typeof t.description).toBe('string');
      expect(t.input_schema).toMatchObject({ type: 'object' });
    }
  });
});

describe('prepareUpstream', () => {
  it('injects system + tools + tool_choice over a BARE client request, and sets the key header', () => {
    const bare = { model: 'claude-sonnet-4-6', max_tokens: 4096, messages: [{ role: 'user', content: 'hi' }] };
    const { url, body, headers } = prepareUpstream({ ...bare }, ENV);

    expect(url).toBe('https://api.anthropic.com/v1/messages');
    // Client-supplied fields preserved…
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.messages).toEqual(bare.messages);
    // …and the crown jewels injected.
    expect(Array.isArray(body.system)).toBe(true);
    expect((body.system as Array<{ cache_control: unknown }>)[0].cache_control).toEqual({ type: 'ephemeral' });
    expect((body.tools as Array<{ name: string }>).map((t) => t.name)).toEqual(['runScript', 'batch', 'createComposition']);
    expect(body.tool_choice).toEqual({ type: 'auto' });
    // The real key is attached server-side (client never holds it).
    expect(headers['x-api-key']).toBe('sk-test-secret');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('overwrites any system/tools the client tried to send (crown jewels are server-owned)', () => {
    const sneaky = { messages: [], system: 'CLIENT INJECTED', tools: [{ name: 'evil' }] };
    const { body } = prepareUpstream(sneaky as Record<string, unknown>, ENV);
    expect(body.system).not.toBe('CLIENT INJECTED');
    expect((body.tools as Array<{ name: string }>).map((t) => t.name)).not.toContain('evil');
  });
});

describe('mockResponse (MOCK_UPSTREAM)', () => {
  it('returns a minimal Anthropic-shaped message (zero-spend full-stack-local path)', () => {
    const r = mockResponse({ model: 'claude-haiku-4-5' });
    expect(r).toMatchObject({ type: 'message', role: 'assistant', model: 'claude-haiku-4-5', stop_reason: 'end_turn' });
    expect(Array.isArray(r.content)).toBe(true);
  });
});
