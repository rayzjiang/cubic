import { describe, it, expect } from 'vitest';
import { prepareUpstream, prepareBareUpstream, normalizeCacheControlTo1h, mockResponse, type Env } from '../src/index.js';
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
    expect(sys[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
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
    expect((body.system as Array<{ cache_control: unknown }>)[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
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

describe('prepareBareUpstream (utility calls)', () => {
  it('forwards the client body untouched — no system/tools/tool_choice injection — but sets the key header', () => {
    const summary = { model: 'claude-sonnet-4-6', max_tokens: 2048, system: 'SUMMARY INSTRUCTION', messages: [{ role: 'user', content: 'transcript' }] };
    const { url, body, headers } = prepareBareUpstream({ ...summary }, ENV);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    // The call's own (non-secret) system prompt is kept…
    expect(body.system).toBe('SUMMARY INSTRUCTION');
    // …and NO AE crown jewels are added.
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    // The real key is still attached server-side.
    expect(headers['x-api-key']).toBe('sk-test-secret');
  });
});

describe('normalizeCacheControlTo1h (L4 — server-enforced 1h cache tier)', () => {
  it('forces a client 5-minute breakpoint up to 1h (preserves the breakpoint, does not strip it)', () => {
    const body = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }] },
      ],
    };
    const out = normalizeCacheControlTo1h(body) as typeof body;
    const cc = (out.messages[0].content as Array<{ cache_control?: unknown }>)[0].cache_control;
    expect(cc).toEqual({ type: 'ephemeral', ttl: '1h' }); // 5m → 1h, breakpoint preserved
  });

  it('leaves a client 1h breakpoint at 1h', () => {
    const body = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral', ttl: '1h' } }] }] };
    const out = normalizeCacheControlTo1h(body) as typeof body;
    expect((out.messages[0].content as Array<{ cache_control?: unknown }>)[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('touches only cache_control blocks and does not mutate the input', () => {
    const body = { messages: [{ role: 'user', content: [{ type: 'text', text: 'plain' }] }] };
    const out = normalizeCacheControlTo1h(body) as typeof body;
    expect((out.messages[0].content as Array<{ cache_control?: unknown }>)[0].cache_control).toBeUndefined();
    // input untouched (a client 5m block on the original object is not mutated to 1h)
    const src = { messages: [{ role: 'user', content: [{ type: 'text', text: 'x', cache_control: { type: 'ephemeral' } }] }] };
    normalizeCacheControlTo1h(src);
    expect((src.messages[0].content[0] as { cache_control: unknown }).cache_control).toEqual({ type: 'ephemeral' });
  });

  it('also pins the client conversation breakpoint through prepareUpstream', () => {
    const body = { model: 'claude-sonnet-4-6', max_tokens: 4096, messages: [{ role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }] }] };
    const { body: out } = prepareUpstream(body, ENV);
    const cc = ((out.messages as Array<{ content: Array<{ cache_control?: unknown }> }>)[0].content)[0].cache_control;
    expect(cc).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('pins a utility-call breakpoint through prepareBareUpstream too', () => {
    const body = { system: [{ type: 'text', text: 'SUMMARY', cache_control: { type: 'ephemeral' } }], messages: [] };
    const { body: out } = prepareBareUpstream(body, ENV);
    expect((out.system as Array<{ cache_control?: unknown }>)[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });
});

describe('mockResponse (MOCK_UPSTREAM)', () => {
  it('returns a minimal Anthropic-shaped message (zero-spend full-stack-local path)', () => {
    const r = mockResponse({ model: 'claude-haiku-4-5' });
    expect(r).toMatchObject({ type: 'message', role: 'assistant', model: 'claude-haiku-4-5', stop_reason: 'end_turn' });
    expect(Array.isArray(r.content)).toBe(true);
  });
});
