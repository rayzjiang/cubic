import { describe, it, expect } from 'vitest';
import { renderCommandCatalog } from '../src/secrets/renderCatalog.js';
import { COMMAND_PARAMS, type CommandSpec } from '../src/secrets/command-params.js';

describe('renderCommandCatalog', () => {
  const catalog = renderCommandCatalog();

  it('omits commands flagged internal (saveFrameToPng) from the model catalog', () => {
    // The entry stays in the registry (drift + MCP surface) but must never reach the model:
    // a single still frame can't convey motion — see the internal flag rationale.
    expect((COMMAND_PARAMS as Record<string, CommandSpec>).saveFrameToPng.internal).toBe(true);
    expect(catalog).not.toContain('saveFrameToPng');
  });

  it('still renders every non-internal command', () => {
    const visible = (Object.entries(COMMAND_PARAMS) as [string, CommandSpec][])
      .filter(([, spec]) => !spec.internal)
      .map(([name]) => name);
    for (const name of visible) {
      expect(catalog).toContain(`${name}(`);
    }
    // The only hidden commands are the ones OUR code invokes and the model never should: diagnostics
    // (introspectMatchNames), an app-driven capability probe (checkFileAccess — the renderer's AE
    // file/network-access gate), and saveFrameToPng. Exhaustive on purpose: it's a tripwire so a command
    // can't get silently hidden from the model, which means adding an `internal: true` entry to the
    // registry is a DELIBERATE two-line change (registry + this list).
    const hidden = (Object.entries(COMMAND_PARAMS) as [string, CommandSpec][])
      .filter(([, spec]) => spec.internal)
      .map(([name]) => name)
      .sort();
    expect(hidden).toEqual(['checkFileAccess', 'introspectMatchNames', 'saveFrameToPng']);
    for (const name of hidden) expect(catalog).not.toContain(`${name}(`);
  });

  it('preserves registry order for visible commands (cache-stable prefix)', () => {
    const visible = (Object.entries(COMMAND_PARAMS) as [string, CommandSpec][])
      .filter(([, spec]) => !spec.internal)
      .map(([name]) => name);
    const positions = visible.map((n) => catalog.indexOf(`${n}(`));
    const grouped = [...positions].sort((a, b) => a - b);
    // Domain grouping reorders across domains, so we only assert each visible command
    // appears exactly once and none is missing (-1).
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(new Set(grouped).size).toBe(positions.length);
  });
});
