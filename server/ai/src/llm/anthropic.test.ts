import { describe, it, expect, afterEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { appendLiveStateAndCacheBreakpoint, applyModelRequestConfig, AnthropicProvider } from './anthropic.js';

// These are free, offline checks of the prompt-cache request SHAPE (no API call):
// the rolling breakpoint must land on the last REAL block, and live state must be an
// uncached trailing block AFTER it — otherwise the conversation cache busts every turn.

const cc = (b: unknown) => (b as { cache_control?: unknown }).cache_control;
const blocksOf = (m: Anthropic.MessageParam) => m.content as Anthropic.ContentBlockParam[];

describe('appendLiveStateAndCacheBreakpoint', () => {
  it('puts the breakpoint on the last real block and live state uncached after it', () => {
    const msgs: Anthropic.MessageParam[] = [
      { role: 'user', content: 'make the logo pop' },
    ];
    appendLiveStateAndCacheBreakpoint(msgs, '<live_ae_state>{}</live_ae_state>');
    const blocks = blocksOf(msgs[0]);
    expect(blocks).toHaveLength(2);
    // [0] = the real user text, carries the cache breakpoint
    expect(blocks[0]).toMatchObject({ type: 'text', text: 'make the logo pop' });
    expect(cc(blocks[0])).toEqual({ type: 'ephemeral', ttl: '1h' });
    // [1] = the live-state tail, NO cache_control (it changes every turn)
    expect(blocks[1]).toMatchObject({ type: 'text', text: '<live_ae_state>{}</live_ae_state>' });
    expect(cc(blocks[1])).toBeUndefined();
  });

  it('breakpoint follows tool_result blocks; live state still trails them', () => {
    const msgs: Anthropic.MessageParam[] = [
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"status":"success"}' }] },
    ];
    appendLiveStateAndCacheBreakpoint(msgs, '<live_ae_state>{"playhead":0}</live_ae_state>');
    const blocks = blocksOf(msgs[1]);
    // tool_result stays first (API requires it); breakpoint on it; live state appended last, uncached.
    expect(blocks[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
    expect(cc(blocks[0])).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(blocks[1]).toMatchObject({ type: 'text', text: '<live_ae_state>{"playhead":0}</live_ae_state>' });
    expect(cc(blocks[1])).toBeUndefined();
  });

  it('still drops a rolling breakpoint when there is no live state (e.g. compaction call)', () => {
    const msgs: Anthropic.MessageParam[] = [{ role: 'user', content: 'summarize' }];
    appendLiveStateAndCacheBreakpoint(msgs, undefined);
    const blocks = blocksOf(msgs[0]);
    expect(blocks).toHaveLength(1);
    expect(cc(blocks[0])).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('does not mutate earlier messages (only the last one gets the breakpoint)', () => {
    const msgs: Anthropic.MessageParam[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ];
    appendLiveStateAndCacheBreakpoint(msgs, '<live_ae_state>{}</live_ae_state>');
    expect(msgs[0].content).toBe('first'); // untouched plain string
    expect(msgs[1].content).toBe('reply');
    expect(cc(blocksOf(msgs[2])[0])).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('is a no-op on an empty message list', () => {
    const msgs: Anthropic.MessageParam[] = [];
    expect(() => appendLiveStateAndCacheBreakpoint(msgs, 'x')).not.toThrow();
    expect(msgs).toHaveLength(0);
  });
});

// Per-model request config: proves the default path is unchanged (no thinking param added) and that
// Sonnet 5 gets its cost-safe explicit-off preset. This is the whole "adding Sonnet 5 changes nothing
// for the current default" guarantee, locked as a test. Offline — no API call.
type ReqParams = { model: string; thinking?: Anthropic.ThinkingConfigParam };
describe('applyModelRequestConfig', () => {
  it('is a no-op for the current default (Sonnet 4.6) — sends NO thinking param', () => {
    const params: ReqParams = { model: 'claude-sonnet-4-6' };
    applyModelRequestConfig(params);
    expect(params.thinking).toBeUndefined();
  });

  it('is a no-op for Haiku (the dev default) and unknown ids', () => {
    for (const model of ['claude-haiku-4-5', 'some-future-model']) {
      const params: ReqParams = { model };
      applyModelRequestConfig(params);
      expect(params.thinking).toBeUndefined();
    }
  });

  it('presets Sonnet 5 to explicit thinking:disabled (omitting it would enable adaptive-on)', () => {
    const params: ReqParams = { model: 'claude-sonnet-5' };
    applyModelRequestConfig(params);
    expect(params.thinking).toEqual({ type: 'disabled' });
  });
});

// WT-PROXY-CORE — the constructor fork. Proxy mode (CUBIC_ENV=prod) holds NO key on
// device (the Worker does), so construction must NOT throw on a missing key. Direct-local
// still requires a real key. (Offline — no API call; the SDK is only constructed.)
describe('AnthropicProvider constructor fork', () => {
  const PRIOR_ENV = process.env.CUBIC_ENV;
  const PRIOR_KEY = process.env.ANTHROPIC_API_KEY;
  const PRIOR_BASE = process.env.ANTHROPIC_BASE_URL;
  afterEach(() => {
    if (PRIOR_ENV === undefined) delete process.env.CUBIC_ENV; else process.env.CUBIC_ENV = PRIOR_ENV;
    if (PRIOR_KEY === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = PRIOR_KEY;
    if (PRIOR_BASE === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = PRIOR_BASE;
  });

  it('proxy mode (prod) routed at the Worker with no on-device key: does NOT throw', () => {
    process.env.CUBIC_ENV = 'prod';
    process.env.ANTHROPIC_BASE_URL = 'http://localhost:8787'; // set by app config from CUBIC_PROXY_URL
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new AnthropicProvider()).not.toThrow();
  });

  it('proxy mode (prod) with NO proxy URL: throws loud (won\'t silently call Anthropic direct)', () => {
    process.env.CUBIC_ENV = 'prod';
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new AnthropicProvider()).toThrow('CUBIC_PROXY_URL');
  });

  it('direct-local mode with no key: throws (it calls Anthropic directly)', () => {
    process.env.CUBIC_ENV = 'local';
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new AnthropicProvider()).toThrow('ANTHROPIC_API_KEY not set');
  });
});
