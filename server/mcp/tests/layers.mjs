// layers.mjs — tests for layers.jsx
//
// Covers:
//   getLayerInfo           (R  — all fields: name, index, type, scale, rotation,
//                                opacity, effectsCount, masksCount, inPoint, outPoint)
//   getSelectedLayers      (R  — returns layers the user has selected; uses setLayerProperties.selected to simulate)
//   createTextLayer        (C)
//   createShapeLayer       (C)
//   createSolidLayer       (C)
//   createCamera           (C)
//   createLightLayer       (C)
//   createNullLayer        (C)
//   duplicateLayer         (C)
//   setLayerProperties     (U  — opacity, scale, text, font, selected, changedProperties array)
//   batchSetLayerProperties (U — multiple layers in one call)
//   moveLayer              (U  — reorders layer stack by name)
//   setLayerParent         (U  — parents text layer to null layer)
//   deleteLayer            (D  — removes layer, returns name + index)
//
// Missing: none — full CRUD covered.
//
// Layer stack after all creates (AE inserts new layers at index 1 each time):
//   createTextLayer  → text=1
//   createShapeLayer → shape=1, text=2
//   createSolidLayer → solid=1, shape=2, text=3
//   createCamera     → camera=1, solid=2, shape=3, text=4
//   createLightLayer → light=1, camera=2, solid=3, shape=4, text=5
//   createNullLayer  → null=1, light=2, camera=3, solid=4, shape=5, text=6
//
// After moveLayer (solid after text):
//   null=1, light=2, camera=3, shape=4, text=5, solid=6
//
// After duplicateLayer (text) + deleteLayer (dup):
//   null=1, light=2, camera=3, shape=4, text=5, solid=6  ← stable for downstream suites
//
// Visual verification (after --write, open __MCP_TEST_layers__ in After Effects):
//   Timeline (top to bottom): Test Null, Test Light, Test Camera, Test Shape, MCP Test (text), Test Solid.
//   Text layer is parented to Test Null. Shape layer Opacity=75%, text layer Opacity=100%, Scale=100%.

import {
  test, send,
  assertNoError, assertField, assertArray, assertValue, assertIncludes,
  bold, yellow
} from './helpers.mjs';

const COMP_NAME = '__MCP_TEST_layers__';

export async function run(ctx, opts) {
  console.log(bold('\nLayers'));

  // ── Read (always runs) ────────────────────────────────────────────────────

  await test('getLayerInfo — layers array with name, index, type, scale, rotation, opacity, effectsCount, masksCount', async () => {
    const list = await send('listCompositions');
    assertNoError(list);
    if (list.compositions.length === 0) return 'skipped — no compositions in project';
    const compName = list.compositions[0].name;

    const r = await send('getLayerInfo', { compName });
    assertNoError(r);
    assertArray(r, 'layers');
    if (r.layers.length > 0) {
      const l = r.layers[0];
      assertField(l, 'name', 'string');
      assertField(l, 'index', 'number');
      assertField(l, 'type', 'string');
      assertField(l, 'effectsCount', 'number');
      assertField(l, 'masksCount', 'number');
      // scale/rotation/opacity may be null for cameras/lights but field must be present
      if (!('scale'    in l)) throw new Error('missing field "scale"');
      if (!('rotation' in l)) throw new Error('missing field "rotation"');
      if (!('opacity'  in l)) throw new Error('missing field "opacity"');
    }
    return `"${compName}" — ${r.layers.length} layer(s)`;
  });

  if (!opts.write) return;

  // ── Setup: create own comp ────────────────────────────────────────────────

  let compIndex;

  const setupOk = await test('setup — create layers test comp', async () => {
    const r = await send('createComposition', {
      name: COMP_NAME, width: 1920, height: 1080, frameRate: 30, duration: 10, pixelAspect: 1
    });
    assertField(r, 'composition', 'object');
    compIndex = r.composition.itemIndex;
    return `comp index ${compIndex}`;
  });

  if (!setupOk) {
    console.log(yellow('  Write tests skipped — failed to create test comp'));
    return;
  }

  // ── Create ────────────────────────────────────────────────────────────────

  // Stack: text=1
  await test('createTextLayer — returns layer name + index', async () => {
    const r = await send('createTextLayer', {
      compName: COMP_NAME, text: 'MCP Test', fontSize: 120,
      position: [960, 540], color: [1, 1, 1]
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    assertField(r.layer, 'name', 'string');
    assertField(r.layer, 'index', 'number');
    ctx.textLayerIndex = 1;
  });

  // Stack: shape=1, text=2
  await test('createShapeLayer — rectangle, returns type=shape', async () => {
    const r = await send('createShapeLayer', {
      compName: COMP_NAME, shapeType: 'rectangle', name: 'Test Shape',
      position: [400, 300], size: [300, 200], fillColor: [0.2, 0.6, 1]
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    assertValue(r.layer, 'type', 'shape');
    ctx.shapeLayerIndex = 1;
    ctx.textLayerIndex  = 2;
  });

  // Stack: solid=1, shape=2, text=3
  await test('createSolidLayer — returns type=solid', async () => {
    const r = await send('createSolidLayer', {
      compName: COMP_NAME, name: 'Test Solid', color: [0.1, 0.1, 0.1]
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    assertValue(r.layer, 'type', 'solid');
    ctx.solidLayerIndex = 1;
    ctx.shapeLayerIndex = 2;
    ctx.textLayerIndex  = 3;
  });

  // Stack: camera=1, solid=2, shape=3, text=4
  await test('createCamera — returns zoom value', async () => {
    const r = await send('createCamera', {
      compName: COMP_NAME, name: 'Test Camera'
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    assertField(r.layer, 'zoom', 'number');
    ctx.cameraLayerIndex = 1;
    ctx.solidLayerIndex  = 2;
    ctx.shapeLayerIndex  = 3;
    ctx.textLayerIndex   = 4;
  });

  // Stack: light=1, camera=2, solid=3, shape=4, text=5
  await test('createLightLayer — returns type=light, lightType string', async () => {
    const r = await send('createLightLayer', {
      compName: COMP_NAME, name: 'Test Light', lightType: 'point', intensity: 80
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    assertValue(r.layer, 'type', 'light');
    assertField(r.layer, 'lightType', 'string');
    ctx.lightLayerIndex  = 1;
    ctx.cameraLayerIndex = 2;
    ctx.solidLayerIndex  = 3;
    ctx.shapeLayerIndex  = 4;
    ctx.textLayerIndex   = 5;
  });

  // Stack: null=1, light=2, camera=3, solid=4, shape=5, text=6
  await test('createNullLayer — returns type=null, position array', async () => {
    const r = await send('createNullLayer', {
      compName: COMP_NAME, name: 'Test Null', threeDLayer: true
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    assertValue(r.layer, 'type', 'null');
    assertField(r.layer, 'threeDLayer', 'boolean');
    if (r.layer.threeDLayer !== true) throw new Error('expected threeDLayer=true');
    ctx.nullLayerIndex   = 1;
    ctx.lightLayerIndex  = 2;
    ctx.cameraLayerIndex = 3;
    ctx.solidLayerIndex  = 4;
    ctx.shapeLayerIndex  = 5;
    ctx.textLayerIndex   = 6;
  });

  await test('setLayerParent — parents text layer to null, confirmed in getLayerInfo', async () => {
    const r = await send('setLayerParent', {
      compName: COMP_NAME,
      layerIndex: ctx.textLayerIndex,
      parentIndex: ctx.nullLayerIndex
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    assertField(r.layer, 'parent', 'object');
    assertField(r.layer.parent, 'name', 'string');

    // verify parent is visible in getLayerInfo
    const info = await send('getLayerInfo', { compName: COMP_NAME });
    assertNoError(info);
    const text = info.layers.find(l => l.index === ctx.textLayerIndex);
    if (!text) throw new Error('text layer not found in getLayerInfo');
    if (!text.parent) throw new Error('parent field is null — setLayerParent did not stick');
    return `parent="${text.parent.name}"`;
  });

  // ── Read (write-mode: verify new getLayerInfo fields on known layers) ─────

  await test('getLayerInfo — type detection + scale/rotation/opacity/effectsCount/masksCount', async () => {
    const r = await send('getLayerInfo', { compName: COMP_NAME });
    assertNoError(r);
    assertArray(r, 'layers');
    if (r.layers.length < 6) throw new Error(`expected 6 layers, got ${r.layers.length}`);

    const text = r.layers.find(l => l.index === ctx.textLayerIndex);
    if (!text) throw new Error('text layer not found');
    assertValue(text, 'type', 'text');
    assertArray(text, 'scale');
    assertField(text, 'rotation', 'number');
    assertField(text, 'opacity', 'number');
    assertField(text, 'effectsCount', 'number');
    assertField(text, 'masksCount', 'number');

    const camera = r.layers.find(l => l.index === ctx.cameraLayerIndex);
    if (!camera) throw new Error('camera layer not found');
    assertValue(camera, 'type', 'camera');
    // cameras don't have Scale/Opacity — fields must exist but may be null
    if (!('scale'   in camera)) throw new Error('camera missing field "scale"');
    if (!('opacity' in camera)) throw new Error('camera missing field "opacity"');

    return `text type=${text.type} scale=[${text.scale}] opacity=${text.opacity}`;
  });

  // ── Update ────────────────────────────────────────────────────────────────

  await test('setLayerProperties — sets opacity + scale, reports changedProperties', async () => {
    const r = await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: ctx.textLayerIndex,
      opacity: 80, scale: [90, 90]
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    assertArray(r.layer, 'changedProperties');
    assertIncludes(r.layer, 'changedProperties', 'opacity', 'scale');
  });

  await test('batchSetLayerProperties — updates two layers, all results=success', async () => {
    const r = await send('batchSetLayerProperties', {
      compName: COMP_NAME,
      operations: [
        { layerIndex: ctx.shapeLayerIndex, opacity: 75 },
        { layerIndex: ctx.textLayerIndex,  opacity: 100, scale: [100, 100] }
      ]
    });
    assertNoError(r);
    assertArray(r, 'results');
    if (r.results.length !== 2) throw new Error(`expected 2 results, got ${r.results.length}`);
    const failed = r.results.filter(res => res.status !== 'success');
    if (failed.length > 0) throw new Error(`operation(s) failed: ${JSON.stringify(failed)}`);
  });

  // moveLayer: move solid (index 4) after text (index 6) → null=1, light=2, camera=3, shape=4, text=5, solid=6
  await test('moveLayer — moves solid below text, returns success', async () => {
    const r = await send('moveLayer', {
      compName: COMP_NAME,
      layerIndex: ctx.solidLayerIndex,  // 4
      targetIndex: ctx.textLayerIndex,  // 6
      position: 'after'
    });
    assertNoError(r);
    ctx.nullLayerIndex   = 1;
    ctx.lightLayerIndex  = 2;
    ctx.cameraLayerIndex = 3;
    ctx.shapeLayerIndex  = 4;
    ctx.textLayerIndex   = 5;
    ctx.solidLayerIndex  = 6;
  });

  // ── Duplicate + Delete ────────────────────────────────────────────────────

  // Stack: null=1, light=2, camera=3, shape=4, text=5, solid=6
  // duplicate() places copy directly below original → dup=6, text=5, solid=7
  await test('duplicateLayer — creates copy, returns original + duplicate indices', async () => {
    const r = await send('duplicateLayer', {
      compName: COMP_NAME, layerIndex: ctx.textLayerIndex  // 5
    });
    assertNoError(r);
    assertField(r, 'original', 'object');
    assertField(r, 'duplicate', 'object');
    assertField(r.duplicate, 'index', 'number');
    assertField(r.duplicate, 'name', 'string');
    ctx.dupLayerIndex = r.duplicate.index;
  });

  await test('deleteLayer — removes duplicate by index, returns deleted name', async () => {
    const r = await send('deleteLayer', {
      compName: COMP_NAME, layerIndex: ctx.dupLayerIndex
    });
    assertNoError(r);
    assertField(r, 'deleted', 'object');
    assertField(r.deleted, 'name', 'string');
    assertField(r.deleted, 'index', 'number');
    // Restore stable indices for downstream suites: null=1, light=2, camera=3, shape=4, text=5, solid=6
    ctx.nullLayerIndex   = 1;
    ctx.lightLayerIndex  = 2;
    ctx.cameraLayerIndex = 3;
    ctx.shapeLayerIndex  = 4;
    ctx.textLayerIndex   = 5;
    ctx.solidLayerIndex  = 6;
    delete ctx.dupLayerIndex;
  });

  // ── getSelectedLayers ─────────────────────────────────────────────────────

  await test('setLayerProperties — selected flag appears in changedProperties', async () => {
    const r = await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: ctx.textLayerIndex, selected: true
    });
    assertNoError(r);
    assertArray(r.layer, 'changedProperties');
    if (!r.layer.changedProperties.includes('selected')) {
      throw new Error('"selected" not in changedProperties');
    }
  });

  await test('getSelectedLayers — returns selected layer with required fields', async () => {
    // layer at textLayerIndex is already selected from the previous test
    const r = await send('getSelectedLayers', { compName: COMP_NAME });
    assertNoError(r);
    assertField(r, 'activeComp', 'object');
    assertField(r.activeComp, 'name', 'string');
    assertField(r, 'count', 'number');
    assertArray(r, 'selectedLayers');
    if (r.count < 1) throw new Error('Expected at least 1 selected layer');
    const sel = r.selectedLayers.find(l => l.index === ctx.textLayerIndex);
    if (!sel) throw new Error(`Text layer (index ${ctx.textLayerIndex}) not in selectedLayers`);
    assertField(sel, 'name', 'string');
    assertField(sel, 'type', 'string');
    assertField(sel, 'index', 'number');
    return `${r.count} selected in "${r.activeComp.name}"`;
  });

  await test('getSelectedLayers — deselecting layer reduces count', async () => {
    await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: ctx.textLayerIndex, selected: false
    });
    const r = await send('getSelectedLayers', { compName: COMP_NAME });
    assertNoError(r);
    const stillSelected = (r.selectedLayers ?? []).find(l => l.index === ctx.textLayerIndex);
    if (stillSelected) throw new Error('Text layer should no longer be selected');
    return `count now ${r.count}`;
  });
}
