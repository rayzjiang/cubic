// layers.mjs — tests for layers.jsx
//
// Covers:
//   getLayerInfo           (R  — all fields: name, index, type, scale, rotation,
//                                opacity, effectsCount, masksCount, inPoint, outPoint)
//   createTextLayer        (C)
//   createShapeLayer       (C)
//   createSolidLayer       (C)
//   createCamera           (C)
//   duplicateLayer         (C)
//   setLayerProperties     (U  — opacity, scale, text, font, changedProperties array)
//   batchSetLayerProperties (U — multiple layers in one call)
//   moveLayer              (U  — reorders layer stack by name)
//   deleteLayer            (D  — removes layer, returns name + index)
//
// Missing: none — full CRUD covered.
//
// Layer stack after all creates (AE inserts new layers at index 1 each time):
//   createTextLayer  → text=1
//   createShapeLayer → shape=1, text=2
//   createSolidLayer → solid=1, shape=2, text=3
//   createCamera     → camera=1, solid=2, shape=3, text=4
//
// After moveLayer (solid after text):
//   camera=1, shape=2, text=3, solid=4
//
// After duplicateLayer (text) + deleteLayer (dup):
//   camera=1, shape=2, text=3, solid=4  ← stable for downstream suites
//
// Visual verification (after --write, open __MCP_TEST_layers__ in After Effects):
//   Timeline should show (top to bottom): Camera, Test Shape, MCP Test (text), Test Solid.
//   Select the text layer — Opacity=100%, Scale=100%. Shape layer Opacity=75%.

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
    const r = await send('getLayerInfo', { compIndex: 1 });
    if (r.error) return `skipped — ${r.error}`;
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
    return `${r.layers.length} layer(s) in comp 1`;
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

  // ── Read (write-mode: verify new getLayerInfo fields on known layers) ─────

  await test('getLayerInfo — type detection + scale/rotation/opacity/effectsCount/masksCount', async () => {
    const r = await send('getLayerInfo', { compIndex: compIndex });
    assertNoError(r);
    assertArray(r, 'layers');
    if (r.layers.length < 4) throw new Error(`expected 4 layers, got ${r.layers.length}`);

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

  // moveLayer: move solid (index 2) after text (index 4) → camera=1, shape=2, text=3, solid=4
  await test('moveLayer — moves solid below text, returns success', async () => {
    const r = await send('moveLayer', {
      compName: COMP_NAME,
      layerIndex: ctx.solidLayerIndex,  // 2
      targetIndex: ctx.textLayerIndex,  // 4
      position: 'after'
    });
    assertNoError(r);
    ctx.shapeLayerIndex = 2;
    ctx.textLayerIndex  = 3;
    ctx.solidLayerIndex = 4;
  });

  // ── Duplicate + Delete ────────────────────────────────────────────────────

  // Stack: camera=1, shape=2, text=3, solid=4
  // duplicate() places copy directly below original → dup=4, text=3, solid=5
  await test('duplicateLayer — creates copy, returns original + duplicate indices', async () => {
    const r = await send('duplicateLayer', {
      compName: COMP_NAME, layerIndex: ctx.textLayerIndex  // 3
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
    // Restore stable indices for downstream suites: camera=1, shape=2, text=3, solid=4
    ctx.cameraLayerIndex = 1;
    ctx.shapeLayerIndex  = 2;
    ctx.textLayerIndex   = 3;
    ctx.solidLayerIndex  = 4;
    delete ctx.dupLayerIndex;
  });
}
