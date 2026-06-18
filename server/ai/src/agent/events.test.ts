import { describe, it, expect } from 'vitest';
import { describeToolResult, describeToolCall, describeToolNoop } from './events.js';

/** Helper: build a runScript tool input + its handler result. */
const run = (script: string, parameters: Record<string, unknown> = {}) => ({
  name: 'runScript',
  input: { script, parameters },
});

describe('describeToolResult', () => {
  it('uses the resolved name from the result even when the model targeted by index', () => {
    const { name, input } = run('deleteLayer', { layerIndex: 3 }); // no name in the INPUT
    const result = { status: 'success', deleted: { name: 'BG Solid', index: 3 } };
    expect(describeToolResult(name, input, result)).toBe('Deleted layer "BG Solid"');
  });

  it('shows a clean scalar value with an inferred unit', () => {
    const { name, input } = run('setLayerProperty', { propertyPath: ['Transform', 'Opacity'] });
    const result = { status: 'success', property: { name: 'Opacity', value: 50 }, previousValue: 100 };
    expect(describeToolResult(name, input, result)).toBe('Set Opacity to 50%');
  });

  it('falls back to name-only for a messy (vector) value', () => {
    const { name, input } = run('setLayerProperty', { propertyPath: ['Transform', 'Position'] });
    const result = { status: 'success', property: { name: 'Position', value: [960, 540, 0] } };
    expect(describeToolResult(name, input, result)).toBe('Set Position');
  });

  it('names both the effect and the layer', () => {
    const { name, input } = run('deleteEffect', { effectIndex: 1 });
    const result = { status: 'success', deleted: { name: 'Gaussian Blur' }, layer: { name: 'Title' } };
    expect(describeToolResult(name, input, result)).toBe('Removed Gaussian Blur from "Title"');
  });

  it('formats the playhead time', () => {
    const { name, input } = run('setCurrentTime', { timeInSeconds: 2 });
    const result = { status: 'success', compName: 'Main', timeInSeconds: 2, frame: 60 };
    expect(describeToolResult(name, input, result)).toBe('Moved playhead to 2s');
  });

  it('falls back to the input-based label when the result has no specific field', () => {
    const { name, input } = run('deleteLayer', { layerName: 'Logo' });
    // Empty/odd result → no resolved name → falls back to describeToolCall.
    expect(describeToolResult(name, input, {})).toBe(describeToolCall(name, input));
  });

  it('keeps the model-provided groupLabel for batch (no result-based override)', () => {
    const tool = { name: 'batch', input: { commands: [], groupLabel: 'Build the intro' } };
    const result = [{ status: 'success' }, { status: 'success' }];
    expect(describeToolResult(tool.name, tool.input, result)).toBe('Build the intro');
  });

  it('labels the typed createComposition tool from its result', () => {
    const tool = { name: 'createComposition', input: { name: 'Intro', width: 1920, height: 1080 } };
    const result = { status: 'success', composition: { name: 'Intro', id: 7 } };
    expect(describeToolResult(tool.name, tool.input, result)).toBe('Created composition "Intro"');
  });
});

describe('describeToolCall — batch label (drives the undo-group name)', () => {
  // batch is normally invoked via runScript({ script: 'batch', parameters: {...} }) per the prompt.
  const batch = (parameters: Record<string, unknown>) => ({ name: 'runScript', input: { script: 'batch', parameters } });

  it('prefers the model-provided groupLabel', () => {
    const { name, input } = batch({ commands: [{ command: 'createLayer', args: { type: 'text' } }], groupLabel: 'animate intro title' });
    expect(describeToolCall(name, input)).toBe('animate intro title');
  });

  it('synthesizes a descriptive label from sub-commands when groupLabel is missing', () => {
    const { name, input } = batch({
      commands: [
        { command: 'createLayer', args: { type: 'text', name: 'Title' } },
        { command: 'applyEffect', args: { effectName: 'Glow' } },
        { command: 'setLayerKeyframe', args: { propertyName: 'Opacity' } },
      ],
    });
    // First sub-command's friendly label + a count of the rest — never exposes "batch".
    expect(describeToolCall(name, input)).toBe('Added text layer "Title" + 2 more');
  });

  it('uses just the single sub-command label for a one-command batch', () => {
    const { name, input } = batch({ commands: [{ command: 'applyEffect', args: { effectName: 'Glow' } }] });
    expect(describeToolCall(name, input)).toBe('Applied Glow');
  });
});

describe('describeToolNoop — muted-row label when a handler changed nothing', () => {
  const run = (script: string, parameters: Record<string, unknown> = {}) => ({
    name: 'runScript',
    input: { script, parameters },
  });

  it('uses the per-command phrase for a known noop command', () => {
    const { name, input } = run('setLayerProperty', { propertyPath: ['Transform', 'Opacity'], value: 50 });
    expect(describeToolNoop(name, input)).toBe('Already set to that value');
  });

  it('phrases the nothing-to-remove commands honestly', () => {
    const keys = run('removePropertyKeyframes');
    expect(describeToolNoop(keys.name, keys.input)).toBe('No keyframes to remove');
    const solids = run('deleteUnusedSolids');
    expect(describeToolNoop(solids.name, solids.input)).toBe('No unused solids to remove');
    const markers = run('removeMarker', { all: true });
    expect(describeToolNoop(markers.name, markers.input)).toBe('No markers to remove');
  });

  it('branches on the request for setLayerParent (parent vs unparent)', () => {
    const set = run('setLayerParent', { parentIndex: 2 });
    expect(describeToolNoop(set.name, set.input)).toBe('Already has that parent');
    const clear = run('setLayerParent', {});
    expect(describeToolNoop(clear.name, clear.input)).toBe('Already has no parent');
  });

  it('branches on the request for setTimeRemapEnabled (enable vs disable)', () => {
    const on = run('setTimeRemapEnabled', { enabled: true });
    expect(describeToolNoop(on.name, on.input)).toBe('Already enabled');
    const off = run('setTimeRemapEnabled', { enabled: false });
    expect(describeToolNoop(off.name, off.input)).toBe('Already disabled');
  });

  it('branches on the request for setLayerExpression (set vs remove)', () => {
    const set = run('setLayerExpression', { propertyName: 'Opacity', expressionString: 'wiggle(2,30)' });
    expect(describeToolNoop(set.name, set.input)).toBe('Expression already set');
    const remove = run('setLayerExpression', { propertyName: 'Opacity', expressionString: '' });
    expect(describeToolNoop(remove.name, remove.input)).toBe('No expression to remove');
  });

  it('labels the typed batch tool and a runScript-wrapped batch', () => {
    expect(describeToolNoop('batch', { commands: [] })).toBe('No changes needed');
    const wrapped = run('batch', { commands: [] });
    expect(describeToolNoop(wrapped.name, wrapped.input)).toBe('No changes needed');
  });

  it('falls back to a generic phrase for an un-mapped command (any future noop reads honestly)', () => {
    const { name, input } = run('someBrandNewCommand');
    expect(describeToolNoop(name, input)).toBe('No change');
    expect(describeToolNoop('createComposition', { name: 'X' })).toBe('No change');
  });
});
