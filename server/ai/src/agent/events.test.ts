import { describe, it, expect } from 'vitest';
import { describeToolResult, describeToolCall } from './events.js';

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
