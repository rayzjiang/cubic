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
