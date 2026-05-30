import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './buildSystemPrompt.js';
import { STATIC_RULES } from './rules.js';
import type { LiveAEState } from '../context/buildContext.js';

const fullState: LiveAEState = {
  project: { name: 'demo.aep', itemCount: 10, compositionCount: 3 },
  activeComp: { name: 'Main', width: 1920, height: 1080, fps: 30, duration: 10, numLayers: 5 },
  playhead: 2.5,
  frame: 75,
  selectedLayers: [],
};

const nullState: LiveAEState = {
  project: null,
  activeComp: null,
  playhead: null,
  frame: null,
  selectedLayers: [],
};

describe('buildSystemPrompt', () => {
  it('starts with STATIC_RULES', () => {
    const out = buildSystemPrompt(fullState);
    expect(out.startsWith(STATIC_RULES)).toBe(true);
  });

  it('contains <live_ae_state> block', () => {
    const out = buildSystemPrompt(fullState);
    expect(out).toContain('<live_ae_state>');
    expect(out).toContain('</live_ae_state>');
  });

  it('rules come before the state block', () => {
    const out = buildSystemPrompt(fullState);
    const rulesIdx = out.indexOf(STATIC_RULES);
    const stateIdx = out.indexOf('<live_ae_state>');
    expect(rulesIdx).toBeLessThan(stateIdx);
  });

  it('two blank lines separate sections', () => {
    const out = buildSystemPrompt(fullState);
    expect(out).toContain(`${STATIC_RULES}\n\n<live_ae_state>`);
  });

  it('handles null state without throwing', () => {
    expect(() => buildSystemPrompt(nullState)).not.toThrow();
    const out = buildSystemPrompt(nullState);
    expect(out).toContain(STATIC_RULES);
    expect(out).toContain('<live_ae_state>');
  });
});
