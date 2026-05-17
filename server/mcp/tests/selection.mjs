// selection.mjs — tests for setSelectedLayers in layers.jsx
//
// Covers:
//   setSelectedLayers  (U — select by index, by name, clear all, clearOthers:false)
//   getSelectedLayers  (R — verify round-trip after setSelectedLayers)
//
// Visual verification (after --write, open __MCP_TEST_selection__ in After Effects):
//   Three layers in the timeline. After the test, the last setSelectedLayers call
//   leaves "Layer B" selected (index 2). Other layers are deselected.

import {
  test, send,
  assertNoError, assertField, assertValue, assertArray,
  bold, yellow
} from './helpers.mjs';

const COMP_NAME = '__MCP_TEST_selection__';

export async function run(ctx, opts) {
  console.log(bold('\nSelection Writes'));

  if (!opts.write) return;

  // ── Setup ─────────────────────────────────────────────────────────────────

  const setupOk = await test('setup — create selection test comp with 3 layers', async () => {
    const cr = await send('createComposition', {
      name: COMP_NAME, width: 1920, height: 1080, frameRate: 30, duration: 5, pixelAspect: 1
    });
    assertField(cr, 'composition', 'object');

    // Create 3 solid layers (each lands at index 1, pushing others down)
    for (const name of ['Layer C', 'Layer B', 'Layer A']) {
      const lr = await send('createLayer', {
        compName: COMP_NAME, type: 'solid', name,
        size: [200, 200], color: [0.3, 0.3, 0.3]
      });
      assertNoError(lr);
    }
    // Final stack (index 1=A, 2=B, 3=C after insertion order)
    return '3 solid layers created';
  });

  if (!setupOk) {
    console.log(yellow('  Selection tests skipped — setup failed'));
    return;
  }

  // ── Select by index ───────────────────────────────────────────────────────

  await test('setSelectedLayers — select layer index 1 and 3', async () => {
    const r = await send('setSelectedLayers', {
      compName: COMP_NAME, layerIndices: [1, 3]
    });
    assertNoError(r);
    assertArray(r, 'selectedLayers');
    if (r.count !== 2) throw new Error(`Expected count=2, got ${r.count}`);
    const indices = r.selectedLayers.map(l => l.index);
    if (!indices.includes(1)) throw new Error('Layer 1 not in selectedLayers');
    if (!indices.includes(3)) throw new Error('Layer 3 not in selectedLayers');
  });

  await test('getSelectedLayers — round-trip confirms indices 1 and 3', async () => {
    const r = await send('getSelectedLayers', { compName: COMP_NAME });
    assertNoError(r);
    assertArray(r, 'selectedLayers');
    if (r.count !== 2) throw new Error(`Expected 2 selected, got ${r.count}`);
    const indices = r.selectedLayers.map(l => l.index);
    if (!indices.includes(1) || !indices.includes(3)) {
      throw new Error(`Expected [1,3], got [${indices.join(',')}]`);
    }
  });

  // ── Select by name ────────────────────────────────────────────────────────

  await test('setSelectedLayers — select "Layer B" by name', async () => {
    const r = await send('setSelectedLayers', {
      compName: COMP_NAME, layerNames: ['Layer B']
    });
    assertNoError(r);
    if (r.count !== 1) throw new Error(`Expected count=1, got ${r.count}`);
    if (r.selectedLayers[0].name !== 'Layer B') {
      throw new Error(`Expected "Layer B", got "${r.selectedLayers[0].name}"`);
    }
  });

  // ── clearOthers:false ─────────────────────────────────────────────────────

  await test('setSelectedLayers — clearOthers:false adds to existing selection', async () => {
    // "Layer B" is currently selected; add "Layer A" without clearing
    const r = await send('setSelectedLayers', {
      compName: COMP_NAME, layerIndices: [1], clearOthers: false
    });
    assertNoError(r);
    // Should now have both Layer A (index 1) and Layer B selected
    if (r.count < 2) throw new Error(`Expected ≥2 selected with clearOthers:false, got ${r.count}`);
  });

  // ── Clear all ─────────────────────────────────────────────────────────────

  await test('setSelectedLayers — empty arrays clears selection', async () => {
    const r = await send('setSelectedLayers', {
      compName: COMP_NAME, layerIndices: []
    });
    assertNoError(r);
    if (r.count !== 0) throw new Error(`Expected count=0 after clear, got ${r.count}`);
  });

  // ── Error paths ───────────────────────────────────────────────────────────

  await test('setSelectedLayers — out-of-bounds index returns error', async () => {
    const r = await send('setSelectedLayers', {
      compName: COMP_NAME, layerIndices: [99]
    });
    assertValue(r, 'status', 'error');
    if (!r.message || !r.message.includes('out of bounds')) {
      throw new Error('Expected "out of bounds" in error message');
    }
  });

  await test('setSelectedLayers — unknown layer name returns error', async () => {
    const r = await send('setSelectedLayers', {
      compName: COMP_NAME, layerNames: ['NonExistent']
    });
    assertValue(r, 'status', 'error');
    if (!r.message || !r.message.includes('NonExistent')) {
      throw new Error('Expected layer name in error message');
    }
  });
}
