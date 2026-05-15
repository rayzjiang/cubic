// effects.mjs — tests for effects.jsx
// Covers: applyEffect, applyEffectTemplate, bridgeTestEffects
// Missing coverage (not yet implemented): getLayerEffects (R), setEffectProperty (U), deleteEffect (D)
//
// Creates its own __MCP_TEST_effects__ comp with a white solid so effects are
// visually obvious (blur, red drop shadow clearly visible on white).

import {
  test, send,
  assertNoError, assertField, assertArray, assertValue,
  bold, yellow
} from './helpers.mjs';

const COMP_NAME = '__MCP_TEST_effects__';

export async function run(ctx, opts) {
  console.log(bold('\nEffects'));

  if (!opts.write) return;

  // ── Setup ─────────────────────────────────────────────────────────────────

  let ci, li;

  const setupOk = await test('setup — create effects test comp + white solid', async () => {
    const cr = await send('createComposition', {
      name: COMP_NAME, width: 1920, height: 1080, frameRate: 30, duration: 10, pixelAspect: 1
    });
    assertField(cr, 'composition', 'object');
    ci = cr.composition.itemIndex;

    const lr = await send('createSolidLayer', {
      compName: COMP_NAME, name: 'Effects Test Solid', color: [1, 1, 1]
    });
    assertNoError(lr);
    li = 1;
    return `comp ${ci}, layer ${li}`;
  });

  if (!setupOk) {
    console.log(yellow('  Effects tests skipped — setup failed'));
    return;
  }

  // ── Effects ───────────────────────────────────────────────────────────────

  await test('applyEffect — Gaussian Blur by matchName, returns effect index', async () => {
    const r = await send('applyEffect', {
      compIndex: ci, layerIndex: li,
      effectMatchName: 'ADBE Gaussian Blur 2',
      effectSettings: { Blurriness: 5 }
    });
    assertNoError(r);
    assertField(r, 'effect', 'object');
    assertField(r.effect, 'name', 'string');
    assertField(r.effect, 'index', 'number');
    assertValue(r.effect, 'type', 'effect');
    assertField(r.layer, 'name', 'string');
    return `effect index ${r.effect.index}`;
  });

  await test('applyEffect — Drop Shadow by matchName with red color', async () => {
    const r = await send('applyEffect', {
      compIndex: ci, layerIndex: li,
      effectMatchName: 'ADBE Drop Shadow',
      effectSettings: {
        'Shadow Color': [1, 0, 0, 1],
        Distance: 20,
        Softness: 10
      }
    });
    assertNoError(r);
    assertField(r, 'effect', 'object');
    assertField(r.effect, 'index', 'number');
  });

  await test('applyEffectTemplate — gaussian-blur template', async () => {
    const r = await send('applyEffectTemplate', {
      compIndex: ci, layerIndex: li,
      templateName: 'gaussian-blur',
      customSettings: { blurriness: 15 }
    });
    assertNoError(r);
    assertArray(r, 'appliedEffects');
    if (r.appliedEffects.length === 0) throw new Error('no effects applied by template');
    assertField(r.appliedEffects[0], 'name', 'string');
    assertField(r.appliedEffects[0], 'matchName', 'string');
  });

  await test('applyEffectTemplate — cinematic-look (multi-effect template)', async () => {
    const r = await send('applyEffectTemplate', {
      compIndex: ci, layerIndex: li,
      templateName: 'cinematic-look'
    });
    assertNoError(r);
    assertArray(r, 'appliedEffects');
    if (r.appliedEffects.length < 2) {
      throw new Error(`cinematic-look should apply ≥2 effects, got ${r.appliedEffects.length}`);
    }
  });

  await test('bridgeTestEffects — applies blur + drop-shadow, returns 2 results', async () => {
    const r = await send('bridgeTestEffects', {
      compIndex: ci, layerIndex: li
    });
    assertNoError(r);
    assertArray(r, 'results');
    if (r.results.length !== 2) throw new Error(`expected 2 results, got ${r.results.length}`);
    return `${r.results.length} effects applied`;
  });
}
