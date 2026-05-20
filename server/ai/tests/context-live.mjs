// context-live.mjs — end-to-end tests for buildContext() with live After Effects
//
// Covers:
//   buildContext()         — full pipeline: MCP client → AE → LiveAEState
//   activeComp fields      — name, width, height, fps, duration, numLayers
//   playhead               — returns a number when a comp is open
//   selectedLayers         — shape of layer entries
//   formatStateForPrompt   — wraps live state in valid XML + JSON
//
// Requires: After Effects open + MCP panel connected

import { buildContext, formatStateForPrompt, mcpClient } from '../build/index.js';
import { test, assert, assertContains, bold, dim, yellow } from './helpers.mjs';

export async function run(_ctx, _opts) {
  console.log(bold('\nContext Live'));

  await test('buildContext() returns without throwing', async () => {
    const state = await buildContext();
    assert(typeof state === 'object' && state !== null, 'state must be an object');
    assert('selectedLayers' in state,  'missing selectedLayers');
    assert('activeComp'     in state,  'missing activeComp');
    assert('playhead'       in state,  'missing playhead');
    assert('project'        in state,  'missing project');
    assert(Array.isArray(state.selectedLayers), 'selectedLayers must be an array');
    if (!state.activeComp && !state.project) {
      return 'AE reachable but no project open — null state returned as expected';
    }
    return 'populated';
  });

  await test('activeComp has all required fields when a comp is open', async () => {
    const state = await buildContext();
    if (!state.activeComp) {
      console.log(yellow('\n    Skipped — no active comp in AE'));
      return 'skipped';
    }
    const { name, width, height, fps, duration, numLayers } = state.activeComp;
    assert(typeof name      === 'string' && name.length > 0, `name must be non-empty string, got ${JSON.stringify(name)}`);
    assert(typeof width     === 'number' && width > 0,       `width must be positive number, got ${width}`);
    assert(typeof height    === 'number' && height > 0,      `height must be positive number, got ${height}`);
    assert(typeof fps       === 'number' && fps > 0,         `fps must be positive number, got ${fps}`);
    assert(typeof duration  === 'number' && duration > 0,    `duration must be positive number, got ${duration}`);
    assert(typeof numLayers === 'number',                    `numLayers must be a number, got ${numLayers}`);
    return `${name} (${width}x${height} @ ${fps}fps)`;
  });

  await test('playhead is a number when a comp is open', async () => {
    const state = await buildContext();
    if (!state.activeComp) {
      console.log(yellow('\n    Skipped — no active comp'));
      return 'skipped';
    }
    assert(typeof state.playhead === 'number', `playhead must be a number, got ${typeof state.playhead}`);
    return `${state.playhead}s`;
  });

  await test('selectedLayers entries have required fields', async () => {
    const state = await buildContext();
    if (state.selectedLayers.length === 0) {
      return 'no layers selected — select a layer in AE to verify shape';
    }
    for (const layer of state.selectedLayers) {
      assert(typeof layer.index   === 'number',  `layer.index must be number, got ${typeof layer.index}`);
      assert(typeof layer.name    === 'string',  'layer.name must be string');
      assert(typeof layer.type    === 'string',  'layer.type must be string');
      assert(typeof layer.enabled === 'boolean', 'layer.enabled must be boolean');
    }
    return `${state.selectedLayers.length} layer(s): ${state.selectedLayers.map(l => l.name).join(', ')}`;
  });

  await test('formatStateForPrompt wraps live state in valid XML + JSON', async () => {
    const state = await buildContext();
    const out = formatStateForPrompt(state);
    assertContains(out, '<live_ae_state>',  'missing opening tag');
    assertContains(out, '</live_ae_state>', 'missing closing tag');
    const inner = out.replace('<live_ae_state>', '').replace('</live_ae_state>', '').trim();
    let parsed;
    try { parsed = JSON.parse(inner); }
    catch (e) { throw new Error(`body is not valid JSON: ${e.message}`); }
    assert(typeof parsed === 'object' && parsed !== null, 'body must be an object');
    console.log(dim(`\n\n${out}\n`));
    return 'XML + JSON valid';
  });

  await mcpClient.disconnect();
}
