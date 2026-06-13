// effects.mjs — tests for effects.jsx
//
// Covers:
//   getLayerEffects      (R  — all effect fields: index, name, matchName, enabled, properties)
//   applyEffect          (C  — by effectMatchName with effectSettings)
//   applyEffectTemplate  (C  — single-effect and multi-effect templates)
//   setEffectProperty    (U  — change a property value on an existing effect)
//   deleteEffect         (D  — remove effect by name, confirmed by count drop)
//
// Missing: none — full CRUD covered.
//
// Effects applied in order (all visible in Effect Controls panel):
//   1. Gaussian Blur (blurriness=5, then updated to 25 by setEffectProperty)
//   2. Drop Shadow (red, distance=20) ← deleted by deleteEffect
//   3. Gaussian Blur (blurriness=15, from gaussian-blur template)
//   4. Curves (from cinematic-look template)
//   5. Vibrance (from cinematic-look template)
//
// Visual verification (after --write, open __MCP_TEST_effects__ in After Effects):
//   Select the white solid and open Effect Controls (Ctrl/Cmd+Shift+T).
//   Should show 4 effects: Gaussian Blur (25px), Gaussian Blur (15px), Curves, Vibrance.
//   Drop Shadow should be absent — it was deleted by the final test.

import {
  test, send,
  assertNoError, assertField, assertArray, assertValue,
  requireSetup,
  bold, yellow
} from './helpers.mjs';

const COMP_NAME = '__MCP_TEST_effects__';

export async function run(ctx, opts) {
  console.log(bold('\nEffects'));

  if (!opts.write) return;

  // ── Setup ─────────────────────────────────────────────────────────────────

  let li;

  const setupOk = await test('setup — create effects test comp + white solid', async () => {
    const cr = await send('createComposition', {
      name: COMP_NAME, width: 1920, height: 1080, frameRate: 30, duration: 10, pixelAspect: 1
    });
    assertField(cr, 'composition', 'object');

    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', name: 'Effects Test Solid', color: [1, 1, 1]
    });
    assertNoError(lr);
    li = 1;
    return `layer ${li}`;
  });

  if (!requireSetup(setupOk)) return;

  // ── Create ────────────────────────────────────────────────────────────────

  await test('applyEffect — Gaussian Blur by matchName, returns effect index', async () => {
    const r = await send('applyEffect', {
      compName: COMP_NAME, layerIndex: li,
      effectMatchName: 'ADBE Gaussian Blur 2',
      effectSettings: { Blurriness: 5 }
    });
    assertNoError(r);
    assertField(r, 'effect', 'object');
    assertField(r.effect, 'name', 'string');
    assertField(r.effect, 'index', 'number');
    assertValue(r.effect, 'type', 'effect');
    assertField(r.layer, 'name', 'string');
    ctx.blurEffectIndex = r.effect.index;
    return `effect index ${r.effect.index}`;
  });

  await test('applyEffect — Drop Shadow by matchName with red color', async () => {
    const r = await send('applyEffect', {
      compName: COMP_NAME, layerIndex: li,
      effectMatchName: 'ADBE Drop Shadow',
      effectSettings: { 'Shadow Color': [1, 0, 0, 1], Distance: 20, Softness: 10 }
    });
    assertNoError(r);
    assertField(r, 'effect', 'object');
    assertField(r.effect, 'index', 'number');
    ctx.shadowEffectName = r.effect.name;
  });

  await test('applyEffectTemplate — gaussian-blur (single-effect template)', async () => {
    const r = await send('applyEffectTemplate', {
      compName: COMP_NAME, layerIndex: li,
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
      compName: COMP_NAME, layerIndex: li,
      templateName: 'cinematic-look'
    });
    assertNoError(r);
    assertArray(r, 'appliedEffects');
    if (r.appliedEffects.length < 2) {
      throw new Error(`cinematic-look should apply ≥2 effects, got ${r.appliedEffects.length}`);
    }
  });

  // Multi-effect template + per-index customSettings: override Vibrance (sub-effect 1) to 30.
  await test('applyEffectTemplate — cinematic-look with per-index customSettings honors override', async () => {
    const r = await send('applyEffectTemplate', {
      compName: COMP_NAME, layerIndex: li,
      templateName: 'cinematic-look',
      customSettings: { "1": { Vibrance: 30 } }
    });
    assertNoError(r);
    assertArray(r, 'appliedEffects');
    if (r.appliedEffects.length < 2) throw new Error('expected ≥2 effects from cinematic-look');

    // Verify the most recently added Vibrance carries Vibrance=30 (was 15 in template default)
    const list = await send('getLayerEffects', { compName: COMP_NAME, layerIndex: li });
    assertNoError(list);
    const vibranceEffects = list.effects.filter(e => e.matchName === 'ADBE Vibrance');
    if (vibranceEffects.length === 0) throw new Error('no Vibrance effect found after template');
    const latest = vibranceEffects[vibranceEffects.length - 1];
    const vibProp = latest.properties.find(p => p.name === 'Vibrance');
    if (!vibProp) throw new Error('Vibrance property missing on latest Vibrance effect');
    if (Math.abs(vibProp.value - 30) > 0.5) {
      throw new Error(`expected Vibrance=30 (override), got ${vibProp.value}`);
    }
    return `Vibrance=${vibProp.value} (overridden)`;
  });

  // Coverage for EVERY curated effect — incl. glow + text-pop, which were untested when the wrong
  // "ADBE Glow" matchName shipped. A bad matchName or property name now fails loudly here.
  const EVERY_TEMPLATE = [
    'gaussian-blur', 'directional-blur', 'color-balance', 'brightness-contrast',
    'curves', 'glow', 'drop-shadow', 'vibrance', // singles
    'text-pop', // composite (drop-shadow + glow)
  ];
  for (const tpl of EVERY_TEMPLATE) {
    await test(`applyEffectTemplate — "${tpl}" applies with no rejected matchName or property`, async () => {
      const r = await send('applyEffectTemplate', { compName: COMP_NAME, layerIndex: li, templateName: tpl });
      assertNoError(r);
      assertArray(r, 'appliedEffects');
      if (r.appliedEffects.length === 0) throw new Error(`"${tpl}" applied no effects`);
      if (r.warning) throw new Error(`"${tpl}" partial-applied: ${r.warning}`);
      if (r.failedProperties) throw new Error(`"${tpl}" failed properties: ${JSON.stringify(r.failedProperties)}`);
      return r.appliedEffects.map(e => e.name).join(' + ');
    });
  }

  await test('applyEffect — friendly effectName "glow" resolves to the real matchName', async () => {
    const r = await send('applyEffect', { compName: COMP_NAME, layerIndex: li, effectName: 'glow' });
    assertNoError(r);
    assertValue(r.effect, 'matchName', 'ADBE Glo2'); // resolved via the dictionary, not guessed
    if (r.warning) throw new Error(`glow partial-applied: ${r.warning}`);
  });

  await test('applyEffect — unknown effectName fails with a self-healable list', async () => {
    const r = await send('applyEffect', { compName: COMP_NAME, layerIndex: li, effectName: 'definitely-not-an-effect' });
    if (r.status !== 'error') throw new Error('expected an error for an unknown effect');
    if (!/known effects/i.test(r.message || '')) throw new Error(`error should list known effects, got: ${r.message}`);
  });

  // ── Read ──────────────────────────────────────────────────────────────────

  await test('getLayerEffects — ≥4 effects with index, name, matchName, enabled, properties', async () => {
    const r = await send('getLayerEffects', {
      compName: COMP_NAME, layerIndex: li
    });
    assertNoError(r);
    assertArray(r, 'effects');
    assertField(r, 'count', 'number');
    if (r.count < 4) throw new Error(`expected ≥4 effects, got ${r.count}`);
    const e = r.effects[0];
    assertField(e, 'index', 'number');
    assertField(e, 'name', 'string');
    assertField(e, 'matchName', 'string');
    assertField(e, 'enabled');
    assertArray(e, 'properties');
    return `${r.count} effects — first: "${e.name}" (${e.properties.length} props)`;
  });

  // ── Update ────────────────────────────────────────────────────────────────

  await test('setEffectProperty — update Blurriness on Gaussian Blur to 25', async () => {
    if (!ctx.blurEffectIndex) throw new Error('blurEffectIndex not set — applyEffect test must have passed');
    const r = await send('setEffectProperty', {
      compName: COMP_NAME, layerIndex: li,
      effectIndex: ctx.blurEffectIndex,
      propertyName: 'Blurriness',
      value: 25
    });
    assertNoError(r);
    assertField(r, 'effect', 'object');
    assertField(r, 'property', 'object');
    assertField(r.property, 'value');
    if (r.property.value !== 25) throw new Error(`expected Blurriness=25, got ${r.property.value}`);
    return `Blurriness → ${r.property.value}`;
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  await test('deleteEffect — remove Drop Shadow by name, count drops by 1', async () => {
    if (!ctx.shadowEffectName) throw new Error('shadowEffectName not set — applyEffect test must have passed');

    const before = await send('getLayerEffects', { compName: COMP_NAME, layerIndex: li });
    assertNoError(before);
    const countBefore = before.count;

    const r = await send('deleteEffect', {
      compName: COMP_NAME, layerIndex: li,
      effectName: ctx.shadowEffectName
    });
    assertNoError(r);
    assertField(r, 'deleted', 'object');
    assertField(r.deleted, 'name', 'string');
    assertField(r.deleted, 'index', 'number');
    if (r.deleted.name !== ctx.shadowEffectName) {
      throw new Error(`expected deleted "${ctx.shadowEffectName}", got "${r.deleted.name}"`);
    }

    const after = await send('getLayerEffects', { compName: COMP_NAME, layerIndex: li });
    assertNoError(after);
    if (after.count !== countBefore - 1) {
      throw new Error(`expected ${countBefore - 1} effects remaining, got ${after.count}`);
    }
    return `deleted "${r.deleted.name}", ${after.count} effects remaining`;
  });

  // ── failedProperties — verify failures surface instead of silently swallow ─

  await test('applyEffect — bogus effectSettings key appears in failedProperties', async () => {
    const r = await send('applyEffect', {
      compName: COMP_NAME, layerIndex: li,
      effectMatchName: 'ADBE Gaussian Blur 2',
      effectSettings: { Blurriness: 5, 'NonExistentProp': 999 }
    });
    assertNoError(r);
    assertField(r, 'failedProperties', 'object');
    if (!Array.isArray(r.failedProperties)) throw new Error('failedProperties should be an array');
    if (r.failedProperties.length === 0) throw new Error('expected ≥1 failed property for bogus key');
    const fp = r.failedProperties[0];
    assertField(fp, 'name', 'string');
    assertField(fp, 'reason', 'string');
    if (fp.name !== 'NonExistentProp') throw new Error(`expected "NonExistentProp" in failedProperties, got "${fp.name}"`);
    return `failedProperties[0]: name="${fp.name}", reason="${fp.reason.slice(0, 40)}"`;
  });

  await test('applyEffectTemplate — bogus flat customSettings key appears in failedProperties with effectName', async () => {
    const r = await send('applyEffectTemplate', {
      compName: COMP_NAME, layerIndex: li,
      templateName: 'cinematic-look',
      customSettings: { 'BogusKey': 42 }
    });
    assertNoError(r);
    assertField(r, 'failedProperties', 'object');
    if (!Array.isArray(r.failedProperties)) throw new Error('failedProperties should be an array');
    if (r.failedProperties.length === 0) throw new Error('expected ≥1 failed property for bogus key');
    const fp = r.failedProperties[0];
    assertField(fp, 'name', 'string');
    assertField(fp, 'reason', 'string');
    assertField(fp, 'effectName', 'string');
    return `failedProperties[0]: effectName="${fp.effectName}", name="${fp.name}"`;
  });
}
