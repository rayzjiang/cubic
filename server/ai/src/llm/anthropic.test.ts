import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { appendLiveStateAndCacheBreakpoint } from './anthropic.js';

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
    expect(cc(blocks[0])).toEqual({ type: 'ephemeral' });
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
    expect(cc(blocks[0])).toEqual({ type: 'ephemeral' });
    expect(blocks[1]).toMatchObject({ type: 'text', text: '<live_ae_state>{"playhead":0}</live_ae_state>' });
    expect(cc(blocks[1])).toBeUndefined();
  });

  it('still drops a rolling breakpoint when there is no live state (e.g. compaction call)', () => {
    const msgs: Anthropic.MessageParam[] = [{ role: 'user', content: 'summarize' }];
    appendLiveStateAndCacheBreakpoint(msgs, undefined);
    const blocks = blocksOf(msgs[0]);
    expect(blocks).toHaveLength(1);
    expect(cc(blocks[0])).toEqual({ type: 'ephemeral' });
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
    expect(cc(blocksOf(msgs[2])[0])).toEqual({ type: 'ephemeral' });
  });

  it('is a no-op on an empty message list', () => {
    const msgs: Anthropic.MessageParam[] = [];
    expect(() => appendLiveStateAndCacheBreakpoint(msgs, 'x')).not.toThrow();
    expect(msgs).toHaveLength(0);
  });
});
