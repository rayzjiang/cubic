// layers.mjs — tests for layers.jsx
//
// Covers:
//   getLayerInfo           (R  — all fields: name, index, type, scale, rotation,
//                                opacity, effectsCount, masksCount, inPoint, outPoint;
//                                camera: zoom, pointOfInterest, autoOrient (decoded string),
//                                depthOfField, focusDistance, aperture, blurLevel;
//                                light: intensity, lightType, lightColor, falloff, radius,
//                                castsShadows, shadowDarkness, shadowDiffusion;
//                                spot-only: coneAngle, coneFeather)
//   alignLayers            (U  — LEFT/HORIZONTAL_CENTER/RIGHT/TOP/VERTICAL_CENTER/BOTTOM;
//                                reference: COMPOSITION|SELECTION; previousPositions)
//   sequenceLayers         (U  — TOP_DOWN/BOTTOM_UP/RANDOM; offsetFrames; previousStartTimes)
//   createTextLayer        (C)
//   createShapeLayer       (C)
//   createSolidLayer       (C)
//   createCamera           (C  — now accepts startTime, duration, depthOfField, focusDistance,
//                                aperture, blurLevel)
//   createLightLayer       (C  — now accepts coneAngle, coneFeather (spot-only, warned on non-spot),
//                                falloff, radius, falloffDistance, castsShadows, shadowDarkness,
//                                shadowDiffusion)
//   createNullLayer        (C)
//   createLayer            (C  — unified dispatcher: all 7 types including adjustment)
//   duplicateLayer         (C)
//   setLayerProperties     (U  — opacity, scale, text, font, selected, changedProperties array;
//                                stretch field + previousValues; cameraOptions sub-object +
//                                previousValues.cameraOptions; lightOptions sub-object +
//                                previousValues.lightOptions; Tier 4: blendMode, threeDLayer,
//                                motionBlur, shy, solo, quality, autoOrient, label, comment;
//                                collapseTransformation → see nesting.mjs (precomp layers only))
//   batchSetLayerProperties (U — multiple layers in one call; stretch previousValues)
//   moveLayer              (U  — reorders layer stack; previousIndex captured)
//   setLayerParent         (U  — parents text layer to null layer; previousParent captured)
//   setTimeRemapEnabled    (U  — enable/disable time remap on AVLayer; autoKeyframes on enable;
//                                previousValue capture; error on non-AVLayer)
//   deleteLayer            (D  — removes layer, returns name + index)
//
// Nesting/mattes (precompose, setTrackMatte, decomposeLayer) → see nesting.mjs
// Time ops (splitLayer, mergeLayer, trimLayer) → see layer-time.mjs
// Selection round-trip (getSelectedLayers, setSelectedLayers) → see selection.mjs
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
  assertStructuredError, requireSetup,
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

  if (!requireSetup(setupOk)) return;

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

  await test('setLayerParent — parents text layer to null; previousParent=null (text had no parent)', async () => {
    const r = await send('setLayerParent', {
      compName: COMP_NAME,
      layerIndex: ctx.textLayerIndex,
      parentIndex: ctx.nullLayerIndex
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    assertField(r.layer, 'parent', 'object');
    assertField(r.layer.parent, 'name', 'string');
    // B2: previousParent should be null (text had no parent before)
    if (!('previousParent' in r)) throw new Error('setLayerParent response missing previousParent');
    if (r.previousParent !== null) {
      throw new Error(`expected previousParent=null (text had no parent), got ${JSON.stringify(r.previousParent)}`);
    }

    // verify parent is visible in getLayerInfo
    const info = await send('getLayerInfo', { compName: COMP_NAME });
    assertNoError(info);
    const text = info.layers.find(l => l.index === ctx.textLayerIndex);
    if (!text) throw new Error('text layer not found in getLayerInfo');
    if (!text.parent) throw new Error('parent field is null — setLayerParent did not stick');
    return `parent="${text.parent.name}", previousParent=${r.previousParent}`;
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
    // Camera-specific fields
    assertField(camera, 'zoom', 'number');
    if (!('pointOfInterest' in camera)) throw new Error('camera missing field "pointOfInterest"');
    // A6 new camera fields
    assertField(camera, 'autoOrient', 'string');
    if (!('depthOfField'  in camera)) throw new Error('camera missing depthOfField');
    if (!('focusDistance' in camera)) throw new Error('camera missing focusDistance');
    if (!('aperture'      in camera)) throw new Error('camera missing aperture');
    if (!('blurLevel'     in camera)) throw new Error('camera missing blurLevel');

    const light = r.layers.find(l => l.index === ctx.lightLayerIndex);
    if (!light) throw new Error('light layer not found');
    assertValue(light, 'type', 'light');
    // Light-specific fields
    assertField(light, 'intensity', 'number');
    assertField(light, 'lightType', 'string');
    if (!('lightColor' in light)) throw new Error('light missing field "lightColor"');
    // A6 new light fields
    if (!('falloff'         in light)) throw new Error('light missing falloff');
    if (!('radius'          in light)) throw new Error('light missing radius');
    if (!('castsShadows'    in light)) throw new Error('light missing castsShadows');
    if (!('shadowDarkness'  in light)) throw new Error('light missing shadowDarkness');
    if (!('shadowDiffusion' in light)) throw new Error('light missing shadowDiffusion');

    return `text type=${text.type} scale=[${text.scale}] opacity=${text.opacity}, camera.zoom=${camera.zoom} autoOrient=${camera.autoOrient}, light.intensity=${light.intensity} (${light.lightType})`;
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

  // ── overwriteKeyframes guard (Item 4 contract) ──────────────────────────────

  await test('setLayerProperties — Opacity keyframed → throws INVALID_ARGS without overwriteKeyframes', async () => {
    // Set an Opacity keyframe to put the property into a guarded state
    await send('setLayerKeyframe', {
      compName: COMP_NAME, layerIndex: ctx.shapeLayerIndex,
      propertyName: 'Opacity', timeInSeconds: 0, value: 50
    });

    const r = await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: ctx.shapeLayerIndex, opacity: 90
    });
    assertStructuredError(r, 'INVALID_ARGS');
    if (!r.message.toLowerCase().includes('overwritekeyframes')) {
      throw new Error(`expected hint about overwriteKeyframes, got "${r.message}"`);
    }
  });

  await test('setLayerProperties — overwriteKeyframes:true clears Opacity keyframe and succeeds', async () => {
    const r = await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: ctx.shapeLayerIndex, opacity: 90, overwriteKeyframes: true
    });
    assertNoError(r);
    assertIncludes(r.layer, 'changedProperties', 'opacity');

    // Verify the keyframe was actually removed
    const kfs = await send('getLayerKeyframes', {
      compName: COMP_NAME, layerIndex: ctx.shapeLayerIndex, propertyName: 'Opacity'
    });
    assertNoError(kfs);
    if (kfs.count !== 0) throw new Error(`expected 0 keyframes after overwrite, got ${kfs.count}`);
  });

  await test('batchSetLayerProperties — per-op overwriteKeyframes flag respected', async () => {
    // Set a Scale keyframe on shape layer
    await send('setLayerKeyframe', {
      compName: COMP_NAME, layerIndex: ctx.shapeLayerIndex,
      propertyName: 'Scale', timeInSeconds: 0, value: [50, 50, 100]
    });

    // First op: no flag → should error. Second op: flag set → should succeed.
    const r = await send('batchSetLayerProperties', {
      compName: COMP_NAME,
      operations: [
        { layerIndex: ctx.shapeLayerIndex, scale: [80, 80, 100] },
        { layerIndex: ctx.shapeLayerIndex, scale: [110, 110, 100], overwriteKeyframes: true }
      ]
    });
    assertNoError(r);
    assertArray(r, 'results');
    assertStructuredError(r.results[0], 'INVALID_ARGS');
    if (r.results[1].status !== 'success') throw new Error(`expected second op to succeed: ${JSON.stringify(r.results[1])}`);

    // Restore shape opacity to 75 for downstream tests
    await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: ctx.shapeLayerIndex, opacity: 75, scale: [100, 100, 100], overwriteKeyframes: true
    });
  });

  // moveLayer: move solid (index 4) after text (index 6) → null=1, light=2, camera=3, shape=4, text=5, solid=6
  await test('moveLayer — moves solid below text; previousIndex equals old position', async () => {
    const oldSolidIndex = ctx.solidLayerIndex; // 4
    const r = await send('moveLayer', {
      compName: COMP_NAME,
      layerIndex: ctx.solidLayerIndex,  // 4
      targetIndex: ctx.textLayerIndex,  // 6
      position: 'after'
    });
    assertNoError(r);
    // B1: previousIndex
    assertField(r, 'previousIndex', 'number');
    if (r.previousIndex !== oldSolidIndex) {
      throw new Error(`expected previousIndex=${oldSolidIndex}, got ${r.previousIndex}`);
    }
    ctx.nullLayerIndex   = 1;
    ctx.lightLayerIndex  = 2;
    ctx.cameraLayerIndex = 3;
    ctx.shapeLayerIndex  = 4;
    ctx.textLayerIndex   = 5;
    ctx.solidLayerIndex  = 6;
    return `moved from ${r.previousIndex} to ${r.layer.index}`;
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
    // deselect for downstream tests; getSelectedLayers round-trip lives in selection.mjs
    await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: ctx.textLayerIndex, selected: false
    });
  });

  // ── createLayer (unified dispatcher) ─────────────────────────────────────

  await test('createLayer type=text — returns layer with type=text', async () => {
    const r = await send('createLayer', {
      compName: COMP_NAME, type: 'text', text: 'createLayer test',
      fontSize: 60, position: [960, 200], color: [0, 1, 0]
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    assertValue(r.layer, 'type', 'text');
    ctx.createLayerTextIdx = r.layer.index;
  });

  await test('createLayer type=shape — returns layer with type=shape', async () => {
    const r = await send('createLayer', {
      compName: COMP_NAME, type: 'shape', shapeType: 'ellipse',
      size: [100, 100], fillColor: [0, 1, 0.5]
    });
    assertNoError(r);
    assertValue(r.layer, 'type', 'shape');
  });

  await test('createLayer type=solid — returns layer with type=solid', async () => {
    const r = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', color: [0.3, 0.3, 0.3], name: 'CL Solid'
    });
    assertNoError(r);
    assertValue(r.layer, 'type', 'solid');
  });

  await test('createLayer type=adjustment — returns isAdjustment=true', async () => {
    const r = await send('createLayer', {
      compName: COMP_NAME, type: 'adjustment', name: 'CL Adjustment'
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    if (r.layer.isAdjustment !== true) throw new Error(`Expected isAdjustment=true, got ${r.layer.isAdjustment}`);
  });

  await test('createLayer type=null — returns layer with type=null', async () => {
    const r = await send('createLayer', {
      compName: COMP_NAME, type: 'null', name: 'CL Null'
    });
    assertNoError(r);
    assertValue(r.layer, 'type', 'null');
  });

  await test('createLayer type=camera — returns zoom value', async () => {
    const r = await send('createLayer', {
      compName: COMP_NAME, type: 'camera', name: 'CL Camera'
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    assertField(r.layer, 'zoom', 'number');
  });

  await test('createLayer type=light — returns type=light', async () => {
    const r = await send('createLayer', {
      compName: COMP_NAME, type: 'light', lightType: 'point', name: 'CL Light'
    });
    assertNoError(r);
    assertValue(r.layer, 'type', 'light');
  });

  await test('createLayer unknown type — returns error', async () => {
    const r = await send('createLayer', {
      compName: COMP_NAME, type: 'hologram'
    });
    assertStructuredError(r);
    if (!r.message.includes('hologram')) throw new Error('Expected error mentioning invalid type name');
  });

  // ── Tier 4 — layer toggles + smoke-verify wired flags ────────────────────
  // Nesting/mattes (precompose, setTrackMatte, decomposeLayer) → see nesting.mjs

  // blendMode already wired — verify explicitly
  await test('setLayerProperties — blendMode: multiply smoke test', async () => {
    const r = await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: ctx.solidLayerIndex, blendMode: 'multiply'
    });
    assertNoError(r);
    assertIncludes(r.layer, 'changedProperties', 'blendMode');
    await send('setLayerProperties', { compName: COMP_NAME, layerIndex: ctx.solidLayerIndex, blendMode: 'normal' });
  });

  // threeDLayer already wired — verify explicitly
  await test('setLayerProperties — threeDLayer toggle smoke test', async () => {
    const r = await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: ctx.solidLayerIndex, threeDLayer: true
    });
    assertNoError(r);
    assertIncludes(r.layer, 'changedProperties', 'threeDLayer');
    await send('setLayerProperties', { compName: COMP_NAME, layerIndex: ctx.solidLayerIndex, threeDLayer: false });
  });

  // New Tier 4 toggles
  await test('setLayerProperties — motionBlur toggle', async () => {
    const r = await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: ctx.solidLayerIndex, motionBlur: true
    });
    assertNoError(r);
    assertIncludes(r.layer, 'changedProperties', 'motionBlur');
    await send('setLayerProperties', { compName: COMP_NAME, layerIndex: ctx.solidLayerIndex, motionBlur: false });
  });

  await test('setLayerProperties — shy + solo toggles', async () => {
    const r = await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: ctx.solidLayerIndex, shy: true, solo: true
    });
    assertNoError(r);
    assertIncludes(r.layer, 'changedProperties', 'shy', 'solo');
    await send('setLayerProperties', { compName: COMP_NAME, layerIndex: ctx.solidLayerIndex, shy: false, solo: false });
  });

  await test('setLayerProperties — quality: wireframe then back to best', async () => {
    const rWire = await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: ctx.solidLayerIndex, quality: 'wireframe'
    });
    assertNoError(rWire);
    assertIncludes(rWire.layer, 'changedProperties', 'quality');
    const rBest = await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: ctx.solidLayerIndex, quality: 'best'
    });
    assertNoError(rBest);
    assertIncludes(rBest.layer, 'changedProperties', 'quality');
  });

  await test('setLayerProperties — autoOrient: alongPath then off', async () => {
    const rOn = await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: ctx.solidLayerIndex, autoOrient: 'alongPath'
    });
    assertNoError(rOn);
    assertIncludes(rOn.layer, 'changedProperties', 'autoOrient');
    const rOff = await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: ctx.solidLayerIndex, autoOrient: 'off'
    });
    assertNoError(rOff);
    assertIncludes(rOff.layer, 'changedProperties', 'autoOrient');
  });

  await test('setLayerProperties — label + comment roundtrip', async () => {
    const r = await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: ctx.solidLayerIndex,
      label: 5, comment: 'tier4-test'
    });
    assertNoError(r);
    assertIncludes(r.layer, 'changedProperties', 'label', 'comment');
    // Reset
    await send('setLayerProperties', { compName: COMP_NAME, layerIndex: ctx.solidLayerIndex, label: 0, comment: '' });
  });

  // mergeLayer, splitLayer, trimLayer → see layer-time.mjs
  // precompose, setTrackMatte, decomposeLayer → see nesting.mjs

  // ── New feature coverage ──────────────────────────────────────────────────
  // Layers created below always land at index 1 (AE inserts at top).
  // Each test captures the returned index and uses it immediately — no
  // assumptions are made about ctx indices after this point.

  // ── A1: setTimeRemapEnabled ───────────────────────────────────────────────

  let trPrecompIdx;

  const trSetupOk = await test('setTimeRemapEnabled setup — create solid then precompose as nested comp', async () => {
    const sl = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', name: 'TR Test Solid', color: [0.4, 0.4, 0.4]
    });
    assertNoError(sl);
    const solidIdx = sl.layer.index; // = 1, freshly inserted
    const pc = await send('precompose', {
      compName: COMP_NAME, layerIndices: [solidIdx], newCompName: '__MCP_TEST_layers_TR_sub__'
    });
    assertNoError(pc);
    if (!pc.replacingLayer) throw new Error('precompose did not return replacingLayer');
    trPrecompIdx = pc.replacingLayer.index;
    return `precomp layer at index ${trPrecompIdx}`;
  });

  if (trSetupOk) {
    await test('setTimeRemapEnabled — enable on precomp layer; autoKeyframes created, previousValue=false', async () => {
      const r = await send('setTimeRemapEnabled', {
        compName: COMP_NAME, layerIndex: trPrecompIdx, enabled: true
      });
      assertNoError(r);
      if (r.timeRemapEnabled !== true) throw new Error(`expected timeRemapEnabled=true, got ${r.timeRemapEnabled}`);
      if (r.previousValue !== false) throw new Error(`expected previousValue=false, got ${r.previousValue}`);
      assertField(r, 'autoKeyframes');
      if (!Array.isArray(r.autoKeyframes) || r.autoKeyframes.length < 2) {
        throw new Error(`expected ≥2 autoKeyframes from AE, got ${JSON.stringify(r.autoKeyframes)}`);
      }
      return `enabled; autoKeyframes=${r.autoKeyframes.length}`;
    });

    await test('setTimeRemapEnabled — disable round-trips previousValue=true', async () => {
      const r = await send('setTimeRemapEnabled', {
        compName: COMP_NAME, layerIndex: trPrecompIdx, enabled: false
      });
      assertNoError(r);
      if (r.timeRemapEnabled !== false) throw new Error(`expected timeRemapEnabled=false, got ${r.timeRemapEnabled}`);
      if (r.previousValue !== true) throw new Error(`expected previousValue=true (was enabled), got ${r.previousValue}`);
      return 'disabled; previousValue=true captured';
    });

    await test('setTimeRemapEnabled — missing enabled arg returns INVALID_ARGS', async () => {
      const r = await send('setTimeRemapEnabled', {
        compName: COMP_NAME, layerIndex: trPrecompIdx
      });
      assertStructuredError(r, 'INVALID_ARGS');
    });
  }

  // Solid layers are AVLayer but canSetTimeRemapEnabled===false — must return INVALID_ARGS.
  await test('setTimeRemapEnabled — solid layer (canSetTimeRemapEnabled=false) returns INVALID_ARGS', async () => {
    const sl = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', name: 'TR Solid No Remap', color: [0.3, 0.3, 0.3]
    });
    assertNoError(sl);
    const r = await send('setTimeRemapEnabled', {
      compName: COMP_NAME, layerIndex: sl.layer.index, enabled: true
    });
    assertStructuredError(r, 'INVALID_ARGS');
  });

  // Camera layer is NOT an AVLayer — time remap should error.
  // Create dedicated camera; use returned index before any subsequent creates shift it.
  await test('setTimeRemapEnabled — on camera layer returns INVALID_ARGS', async () => {
    const cam = await send('createCamera', {
      compName: COMP_NAME, name: 'TR Camera (time remap test)'
    });
    assertNoError(cam);
    const r = await send('setTimeRemapEnabled', {
      compName: COMP_NAME, layerIndex: cam.layer.index, enabled: true
    });
    assertStructuredError(r, 'INVALID_ARGS');
    if (!r.message.toLowerCase().includes('av layer') && !r.message.toLowerCase().includes('avlayer')) {
      throw new Error(`expected error mentioning AVLayer limitation, got: "${r.message}"`);
    }
  });

  // ── A1: stretch in setLayerProperties / batchSetLayerProperties ───────────
  // Use freshly created solid (idx may have shifted; create a dedicated one).

  await test('setLayerProperties — stretch applied; previousValues.stretch captured', async () => {
    const sl = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', name: 'Stretch Test Solid', color: [0.5, 0.5, 0.5]
    });
    assertNoError(sl);
    const stretchIdx = sl.layer.index;

    const r = await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: stretchIdx, stretch: 50
    });
    assertNoError(r);
    assertIncludes(r.layer, 'changedProperties', 'stretch');
    assertField(r, 'previousValues', 'object');
    assertField(r.previousValues, 'stretch', 'number');
    assertField(r.layer, 'stretch', 'number');
    if (Math.abs(r.layer.stretch - 50) > 0.5) {
      throw new Error(`expected stretch≈50, got ${r.layer.stretch}`);
    }
    // Reset
    await send('setLayerProperties', { compName: COMP_NAME, layerIndex: stretchIdx, stretch: 100 });
    return `stretch=${r.layer.stretch}, previousValues.stretch=${r.previousValues.stretch}`;
  });

  // ── A6: createCamera with new fields ─────────────────────────────────────

  await test('createCamera — accepts startTime, duration, depthOfField, focusDistance, aperture, blurLevel', async () => {
    const r = await send('createCamera', {
      compName: COMP_NAME, name: 'Camera Options Test',
      startTime: 0.5, duration: 3,
      depthOfField: true, focusDistance: 500, aperture: 50, blurLevel: 75
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    assertField(r.layer, 'zoom', 'number');
    if (Math.abs(r.layer.inPoint - 0.5) > 0.01) {
      throw new Error(`expected inPoint≈0.5, got ${r.layer.inPoint}`);
    }
    if (!('depthOfField'  in r.layer)) throw new Error('response missing depthOfField');
    if (!('focusDistance' in r.layer)) throw new Error('response missing focusDistance');
    if (!('aperture'      in r.layer)) throw new Error('response missing aperture');
    if (!('blurLevel'     in r.layer)) throw new Error('response missing blurLevel');
    return `inPoint=${r.layer.inPoint}, focusDistance=${r.layer.focusDistance}`;
  });

  // ── A6: createLightLayer with new fields ──────────────────────────────────

  await test('createLightLayer — spot type with coneAngle, coneFeather, falloff, radius, castsShadows', async () => {
    const r = await send('createLightLayer', {
      compName: COMP_NAME, name: 'Spot Test Light', lightType: 'spot', intensity: 80,
      coneAngle: 45, coneFeather: 25, falloff: 'inverseSquare',
      radius: 400, falloffDistance: 600, castsShadows: true, shadowDarkness: 80, shadowDiffusion: 10
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    assertValue(r.layer, 'lightType', 'spot');
    if (!('coneAngle'       in r.layer)) throw new Error('spot light missing coneAngle');
    if (!('coneFeather'     in r.layer)) throw new Error('spot light missing coneFeather');
    if (!('falloff'         in r.layer)) throw new Error('spot light missing falloff');
    if (!('radius'          in r.layer)) throw new Error('spot light missing radius');
    if (!('castsShadows'    in r.layer)) throw new Error('spot light missing castsShadows');
    if (!('shadowDarkness'  in r.layer)) throw new Error('spot light missing shadowDarkness');
    if (!('shadowDiffusion' in r.layer)) throw new Error('spot light missing shadowDiffusion');
    return `coneAngle=${r.layer.coneAngle}, falloff=${r.layer.falloff}`;
  });

  await test('createLightLayer — point type with coneAngle warns (spot-only), does not throw', async () => {
    const r = await send('createLightLayer', {
      compName: COMP_NAME, name: 'Point Cone Warning', lightType: 'point', coneAngle: 50
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    assertField(r.layer, 'warnings');
    if (!Array.isArray(r.layer.warnings) || r.layer.warnings.length === 0) {
      throw new Error('expected a warning for coneAngle on non-spot light, got none');
    }
    if (!r.layer.warnings.some(w => w.toLowerCase().includes('spot'))) {
      throw new Error(`expected spot-related warning, got: ${JSON.stringify(r.layer.warnings)}`);
    }
    return `warning: "${r.layer.warnings[0]}"`;
  });

  // ── A6: setLayerProperties — cameraOptions sub-object ────────────────────

  await test('setLayerProperties — cameraOptions: { zoom, focusDistance }; previousValues.cameraOptions captured', async () => {
    const cam = await send('createCamera', { compName: COMP_NAME, name: 'CamOpts Test' });
    assertNoError(cam);
    const camIdx = cam.layer.index; // = 1, use immediately

    const r = await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: camIdx,
      cameraOptions: { zoom: 2000, focusDistance: 400 }
    });
    assertNoError(r);
    const changed = r.layer.changedProperties;
    const camChanged = changed.filter(c => c.startsWith('cameraOptions'));
    if (camChanged.length === 0) {
      throw new Error(`expected cameraOptions.* in changedProperties, got: ${JSON.stringify(changed)}`);
    }
    assertField(r, 'previousValues', 'object');
    if (!r.previousValues.cameraOptions) throw new Error('previousValues missing cameraOptions');
    return `changedProperties: ${camChanged.join(', ')}`;
  });

  // ── A6: setLayerProperties — lightOptions sub-object ─────────────────────

  await test('setLayerProperties — lightOptions: { intensity, radius, falloff }; previousValues.lightOptions captured', async () => {
    const ll = await send('createLightLayer', {
      compName: COMP_NAME, name: 'LightOpts Test', lightType: 'point', intensity: 100
    });
    assertNoError(ll);
    const lightIdx = ll.layer.index; // = 1, use immediately

    const r = await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: lightIdx,
      lightOptions: { intensity: 120, radius: 300, falloff: 'smooth' }
    });
    assertNoError(r);
    const changed = r.layer.changedProperties;
    const lightChanged = changed.filter(c => c.startsWith('lightOptions'));
    if (lightChanged.length === 0) {
      throw new Error(`expected lightOptions.* in changedProperties, got: ${JSON.stringify(changed)}`);
    }
    assertField(r, 'previousValues', 'object');
    if (!r.previousValues.lightOptions) throw new Error('previousValues missing lightOptions');
    return `changedProperties: ${lightChanged.join(', ')}`;
  });

  // ── B2: setLayerParent clear — previousParent captured ───────────────────

  await test('setLayerParent — clear parent; previousParent reflects the layer that was set', async () => {
    // Create a null then a solid, parent the solid to the null, then clear.
    const nullLayer = await send('createNullLayer', { compName: COMP_NAME, name: 'B2 Null' });
    assertNoError(nullLayer);
    const nullIdx = nullLayer.layer.index; // = 1

    const solidLayer = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', name: 'B2 Solid', color: [0.3, 0.3, 0.3]
    });
    assertNoError(solidLayer);
    const solidIdx = solidLayer.layer.index; // = 1; nullIdx shifts to 2
    const actualNullIdx = nullIdx + 1;       // null is now at 2

    // Set parent
    const setR = await send('setLayerParent', {
      compName: COMP_NAME, layerIndex: solidIdx, parentIndex: actualNullIdx
    });
    assertNoError(setR);
    if (!('previousParent' in setR)) throw new Error('setLayerParent (set) missing previousParent');
    if (setR.previousParent !== null) {
      throw new Error(`expected previousParent=null (solid had no parent), got ${JSON.stringify(setR.previousParent)}`);
    }

    // Clear parent (no parentIndex → clears)
    const clearR = await send('setLayerParent', {
      compName: COMP_NAME, layerIndex: solidIdx
    });
    assertNoError(clearR);
    if (!('previousParent' in clearR)) throw new Error('setLayerParent (clear) missing previousParent');
    if (!clearR.previousParent || typeof clearR.previousParent !== 'object') {
      throw new Error(`expected previousParent to be B2 Null object, got ${JSON.stringify(clearR.previousParent)}`);
    }
    assertField(clearR.previousParent, 'name', 'string');
    if (clearR.previousParent.name !== 'B2 Null') {
      throw new Error(`expected previousParent.name="B2 Null", got "${clearR.previousParent.name}"`);
    }
    return `cleared; previousParent.name="${clearR.previousParent.name}"`;
  });

  // ── alignLayers ───────────────────────────────────────────────────────────

  if (opts.write) {
    const ALIGN_COMP = '__MCP_TEST_align__';

    const alignSetup = await test('alignLayers setup — comp with 3 solids at different positions', async () => {
      const cr = await send('createComposition', {
        name: ALIGN_COMP, width: 1920, height: 1080, frameRate: 30, duration: 5
      });
      assertField(cr, 'composition', 'object');
      for (const pos of [[200, 300], [600, 700], [1400, 200]]) {
        const lr = await send('createLayer', {
          compName: ALIGN_COMP, type: 'solid', name: 'AlignBlock',
          size: [100, 100], color: [0.5, 0.5, 0.5]
        });
        assertNoError(lr);
        await send('setLayerProperties', { compName: ALIGN_COMP, layerIndex: 1, position: pos });
      }
      return '3 solids created';
    });

    if (requireSetup(alignSetup)) {
      await test('alignLayers — LEFT align to COMPOSITION; previousPositions captured', async () => {
        const r = await send('alignLayers', {
          compName: ALIGN_COMP,
          layerIndices: [1, 2, 3],
          alignment: 'LEFT',
          reference: 'COMPOSITION'
        });
        assertNoError(r);
        assertField(r, 'alignment', 'string');
        assertField(r, 'modifiedLayers');
        assertField(r, 'previousPositions');
        if (!Array.isArray(r.modifiedLayers) || r.modifiedLayers.length !== 3) {
          throw new Error(`Expected 3 modifiedLayers, got ${r.modifiedLayers?.length}`);
        }
        if (!Array.isArray(r.previousPositions) || r.previousPositions.length !== 3) {
          throw new Error('previousPositions should be array of 3');
        }
        return `aligned LEFT; first layer x=${r.modifiedLayers[0].newPosition[0].toFixed(1)}`;
      });

      await test('alignLayers — VERTICAL_CENTER to SELECTION reference', async () => {
        const r = await send('alignLayers', {
          compName: ALIGN_COMP,
          layerIndices: [1, 2, 3],
          alignment: 'VERTICAL_CENTER',
          reference: 'SELECTION'
        });
        assertNoError(r);
        assertField(r, 'modifiedLayers');
        return `VERTICAL_CENTER to SELECTION done`;
      });

      await test('alignLayers — invalid alignment returns INVALID_ARGS', async () => {
        const r = await send('alignLayers', {
          compName: ALIGN_COMP, layerIndices: [1], alignment: 'DIAGONAL', reference: 'COMPOSITION'
        });
        assertStructuredError(r, 'INVALID_ARGS');
      });

      await test('alignLayers — out-of-bounds layerIndex returns error', async () => {
        const r = await send('alignLayers', {
          compName: ALIGN_COMP, layerIndices: [99], alignment: 'LEFT', reference: 'COMPOSITION'
        });
        assertStructuredError(r);
      });

      await send('deleteComposition', { compName: ALIGN_COMP });
    }
  }

  // ── sequenceLayers ────────────────────────────────────────────────────────

  if (opts.write) {
    const SEQ_COMP = '__MCP_TEST_sequence__';

    const seqSetup = await test('sequenceLayers setup — comp with 4 solid layers', async () => {
      const cr = await send('createComposition', {
        name: SEQ_COMP, width: 1920, height: 1080, frameRate: 30, duration: 10
      });
      assertField(cr, 'composition', 'object');
      for (let i = 0; i < 4; i++) {
        const lr = await send('createLayer', {
          compName: SEQ_COMP, type: 'solid', name: 'SeqBlock' + i, color: [0.5, 0.5, 0.5]
        });
        assertNoError(lr);
      }
      return '4 solids created';
    });

    if (requireSetup(seqSetup)) {
      await test('sequenceLayers — TOP_DOWN, 6 frames offset; previousStartTimes captured', async () => {
        const r = await send('sequenceLayers', {
          compName: SEQ_COMP,
          layerIndices: [1, 2, 3, 4],
          offsetFrames: 6,
          orderType: 'TOP_DOWN',
          baseStartTime: 0
        });
        assertNoError(r);
        assertField(r, 'orderType', 'string');
        assertField(r, 'offsetFrames', 'number');
        assertField(r, 'modifiedLayers');
        assertField(r, 'previousStartTimes');
        if (!Array.isArray(r.modifiedLayers) || r.modifiedLayers.length !== 4) {
          throw new Error(`Expected 4 modifiedLayers, got ${r.modifiedLayers?.length}`);
        }
        // Verify stagger: each layer starts 6 frames later than the previous
        const frameDur = 1 / 30;
        for (let i = 1; i < r.modifiedLayers.length; i++) {
          const diff = r.modifiedLayers[i].newStartTime - r.modifiedLayers[i - 1].newStartTime;
          if (Math.abs(diff - 6 * frameDur) > 0.001) {
            throw new Error(`Expected 6-frame stagger between layers ${i-1} and ${i}, got diff=${diff.toFixed(4)}s`);
          }
        }
        return `staggered: ${r.modifiedLayers.map(l => l.newStartTime.toFixed(3) + 's').join(', ')}`;
      });

      await test('sequenceLayers — BOTTOM_UP reorders correctly', async () => {
        const r = await send('sequenceLayers', {
          compName: SEQ_COMP,
          layerIndices: [1, 2, 3, 4],
          offsetFrames: 3,
          orderType: 'BOTTOM_UP',
          baseStartTime: 0
        });
        assertNoError(r);
        if (r.orderType !== 'BOTTOM_UP') throw new Error(`Expected orderType=BOTTOM_UP, got ${r.orderType}`);
        return 'BOTTOM_UP sequence applied';
      });

      await test('sequenceLayers — RANDOM does not error', async () => {
        const r = await send('sequenceLayers', {
          compName: SEQ_COMP,
          layerIndices: [1, 2, 3, 4],
          offsetFrames: 2,
          orderType: 'RANDOM'
        });
        assertNoError(r);
        return 'RANDOM sequence applied';
      });

      await test('sequenceLayers — invalid orderType returns INVALID_ARGS', async () => {
        const r = await send('sequenceLayers', {
          compName: SEQ_COMP, layerIndices: [1], offsetFrames: 5, orderType: 'SPIRAL'
        });
        assertStructuredError(r, 'INVALID_ARGS');
      });

      await send('deleteComposition', { compName: SEQ_COMP });
    }
  }

  // ── distributeLayers3D ────────────────────────────────────────────────────

  if (opts.write) {
    const DIST_COMP = '__MCP_TEST_dist3d__';

    const distSetupOk = await test('distributeLayers3D setup — comp with 8 solid layers', async () => {
      const cr = await send('createComposition', {
        name: DIST_COMP, width: 1920, height: 1080, frameRate: 30, duration: 10
      });
      assertField(cr, 'composition', 'object');
      for (let i = 0; i < 8; i++) {
        const lr = await send('createLayer', {
          compName: DIST_COMP, type: 'solid', name: 'Screen ' + i,
          size: [200, 150], color: [0.2, 0.4, 0.8]
        });
        assertNoError(lr);
      }
      return '8 solid layers created';
    });

    if (requireSetup(distSetupOk)) {
      await test('distributeLayers3D — cylinder, 8 layers, 2 rings: positionedLayers.length=8', async () => {
        const r = await send('distributeLayers3D', {
          compName: DIST_COMP,
          layerIndices: [1, 2, 3, 4, 5, 6, 7, 8],
          shape: 'cylinder',
          radius: 400,
          rings: 2,
          depthSpacing: 500
        });
        assertNoError(r);
        assertValue(r, 'shape', 'cylinder');
        assertField(r, 'positionedLayers');
        if (!Array.isArray(r.positionedLayers) || r.positionedLayers.length !== 8) {
          throw new Error(`expected positionedLayers.length=8, got ${r.positionedLayers?.length}`);
        }

        // Verify radial distance of layer 1 from comp center ≈ radius (400px)
        const p = r.positionedLayers[0].position; // [x, y, z]
        const compCX = 1920 / 2;
        const compCY = 1080 / 2;
        const radialDist = Math.sqrt(Math.pow(p[0] - compCX, 2) + Math.pow(p[1] - compCY, 2));
        if (Math.abs(radialDist - 400) > 1) {
          throw new Error(`expected radial distance≈400px from comp center, got ${radialDist.toFixed(2)}`);
        }

        return `positionedLayers=${r.positionedLayers.length}, layer[0] radialDist=${radialDist.toFixed(1)}px`;
      });

      await test('distributeLayers3D — cylinder: layers are 3D-enabled after call', async () => {
        // Use getLayerInfo to verify threeDLayer flag on layer 1
        const r = await send('getLayerInfo', { compName: DIST_COMP });
        assertNoError(r);
        assertArray(r, 'layers');
        const layer1 = r.layers.find(l => l.index === 1);
        if (!layer1) throw new Error('layer at index 1 not found in getLayerInfo response');
        if (!layer1.threeDLayer) {
          throw new Error(`expected layer 1 threeDLayer=true after distributeLayers3D, got ${layer1.threeDLayer}`);
        }
        return `layer 1 threeDLayer=${layer1.threeDLayer}`;
      });

      await test('distributeLayers3D — cylinder: Z position of ring-2 layers ≈ depthSpacing', async () => {
        // Ring 0 has 4 layers, ring 1 has 4 layers. Ring-1 layers should have z ≈ 500.
        const r = await send('distributeLayers3D', {
          compName: DIST_COMP,
          layerIndices: [1, 2, 3, 4, 5, 6, 7, 8],
          shape: 'cylinder',
          radius: 400,
          rings: 2,
          depthSpacing: 500,
          overwriteKeyframes: true
        });
        assertNoError(r);
        // Layers 5-8 are in ring 1 (0-indexed), so their Z should be 500
        const ring1Layer = r.positionedLayers[4]; // 5th layer = first in ring 1
        if (Math.abs(ring1Layer.position[2] - 500) > 1) {
          throw new Error(`expected ring-1 Z≈500, got ${ring1Layer.position[2]}`);
        }
        return `ring-1 Z=${ring1Layer.position[2]}`;
      });

      // Add 1 more layer for the grid test (need 9 for 3×3)
      await test('distributeLayers3D — grid 3×3 with Z-step: corner layer at expected position', async () => {
        // Create 1 extra layer so we have 9
        const extra = await send('createLayer', {
          compName: DIST_COMP, type: 'solid', name: 'Grid Extra', size: [100, 100], color: [0.8, 0.4, 0.2]
        });
        assertNoError(extra);

        const r = await send('distributeLayers3D', {
          compName: DIST_COMP,
          layerIndices: [1, 2, 3, 4, 5, 6, 7, 8, 9],
          shape: 'grid',
          rows: 3,
          cols: 3,
          spacing: [200, 200, 0],
          overwriteKeyframes: true
        });
        assertNoError(r);
        assertValue(r, 'shape', 'grid');
        if (r.positionedLayers.length !== 9) {
          throw new Error(`expected 9 positioned layers, got ${r.positionedLayers.length}`);
        }

        // Grid is centered: for rows=3, cols=3, spacing=[200,200,0]
        // totalW=(2)*200=400, totalH=(2)*200=400
        // Top-left (layer 0): [cx-200, cy-200, 0]
        // Bottom-right (layer 8): [cx+200, cy+200, 0]
        const compCX = 1920 / 2;
        const compCY = 1080 / 2;
        const last = r.positionedLayers[8].position;
        if (Math.abs(last[0] - (compCX + 200)) > 1 || Math.abs(last[1] - (compCY + 200)) > 1) {
          throw new Error(`expected bottom-right=[${compCX+200},${compCY+200},0], got [${last[0].toFixed(1)},${last[1].toFixed(1)},${last[2].toFixed(1)}]`);
        }
        return `grid bottom-right=[${last[0].toFixed(0)},${last[1].toFixed(0)},${last[2].toFixed(0)}]`;
      });

      await test('distributeLayers3D — faceCamera: autoOrient=cameraOrPOI on all layers', async () => {
        const r = await send('distributeLayers3D', {
          compName: DIST_COMP,
          layerIndices: [1, 2],
          shape: 'cylinder',
          radius: 300,
          faceCamera: true,
          overwriteKeyframes: true
        });
        assertNoError(r);
        // Verify via getLayerInfo that autoOrient was set
        const info = await send('getLayerInfo', { compName: DIST_COMP });
        assertNoError(info);
        const l1 = info.layers.find(l => l.index === 1);
        if (!l1) throw new Error('layer 1 not found');
        if (l1.autoOrient !== 'cameraOrPOI') {
          throw new Error(`expected autoOrient=cameraOrPOI, got ${l1.autoOrient}`);
        }
        return `layer 1 autoOrient=${l1.autoOrient}`;
      });

      await test('distributeLayers3D — shape="sphere" returns INVALID_ARGS (not in v1)', async () => {
        const r = await send('distributeLayers3D', {
          compName: DIST_COMP, layerIndices: [1, 2], shape: 'sphere'
        });
        assertStructuredError(r, 'INVALID_ARGS');
        if (!r.message.toLowerCase().includes('sphere') && !r.message.toLowerCase().includes('v1') && !r.message.toLowerCase().includes('v2')) {
          throw new Error(`expected error to mention sphere/v2 deferral, got: "${r.message}"`);
        }
      });

      await test('distributeLayers3D — single layerIndex returns INVALID_ARGS', async () => {
        const r = await send('distributeLayers3D', {
          compName: DIST_COMP, layerIndices: [1], shape: 'cylinder'
        });
        assertStructuredError(r, 'INVALID_ARGS');
      });

      await test('distributeLayers3D — out-of-bounds index returns LAYER_INDEX_OOB', async () => {
        const r = await send('distributeLayers3D', {
          compName: DIST_COMP, layerIndices: [1, 999], shape: 'cylinder'
        });
        assertStructuredError(r, 'LAYER_INDEX_OOB');
      });

      await send('deleteComposition', { compName: DIST_COMP });
    }
  }
}
