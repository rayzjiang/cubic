import { describe, it, expect } from 'vitest';
import { formatStateForPrompt } from './format.js';
import type { LiveAEState } from './buildContext.js';

const fullState: LiveAEState = {
  project: { name: 'demo.aep', itemCount: 10, compositionCount: 3 },
  activeComp: { name: 'Main', width: 1920, height: 1080, fps: 30, duration: 10, numLayers: 5 },
  playhead: 2.5,
  frame: 75,
  selectedLayers: [{ index: 2, name: 'Logo', type: 'solid', enabled: true, threeDLayer: false, inPoint: 0, outPoint: 10, parent: null }],
};

const nullState: LiveAEState = {
  project: null,
  activeComp: null,
  playhead: null,
  frame: null,
  selectedLayers: [],
};

describe('formatStateForPrompt', () => {
  it('wraps output in <live_ae_state> XML tags', () => {
    const out = formatStateForPrompt(fullState);
    expect(out).toMatch(/^<live_ae_state>/);
    expect(out).toMatch(/<\/live_ae_state>$/);
  });

  it('includes activeComp fields in full state', () => {
    const out = formatStateForPrompt(fullState);
    expect(out).toContain('"name": "Main"');
    expect(out).toContain('"width": 1920');
    expect(out).toContain('"fps": 30');
    expect(out).toContain('"duration": 10');
  });

  it('includes playhead and selectedLayers in full state', () => {
    const out = formatStateForPrompt(fullState);
    expect(out).toContain('"playhead": 2.5');
    expect(out).toContain('"name": "Logo"');
    expect(out).toContain('"type": "solid"');
  });

  it('handles null state without throwing', () => {
    const out = formatStateForPrompt(nullState);
    expect(out).toContain('<live_ae_state>');
    expect(out).toContain('</live_ae_state>');
    expect(out).toContain('"playhead": null');
    expect(out).toContain('"selectedLayers": []');
  });

  it('body is valid JSON', () => {
    const out = formatStateForPrompt(fullState);
    const inner = out.replace('<live_ae_state>', '').replace('</live_ae_state>', '').trim();
    const parsed = JSON.parse(inner);
    expect(parsed).toBeTypeOf('object');
    expect(parsed.playhead).toBe(2.5);
    expect(parsed.activeComp.name).toBe('Main');
  });

  it('emits empty selectedLayers array when no layers selected', () => {
    const state: LiveAEState = { ...fullState, selectedLayers: [] };
    const out = formatStateForPrompt(state);
    const parsed = JSON.parse(out.replace('<live_ae_state>', '').replace('</live_ae_state>', '').trim());
    expect(parsed.selectedLayers).toEqual([]);
  });
});
