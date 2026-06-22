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

describe('trimConfigurableProperties (RTK-style result diet)', () => {
  it('DROPS configurableProperties by default (model pulls on demand)', () => {
    const input = JSON.stringify({
      status: 'success',
      layer: { name: 'BG', index: 1 },
      configurableProperties: [
        { n: 'Anchor Point', p: ['Transform', 'Anchor Point'], k: true, v: [960, 540, 0], nk: 0 },
        { n: 'Opacity', p: ['Transform', 'Opacity'], k: true, v: 100, nk: 2 },
      ],
    });
    const out = JSON.parse(trimConfigurableProperties(input, 'createLayer'));
    expect(out.configurableProperties).toBeUndefined();
    expect(out.layer).toEqual({ name: 'BG', index: 1 }); // identity receipt untouched
  });

  it('KEEPS configurableProperties (incl v/nk) for the getLayerProperties pull tool', () => {
    const catalog = [
      { n: 'Anchor Point', p: ['Transform', 'Anchor Point'], k: true, v: [960, 540, 0], nk: 0 },
      { n: 'Opacity', p: ['Transform', 'Opacity'], k: true, v: 100, nk: 2 },
    ];
    const input = JSON.stringify({ status: 'success', configurableProperties: catalog });
    const out = JSON.parse(trimConfigurableProperties(input, 'getLayerProperties'));
    expect(out.configurableProperties).toEqual(catalog); // verbatim — it IS the requested signal
  });

  it('drops configurableProperties nested inside a batch result (any depth)', () => {
    const input = JSON.stringify({
      status: 'success',
      results: [
        { index: 0, command: 'deleteLayer', result: { status: 'success' } },
        { index: 1, command: 'createLayer', result: { layer: { name: 'Rect' }, configurableProperties: [{ n: 'Scale', p: ['Transform', 'Scale'], k: true }] } },
      ],
    });
    const out = JSON.parse(trimConfigurableProperties(input, 'batch'));
    expect(out.results[1].result.configurableProperties).toBeUndefined();
    expect(out.results[1].result.layer).toEqual({ name: 'Rect' });
  });

  it('drops previousValues at every depth, for any command', () => {
    const input = JSON.stringify({
      status: 'success',
      previousValues: { opacity: 50 },
      results: [{ status: 'success', previousValues: { scale: [100, 100, 100] } }],
    });
    const out = JSON.parse(trimConfigurableProperties(input, 'someCommand'));
    expect(out.previousValues).toBeUndefined();
    expect(out.results[0].previousValues).toBeUndefined();
    expect(out.results[0].status).toBe('success');
  });

  it('collapses a setLayerProperties receipt to identity + changed props + final values', () => {
    const input = JSON.stringify({
      status: 'success',
      message: 'Layer properties updated successfully',
      layer: {
        name: 'Hello', index: 1, threeDLayer: false,
        position: [660, 629, 0], scale: [100, 100, 100], rotation: 0, opacity: 100,
        anchorPoint: [0, 0, 0], inPoint: 0, outPoint: 10, stretch: 100,
        changedProperties: ['fontSize', 'fillColor'], text: 'Hello', fontFamily: 'Sarabun', fontSize: 300, fillColor: [1, 0, 0],
      },
      previousValues: { fontSize: 245, fillColor: [1, 1, 1] },
    });
    const out = JSON.parse(trimConfigurableProperties(input, 'setLayerProperties'));
    expect(out.status).toBe('success');
    expect(out.previousValues).toBeUndefined();
    expect(out.layer).toEqual({ name: 'Hello', index: 1, changedProperties: ['fontSize', 'fillColor'], fontSize: 300, fillColor: [1, 0, 0] });
  });

  it('keeps changedProperties:[] as the noop signal', () => {
    const input = JSON.stringify({ status: 'success', layer: { name: 'X', index: 2, position: [0, 0], changedProperties: [] } });
    const out = JSON.parse(trimConfigurableProperties(input, 'setLayerProperties'));
    expect(out.layer).toEqual({ name: 'X', index: 2, changedProperties: [] });
  });

  it('collapses batchSetLayerProperties success results, passes error sub-results through, preserves length', () => {
    const input = JSON.stringify({
      status: 'success',
      results: [
        { layerIndex: 1, name: 'A', status: 'success', threeDLayer: false, position: [10, 20], scale: [100, 100, 100], opacity: 100, changedProperties: ['scale'], previousValues: { scale: [50, 50, 50] } },
        { layerIndex: 2, name: 'B', status: 'error', errorCode: 'LAYER_NOT_FOUND', message: 'gone' },
      ],
    });
    const out = JSON.parse(trimConfigurableProperties(input, 'batchSetLayerProperties'));
    expect(out.results).toHaveLength(2);
    expect(out.results[0]).toEqual({ layerIndex: 1, name: 'A', status: 'success', changedProperties: ['scale'], scale: [100, 100, 100] });
    expect(out.results[1]).toEqual({ layerIndex: 2, name: 'B', status: 'error', errorCode: 'LAYER_NOT_FOUND', message: 'gone' });
  });

  it('leaves read results (e.g. keyframes, fonts) untouched', () => {
    const input = JSON.stringify({ keyframes: [{ t: 0, value: [100, 100, 100] }], fonts: ['Impact', 'Arial'] });
    expect(JSON.parse(trimConfigurableProperties(input, 'getLayerKeyframes'))).toEqual({ keyframes: [{ t: 0, value: [100, 100, 100] }], fonts: ['Impact', 'Arial'] });
  });

  it('returns non-JSON content unchanged', () => {
    expect(trimConfigurableProperties('plain string result', 'createLayer')).toBe('plain string result');
  });

  it('still drops catalog + previousValues with no command arg (back-compat default)', () => {
    const input = JSON.stringify({ configurableProperties: [{ n: 'Opacity', p: ['Transform', 'Opacity'], k: true }], previousValues: { opacity: 0 }, layer: { name: 'Z' } });
    const out = JSON.parse(trimConfigurableProperties(input));
    expect(out).toEqual({ layer: { name: 'Z' } });
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
