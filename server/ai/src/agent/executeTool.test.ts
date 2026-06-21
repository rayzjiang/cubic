import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolUse } from '../llm/types.js';

// Mock the bridge client + session cache before importing the unit under test.
const { callRunScript, invalidate } = vi.hoisted(() => ({
  callRunScript: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('../bridge/client.js', () => ({ bridgeClient: { callRunScript } }));
vi.mock('../context/cache.js', () => ({ sessionCache: { invalidate } }));

import { executeTool, trimConfigurableProperties } from './executeTool.js';

const runScript = (script: string): ToolUse => ({ id: 'x', name: 'runScript', input: { script } });

describe('trimConfigurableProperties (RTK-style result trim)', () => {
  it('keeps n/p/k, drops v/nk, on top-level configurableProperties', () => {
    const input = JSON.stringify({
      status: 'success',
      layer: { name: 'BG', index: 1 },
      configurableProperties: [
        { n: 'Anchor Point', p: ['Transform', 'Anchor Point'], k: true, v: [960, 540, 0], nk: 0 },
        { n: 'Opacity', p: ['Transform', 'Opacity'], k: true, v: 100, nk: 2 },
      ],
    });
    const out = JSON.parse(trimConfigurableProperties(input));
    expect(out.configurableProperties).toEqual([
      { n: 'Anchor Point', p: ['Transform', 'Anchor Point'], k: true },
      { n: 'Opacity', p: ['Transform', 'Opacity'], k: true },
    ]);
    // Non-configurableProperties fields are untouched.
    expect(out.layer).toEqual({ name: 'BG', index: 1 });
  });

  it('trims configurableProperties nested inside batch sub-results (any depth)', () => {
    const input = JSON.stringify({
      status: 'success',
      results: [
        { index: 0, command: 'deleteLayer', result: { status: 'success' } },
        { index: 1, command: 'createLayer', result: { layer: { name: 'Rect' }, configurableProperties: [{ n: 'Scale', p: ['Transform', 'Scale'], k: true, v: [100, 100, 100], nk: 0 }] } },
      ],
    });
    const out = JSON.parse(trimConfigurableProperties(input));
    expect(out.results[1].result.configurableProperties).toEqual([{ n: 'Scale', p: ['Transform', 'Scale'], k: true }]);
  });

  it('preserves the {truncated:true} sentinel entry', () => {
    const input = JSON.stringify({ configurableProperties: [{ n: 'Opacity', p: ['Transform', 'Opacity'], k: true, v: 100, nk: 0 }, { n: '(truncated)', truncated: true }] });
    const out = JSON.parse(trimConfigurableProperties(input));
    expect(out.configurableProperties[1]).toEqual({ n: '(truncated)', truncated: true });
  });

  it('leaves other large arrays (e.g. keyframes, fonts) untouched', () => {
    const input = JSON.stringify({ keyframes: [{ t: 0, value: [100, 100, 100] }], fonts: ['Impact', 'Arial'] });
    expect(JSON.parse(trimConfigurableProperties(input))).toEqual({ keyframes: [{ t: 0, value: [100, 100, 100] }], fonts: ['Impact', 'Arial'] });
  });

  it('returns non-JSON content unchanged', () => {
    expect(trimConfigurableProperties('plain string result')).toBe('plain string result');
  });
});

describe('executeTool', () => {
  beforeEach(() => {
    callRunScript.mockReset();
    invalidate.mockReset();
  });

  it('runs a mutating command and invalidates the cache on success', async () => {
    callRunScript.mockResolvedValue({ status: 'success', layerIndex: 1 });
    const exec = await executeTool(runScript('createLayer'));

    // args carry only the server-injected friendly undo label (no model params here).
    expect(callRunScript).toHaveBeenCalledWith('createLayer', { __undoLabel: expect.any(String) });
    expect(exec.ok).toBe(true);
    expect(exec.block.is_error).toBe(false);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('does NOT invalidate the cache after a read-only command', async () => {
    callRunScript.mockResolvedValue({ status: 'success', projectName: 'demo' });
    const exec = await executeTool(runScript('getProjectInfo'));

    expect(exec.ok).toBe(true);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('surfaces a handler error as an error tool_result without retrying (non-retryable)', async () => {
    callRunScript.mockResolvedValue({ status: 'error', errorCode: 'LAYER_NOT_FOUND', message: 'no layer 9' });
    const exec = await executeTool(runScript('setLayerProperties'));

    expect(callRunScript).toHaveBeenCalledTimes(1);
    expect(exec.ok).toBe(false);
    expect(exec.errorCode).toBe('LAYER_NOT_FOUND');
    expect(exec.block.is_error).toBe(true);
    expect(exec.retried).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('retries a RENDER_FAILED exactly once', async () => {
    // The retry path is generic (any RETRYABLE error code); exercise it with a callable command —
    // saveFrameToPng is internal and now blocked before it could ever reach this path.
    callRunScript
      .mockResolvedValueOnce({ status: 'error', errorCode: 'RENDER_FAILED', message: 'flush race' })
      .mockResolvedValueOnce({ status: 'success' });
    const exec = await executeTool(runScript('createLayer'));

    expect(callRunScript).toHaveBeenCalledTimes(2);
    expect(exec.ok).toBe(true);
    expect(exec.retried).toBe(true);
  });

  it('translates batch sub-commands from {script,parameters} to the bridge {command,args} shape', async () => {
    callRunScript.mockResolvedValue({ status: 'success' });
    const tool: ToolUse = {
      id: 'b',
      name: 'batch',
      input: {
        commands: [
          { script: 'createLayer', parameters: { type: 'solid' } },
          { script: 'setLayerKeyframe', parameters: { propertyName: 'Opacity', value: 0, timeInSeconds: 0 } },
        ],
        groupLabel: 'add',
      },
    };
    await executeTool(tool);

    expect(callRunScript).toHaveBeenCalledWith('batch', {
      commands: [
        { command: 'createLayer', args: { type: 'solid' } },
        { command: 'setLayerKeyframe', args: { propertyName: 'Opacity', value: 0, timeInSeconds: 0 } },
      ],
      groupLabel: 'add',
      __undoLabel: expect.any(String),
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('coerces stringified `parameters` (Haiku quirk) into a real object instead of throwing on __undoLabel', async () => {
    callRunScript.mockResolvedValue({ status: 'success' });
    // Haiku sometimes emits parameters as a JSON STRING. Pre-fix, `args.__undoLabel = …` threw
    // "Cannot create property on string", orphaning the tool_use and 400ing the whole conversation.
    const tool: ToolUse = {
      id: 't',
      name: 'runScript',
      input: { script: 'setLayerProperty', parameters: '{"layerIndex": 2, "propertyName": "Position"}' },
    };
    const exec = await executeTool(tool);

    expect(callRunScript).toHaveBeenCalledWith('setLayerProperty', {
      layerIndex: 2,
      propertyName: 'Position',
      __undoLabel: expect.any(String),
    });
    expect(exec.ok).toBe(true);
    expect(exec.block.is_error).toBe(false);
  });

  it('never throws on un-parseable args — returns an INTERNAL_ERROR tool_result so the tool_use stays paired', async () => {
    callRunScript.mockResolvedValue({ status: 'success' });
    // A garbage string for parameters can't be parsed → coerced to {} → still a valid, paired result.
    const tool: ToolUse = { id: 't', name: 'runScript', input: { script: 'setLayerProperty', parameters: 'not json' } };
    const exec = await executeTool(tool);

    expect(exec.block.tool_use_id).toBe('t'); // a tool_result always comes back → never an orphan
    expect(callRunScript).toHaveBeenCalledWith('setLayerProperty', { __undoLabel: expect.any(String) });
    expect(exec.ok).toBe(true);
  });

  it('blocks an internal/hidden command (saveFrameToPng) without hitting the bridge', async () => {
    const exec = await executeTool(runScript('saveFrameToPng'));

    expect(callRunScript).not.toHaveBeenCalled();
    expect(exec.ok).toBe(false);
    expect(exec.errorCode).toBe('UNKNOWN_COMMAND');
    expect(exec.block.is_error).toBe(true);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('blocks an unknown command name without hitting the bridge', async () => {
    const exec = await executeTool(runScript('totallyMadeUpCommand'));

    expect(callRunScript).not.toHaveBeenCalled();
    expect(exec.ok).toBe(false);
    expect(exec.errorCode).toBe('UNKNOWN_COMMAND');
  });

  it('blocks a batch carrying a hidden sub-command before any sub-command runs', async () => {
    const tool: ToolUse = {
      id: 'b',
      name: 'batch',
      input: { commands: [{ script: 'createLayer', parameters: {} }, { script: 'saveFrameToPng', parameters: {} }] },
    };
    const exec = await executeTool(tool);

    expect(callRunScript).not.toHaveBeenCalled();
    expect(exec.ok).toBe(false);
    expect(exec.errorCode).toBe('UNKNOWN_COMMAND');
  });

  it('turns a transport throw into a BRIDGE_ERROR tool_result instead of throwing', async () => {
    callRunScript.mockRejectedValue(new Error('timed out after 10s'));
    const exec = await executeTool(runScript('createLayer'));

    expect(exec.ok).toBe(false);
    expect(exec.errorCode).toBe('BRIDGE_ERROR');
    expect(exec.block.is_error).toBe(true);
    expect(exec.block.content).toContain('timed out');
    expect(invalidate).not.toHaveBeenCalled();
  });
});
