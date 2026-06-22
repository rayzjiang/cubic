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
  it('DROPS configurableProperties + status by default (model pulls on demand)', () => {
    const input = JSON.stringify({
      status: 'success',
      layer: { name: 'BG', index: 1 },
      configurableProperties: [{ p: ['Transform', 'Opacity'], k: true }],
    });
    const out = JSON.parse(trimConfigurableProperties(input, 'createLayer'));
    expect(out).toEqual({ layer: { name: 'BG', index: 1 } }); // catalog + status gone, identity kept
  });

  it('KEEPS the drill-down catalog ({p,k}/{p,g}/{truncated}) for getLayerProperties', () => {
    const catalog = [
      { p: ['Transform', 'Opacity'], k: true },
      { p: ['Effects'], g: true },
      { truncated: true },
    ];
    const input = JSON.stringify({ status: 'success', configurableProperties: catalog });
    const out = JSON.parse(trimConfigurableProperties(input, 'getLayerProperties'));
    expect(out.configurableProperties).toEqual(catalog); // verbatim — it IS the requested signal
    expect(out.status).toBeUndefined();
  });

  describe('status elimination (is_error conveys success/error)', () => {
    it('success → drops status AND boilerplate message, keeps payload', () => {
      const input = JSON.stringify({ status: 'success', message: 'Text layer created successfully', layer: { name: 'Y', index: 1, type: 'text' } });
      expect(JSON.parse(trimConfigurableProperties(input, 'createLayer'))).toEqual({ layer: { name: 'Y', index: 1, type: 'text' } });
    });
    it('error → drops the status word, keeps errorCode + message', () => {
      const input = JSON.stringify({ status: 'error', errorCode: 'LAYER_NOT_FOUND', message: 'no layer 9' });
      expect(JSON.parse(trimConfigurableProperties(input, 'setLayerProperty'))).toEqual({ errorCode: 'LAYER_NOT_FOUND', message: 'no layer 9' });
    });
    it('noop → drops status, adds noop:true, keeps message (is_error is false for a noop)', () => {
      const input = JSON.stringify({ status: 'noop', message: 'already at earliest restore point' });
      expect(JSON.parse(trimConfigurableProperties(input, 'restoreProject'))).toEqual({ noop: true, message: 'already at earliest restore point' });
    });
    it('warning → drops status, keeps the warning field + payload', () => {
      const input = JSON.stringify({ status: 'warning', warning: 'effect added but a setting did not stick', layer: { name: 'X' } });
      expect(JSON.parse(trimConfigurableProperties(input, 'applyEffect'))).toEqual({ warning: 'effect added but a setting did not stick', layer: { name: 'X' } });
    });
  });

  it('drops historical-echo keys (previous*/prev*/old*) at any depth; modifiedLayers survives', () => {
    const input = JSON.stringify({
      status: 'success',
      previousValues: { opacity: 50 }, previousPositions: [[0, 0]], prevPos: [1, 2], older: 3, oldThing: 4,
      modifiedLayers: [{ index: 1, name: 'A' }],
      nested: { previousParent: 'Null 1' },
    });
    const out = JSON.parse(trimConfigurableProperties(input, 'alignLayers'));
    expect(out).toEqual({ modifiedLayers: [{ index: 1, name: 'A' }], nested: {} });
  });

  it('collapses the generic batch envelope (all-success): drops counts, inlines sub-payloads, preserves length', () => {
    const input = JSON.stringify({
      status: 'success', total: 2, executed: 2, succeeded: 2, failed: 0, noopCount: 0, stoppedEarly: false,
      results: [
        { index: 0, command: 'createLayer', success: true, status: 'success', result: { status: 'success', message: 'created', layer: { name: 'A', index: 1 }, configurableProperties: [{ p: ['Transform', 'Opacity'], k: true }] } },
        { index: 1, command: 'alignLayers', success: true, status: 'success', result: { status: 'success', modifiedLayers: [{ index: 1 }] } },
      ],
    });
    const out = JSON.parse(trimConfigurableProperties(input, 'batch'));
    expect(out.total).toBeUndefined();
    expect(out.status).toBeUndefined();
    expect(out.results).toHaveLength(2);
    expect(out.results[0]).toEqual({ layer: { name: 'A', index: 1 } }); // inlined payload, catalog dropped
    expect(out.results[1]).toEqual({ modifiedLayers: [{ index: 1 }] });
  });

  it('collapses the batch envelope (partial failure): keeps WHICH+WHY on the failed sub, drops envelope errorCode', () => {
    const input = JSON.stringify({
      status: 'error', total: 2, failed: 1, errorCode: 'BATCH_FAILED',
      results: [
        { index: 0, command: 'createLayer', success: true, status: 'success', result: { status: 'success', layer: { name: 'A', index: 1 } } },
        { index: 1, command: 'deleteLayer', success: false, status: 'error', result: { status: 'error', errorCode: 'LAYER_NOT_FOUND', message: 'gone' } },
      ],
    });
    const out = JSON.parse(trimConfigurableProperties(input, 'batch'));
    expect(out.errorCode).toBeUndefined(); // envelope BATCH_FAILED marker — is_error conveys it
    expect(out.results).toHaveLength(2);
    expect(out.results[0]).toEqual({ layer: { name: 'A', index: 1 } });
    expect(out.results[1]).toEqual({ command: 'deleteLayer', errorCode: 'LAYER_NOT_FOUND', message: 'gone' });
  });

  it('collapses a setLayerProperties receipt to identity + changed props + final values', () => {
    const input = JSON.stringify({
      status: 'success', message: 'Layer properties updated successfully',
      layer: {
        name: 'Hello', index: 1, threeDLayer: false,
        position: [660, 629, 0], scale: [100, 100, 100], rotation: 0, opacity: 100,
        anchorPoint: [0, 0, 0], inPoint: 0, outPoint: 10, stretch: 100,
        changedProperties: ['fontSize', 'fillColor'], text: 'Hello', fontFamily: 'Sarabun', fontSize: 300, fillColor: [1, 0, 0],
      },
      previousValues: { fontSize: 245, fillColor: [1, 1, 1] },
    });
    const out = JSON.parse(trimConfigurableProperties(input, 'setLayerProperties'));
    expect(out).toEqual({ layer: { name: 'Hello', index: 1, changedProperties: ['fontSize', 'fillColor'], fontSize: 300, fillColor: [1, 0, 0] } });
  });

  it('keeps changedProperties:[] as the noop signal', () => {
    const input = JSON.stringify({ status: 'success', layer: { name: 'X', index: 2, position: [0, 0], changedProperties: [] } });
    const out = JSON.parse(trimConfigurableProperties(input, 'setLayerProperties'));
    expect(out.layer).toEqual({ name: 'X', index: 2, changedProperties: [] });
  });

  it('collapses batchSetLayerProperties: success subs to identity+changed, error subs keep errorCode+message, length preserved', () => {
    const input = JSON.stringify({
      status: 'success',
      results: [
        { layerIndex: 1, name: 'A', status: 'success', threeDLayer: false, position: [10, 20], scale: [100, 100, 100], opacity: 100, changedProperties: ['scale'], previousValues: { scale: [50, 50, 50] } },
        { layerIndex: 2, name: 'B', status: 'error', errorCode: 'LAYER_NOT_FOUND', message: 'gone' },
      ],
    });
    const out = JSON.parse(trimConfigurableProperties(input, 'batchSetLayerProperties'));
    expect(out.results).toHaveLength(2);
    expect(out.results[0]).toEqual({ layerIndex: 1, name: 'A', changedProperties: ['scale'], scale: [100, 100, 100] });
    expect(out.results[1]).toEqual({ layerIndex: 2, name: 'B', errorCode: 'LAYER_NOT_FOUND', message: 'gone' });
  });

  it('trims getLayerProperty: drops name/path/isTimeVarying, keeps value/numKeys/expression', () => {
    const input = JSON.stringify({ status: 'success', property: { name: 'Opacity', path: ['Transform', 'Opacity'], value: 100, numKeys: 2, isTimeVarying: true, canSetExpression: true, hasExpression: false, expression: '' } });
    const out = JSON.parse(trimConfigurableProperties(input, 'getLayerProperty'));
    expect(out).toEqual({ property: { value: 100, numKeys: 2, canSetExpression: true, hasExpression: false, expression: '' } });
  });

  it('leaves read results (e.g. keyframes, fonts) untouched', () => {
    const input = JSON.stringify({ keyframes: [{ t: 0, value: [100, 100, 100] }], fonts: ['Impact', 'Arial'] });
    expect(JSON.parse(trimConfigurableProperties(input, 'getLayerKeyframes'))).toEqual({ keyframes: [{ t: 0, value: [100, 100, 100] }], fonts: ['Impact', 'Arial'] });
  });

  it('returns non-JSON content unchanged', () => {
    expect(trimConfigurableProperties('plain string result', 'createLayer')).toBe('plain string result');
  });

  it('still drops catalog + previous* + status with no command arg (back-compat default)', () => {
    const input = JSON.stringify({ configurableProperties: [{ p: ['Transform', 'Opacity'], k: true }], previousValues: { opacity: 0 }, status: 'success', layer: { name: 'Z' } });
    expect(JSON.parse(trimConfigurableProperties(input))).toEqual({ layer: { name: 'Z' } });
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
