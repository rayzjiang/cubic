import { describe, it, expect } from 'vitest';
import type { Message } from 'cubic-ai';
import { messagesToDisplayItems } from './displayItems.js';

/**
 * Build a settled tool round-trip the way the loop commits it: an assistant turn with a tool_use,
 * followed by a user turn carrying the matching tool_result. `resultJson` is the handler's JSON
 * payload (string content); `isError` flags an error tool_result.
 */
function toolRoundTrip(
  id: string,
  name: string,
  input: Record<string, unknown>,
  resultJson: unknown,
  isError = false,
): Message[] {
  return [
    { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } as unknown as Message,
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: JSON.stringify(resultJson) }],
    } as unknown as Message,
  ];
}

describe('messagesToDisplayItems — tool outcome → row status', () => {
  it('maps a handler status:"noop" result to a neutral noop row with the muted label', () => {
    const msgs = toolRoundTrip(
      't1',
      'runScript',
      { script: 'setLayerProperty', parameters: { propertyPath: ['Transform', 'Opacity'], value: 50 } },
      { status: 'noop', message: "Property 'Opacity' is already set to that value." },
    );
    const items = messagesToDisplayItems(msgs);
    expect(items).toEqual([
      { kind: 'tool', id: 't1', label: 'Already set to that value', status: 'noop' },
    ]);
  });

  it('maps a status:"success" result to an ok row (labeled from the resolved result)', () => {
    const msgs = toolRoundTrip(
      't2',
      'runScript',
      { script: 'setLayerProperty', parameters: { propertyPath: ['Transform', 'Opacity'] } },
      { status: 'success', property: { name: 'Opacity', value: 50 }, previousValue: 100 },
    );
    const items = messagesToDisplayItems(msgs);
    expect(items).toEqual([
      { kind: 'tool', id: 't2', label: 'Set Opacity to 50%', status: 'ok' },
    ]);
  });

  it('maps an is_error tool_result to a fail row', () => {
    const msgs = toolRoundTrip(
      't3',
      'runScript',
      { script: 'deleteEffect', parameters: { effectName: 'Glow' } },
      { status: 'error', errorCode: 'LAYER_NOT_FOUND', message: 'no such effect' },
      true,
    );
    const items = messagesToDisplayItems(msgs);
    expect(items[0]).toMatchObject({ kind: 'tool', id: 't3', status: 'fail' });
  });

  it('treats a batch whose result JSON is status:"noop" as a neutral row', () => {
    const msgs = toolRoundTrip(
      't4',
      'batch',
      { commands: [] },
      { status: 'noop', message: 'Empty batch — nothing to do.', noopCount: 0 },
    );
    const items = messagesToDisplayItems(msgs);
    expect(items).toEqual([
      { kind: 'tool', id: 't4', label: 'No changes needed', status: 'noop' },
    ]);
  });
});

// ─── compaction marker → "Summarized earlier steps" divider at the cut point ──────────

describe('messagesToDisplayItems — persisted compaction marker', () => {
  const userTagged = (text: string, turnId: string): Message =>
    ({ role: 'user', content: text, _turnId: turnId }) as unknown as Message;
  const asst = (text: string): Message => ({ role: 'assistant', content: text });
  const marker = (summary: string, keptTurns: number): Message =>
    ({ role: 'user', content: `<conversation_summary>\n${summary}\n</conversation_summary>`, _compaction: true, _keptTurns: keptTurns }) as unknown as Message;

  it('splices the divider at the cut point — before the last keptTurns verbatim turn', () => {
    // Disk order: u1 a1 u2 a2 MARKER(keptTurns=1) u3 a3 → summarize u1, keep u2 verbatim, u3 is new.
    const items = messagesToDisplayItems([
      userTagged('u1', 't1'), asst('a1'),
      userTagged('u2', 't2'), asst('a2'),
      marker('recap of u1', 1),
      userTagged('u3', 't3'), asst('a3'),
    ]);
    expect(items).toEqual([
      { kind: 'user', text: 'u1', turnId: 't1' },
      { kind: 'assistant', text: 'a1' },
      { kind: 'compaction', summary: 'recap of u1' }, // divider before u2 (the kept-verbatim turn)
      { kind: 'user', text: 'u2', turnId: 't2' },
      { kind: 'assistant', text: 'a2' },
      { kind: 'user', text: 'u3', turnId: 't3' },
      { kind: 'assistant', text: 'a3' },
    ]);
  });

  it('skips a bare <conversation_summary> line with no marker flag (defensive backstop)', () => {
    const items = messagesToDisplayItems([
      userTagged('u1', 't1'),
      { role: 'user', content: '<conversation_summary>\nstray\n</conversation_summary>' },
    ]);
    expect(items).toEqual([{ kind: 'user', text: 'u1', turnId: 't1' }]);
  });
});
