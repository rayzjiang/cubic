import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './buildSystemPrompt.js';

describe('buildSystemPrompt', () => {
  it('returns a cacheable `cached` prefix (no volatile state block)', () => {
    const out = buildSystemPrompt();
    expect(typeof out.cached).toBe('string');
    // Live AE state now rides at the message tail (see ChatOptions.liveState), never in the system prompt.
    expect('volatile' in out).toBe(false);
  });

  it('cached prefix contains the generated command catalog (placeholder resolved)', () => {
    const { cached } = buildSystemPrompt();
    expect(cached).toContain('<command_catalog>');
    // Generated, previously-hidden params must be present.
    expect(cached).toContain('setCompositionProperties(');
    expect(cached).toContain('shutterAngle');
    // The placeholder must have been replaced.
    expect(cached).not.toContain('{{COMMAND_CATALOG}}');
  });

  it('cached prefix carries the design-knowledge sections', () => {
    const { cached } = buildSystemPrompt();
    expect(cached).toContain('<motion_design_principles>');
    expect(cached).toContain('<visual_design>');
    expect(cached).toContain('<editing_craft>');
  });

  it('cached prefix does NOT contain an actual live-state block', () => {
    // The rules prose may reference the <live_ae_state> tag name, but the actual
    // state block (closing tag + data) must never be in the cached prefix.
    expect(buildSystemPrompt().cached).not.toContain('</live_ae_state>');
  });

  it('cached prefix is byte-stable across calls (for caching)', () => {
    expect(buildSystemPrompt().cached).toBe(buildSystemPrompt().cached);
  });
});
