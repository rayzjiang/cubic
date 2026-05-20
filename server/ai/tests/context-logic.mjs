// context-logic.mjs — tests for formatStateForPrompt()
//
// Covers:
//   formatStateForPrompt (full state)
//   formatStateForPrompt (null/empty state — no AE open)
//   formatStateForPrompt (comp open, no layers selected)
//   body is valid JSON parseable from inside the XML tags
//
// No AE required — pure logic tests.

import { formatStateForPrompt } from '../build/index.js';
import { test, assert, assertEqual, assertContains, bold } from './helpers.mjs';

export async function run(_ctx, _opts) {
  console.log(bold('\nContext Logic'));

  await test('formats full state into <live_ae_state> XML block', () => {
    const state = {
      project: { name: 'demo.aep', itemCount: 10, compositionCount: 3 },
      activeComp: { name: 'Main', width: 1920, height: 1080, fps: 30, duration: 10, numLayers: 5 },
      playhead: 2.5,
      selectedLayers: [{ index: 2, name: 'Logo', type: 'solid', enabled: true, threeDLayer: false, parent: null }],
    };
    const out = formatStateForPrompt(state);
    assertContains(out, '<live_ae_state>',   'missing opening tag');
    assertContains(out, '</live_ae_state>',  'missing closing tag');
    assertContains(out, '"name": "Main"',    'missing activeComp name');
    assertContains(out, '"playhead": 2.5',   'missing playhead');
    assertContains(out, '"name": "Logo"',    'missing selected layer name');
    assertContains(out, '"width": 1920',     'missing width');
    assertContains(out, '"fps": 30',         'missing fps');
    return 'full state round-trip';
  });

  await test('formats null state gracefully (no AE open)', () => {
    const state = { project: null, activeComp: null, playhead: null, selectedLayers: [] };
    const out = formatStateForPrompt(state);
    assertContains(out, '<live_ae_state>',       'missing opening tag');
    assertContains(out, '</live_ae_state>',      'missing closing tag');
    assertContains(out, '"playhead": null',      'missing null playhead');
    assertContains(out, '"selectedLayers": []',  'missing empty array');
    return 'null state handled';
  });

  await test('formats state with active comp but no selection', () => {
    const state = {
      project: { name: 'test.aep', itemCount: 4, compositionCount: 2 },
      activeComp: { name: 'Intro', width: 1280, height: 720, fps: 24, duration: 5, numLayers: 3 },
      playhead: 0,
      selectedLayers: [],
    };
    const out = formatStateForPrompt(state);
    assertContains(out, '"selectedLayers": []', 'selection should be empty array');
    assertContains(out, '"name": "Intro"',      'missing comp name');
    return 'no selection';
  });

  await test('body inside tags is valid JSON', () => {
    const state = {
      project: { name: 'x.aep', itemCount: 1, compositionCount: 1 },
      activeComp: { name: 'C', width: 960, height: 540, fps: 25, duration: 3, numLayers: 1 },
      playhead: 1.0,
      selectedLayers: [],
    };
    const out = formatStateForPrompt(state);
    const inner = out.replace('<live_ae_state>', '').replace('</live_ae_state>', '').trim();
    let parsed;
    try { parsed = JSON.parse(inner); }
    catch (e) { throw new Error(`body is not valid JSON: ${e.message}`); }
    assert(typeof parsed === 'object' && parsed !== null, 'parsed body must be an object');
    assertEqual(parsed.playhead, 1.0,  'playhead');
    assertEqual(parsed.activeComp.name, 'C', 'comp name');
    return 'JSON parses cleanly';
  });
}
