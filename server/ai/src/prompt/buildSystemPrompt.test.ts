import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './buildSystemPrompt.js';
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
  it('splits into a cached prefix and a volatile suffix', () => {
    const out = buildSystemPrompt(fullState);
    expect(typeof out.cached).toBe('string');
    expect(typeof out.volatile).toBe('string');
  });

  it('cached prefix contains the generated command catalog (placeholder resolved)', () => {
    const { cached } = buildSystemPrompt(fullState);
    expect(cached).toContain('<command_catalog>');
    // Generated, previously-hidden params must be present.
    expect(cached).toContain('setCompositionProperties(');
    expect(cached).toContain('shutterAngle');
    // The placeholder must have been replaced.
    expect(cached).not.toContain('{{COMMAND_CATALOG}}');
  });

  it('cached prefix carries the design-knowledge sections', () => {
    const { cached } = buildSystemPrompt(fullState);
    expect(cached).toContain('<motion_design_principles>');
    expect(cached).toContain('<visual_design>');
    expect(cached).toContain('<editing_craft>');
  });

  it('cached prefix does NOT contain the volatile state block', () => {
    const out = buildSystemPrompt(fullState);
    // The rules prose may reference the <live_ae_state> tag name, but the actual
    // state block (closing tag + data) must live only in the volatile half.
    expect(out.cached).not.toContain('</live_ae_state>');
    expect(out.cached.includes(out.volatile ?? '')).toBe(false);
  });

  it('volatile suffix carries the live AE state block', () => {
    const { volatile } = buildSystemPrompt(fullState);
    expect(volatile).toContain('<live_ae_state>');
    expect(volatile).toContain('</live_ae_state>');
  });

  it('cached prefix is identical across turns (byte-stable for caching)', () => {
    expect(buildSystemPrompt(fullState).cached).toBe(buildSystemPrompt(nullState).cached);
  });

  it('handles null state without throwing', () => {
    expect(() => buildSystemPrompt(nullState)).not.toThrow();
    expect(buildSystemPrompt(nullState).volatile).toContain('<live_ae_state>');
  });
});
