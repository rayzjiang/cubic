// shapes.mjs — tests for shape layer + shape operator commands in shapes.jsx
//
// Covers:
//   addShapeOperator        (C  — type: trimPaths, repeater, roundedCorners,
//                                gradientFill, gradientStroke; with settings)
//   setShapeOperatorProperty (U  — update a single property on an existing operator)
//   getLayerProperty         (R  — read shape Contents tree property, verifies C + U above)
//   setLayerProperty         (U  — Tier 4: generic path-based setter, tested via gradient Opacity)
//
// Visual verification (after --write, open __MCP_TEST_shapes__ in After Effects):
//   Timeline: "Test Shape" layer (blue rectangle).
//   Expand Contents > Group 1 > Trim Paths 1 — Start=0, End=50 (half drawn).
//   After setShapeOperatorProperty test, End should be 100 (fully drawn).
//   "Repeater Shape" layer: Contents > Group 1 > Repeater 1 — Copies=5.
//   "Rounded Shape" layer: Contents > Group 1 > Round Corners 1 — Radius=20.
//   "Gradient Fill Shape": gradient fill operator (linear, Opacity=50).
//   "Gradient Stroke Shape": gradient stroke operator (Stroke Width=8, Opacity=60).

import {
  test, send,
  assertNoError, assertField, assertArray, assertValue,
  bold, yellow
} from './helpers.mjs';

const COMP_NAME = '__MCP_TEST_shapes__';

export async function run(ctx, opts) {
  console.log(bold('\nShape Operators'));

  if (!opts.write) return;

  // ── Setup ─────────────────────────────────────────────────────────────────

  const setupOk = await test('setup — create shapes test comp + shape layer', async () => {
    const cr = await send('createComposition', {
      name: COMP_NAME, width: 1920, height: 1080, frameRate: 30, duration: 10, pixelAspect: 1
    });
    assertField(cr, 'composition', 'object');

    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'shape', name: 'Test Shape',
      shapeType: 'rectangle', size: [400, 400], fillColor: [0.2, 0.4, 1]
    });
    assertNoError(lr);
    ctx.shapesLayerIndex = 1;
    return `shape layer index ${ctx.shapesLayerIndex}`;
  });

  if (!setupOk) {
    console.log(yellow('  Shape operator tests skipped — setup failed'));
    return;
  }

  // ── Trim Paths ────────────────────────────────────────────────────────────

  await test('addShapeOperator — trimPaths with Start=0, End=50', async () => {
    const r = await send('addShapeOperator', {
      compName: COMP_NAME, layerIndex: ctx.shapesLayerIndex,
      type: 'trimPaths',
      settings: { Start: 0, End: 50 }
    });
    assertNoError(r);
    assertField(r, 'operator', 'object');
    assertValue(r.operator, 'type', 'trimPaths');
    assertField(r.operator, 'name', 'string');
    assertArray(r.operator, 'properties');
    ctx.trimPathsOpName = r.operator.name;
  });

  await test('getLayerProperty — read Trim Paths End via path (should be 50)', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.shapesLayerIndex,
      propertyPath: ['Contents', 'Group 1', ctx.trimPathsOpName || 'Trim Paths 1', 'End']
    });
    assertNoError(r);
    assertField(r, 'property', 'object');
    assertField(r.property, 'value');
    if (r.property.value !== 50) throw new Error(`Expected End=50, got ${r.property.value}`);
  });

  await test('setShapeOperatorProperty — change Trim Paths End from 50 to 100', async () => {
    const r = await send('setShapeOperatorProperty', {
      compName: COMP_NAME, layerIndex: ctx.shapesLayerIndex,
      operatorPath: ['Contents', 'Group 1', ctx.trimPathsOpName || 'Trim Paths 1'],
      propertyName: 'End',
      value: 100
    });
    assertNoError(r);
    assertField(r, 'property', 'object');
    if (r.property.value !== 100) throw new Error(`Expected End=100 after set, got ${r.property.value}`);
  });

  await test('getLayerProperty — verify Trim Paths End is now 100', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.shapesLayerIndex,
      propertyPath: ['Contents', 'Group 1', ctx.trimPathsOpName || 'Trim Paths 1', 'End']
    });
    assertNoError(r);
    if (r.property.value !== 100) throw new Error(`Expected End=100 after update, got ${r.property.value}`);
  });

  // ── Repeater ──────────────────────────────────────────────────────────────

  await test('addShapeOperator — repeater with Copies=5 on a fresh shape layer', async () => {
    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'shape', name: 'Repeater Shape',
      shapeType: 'ellipse', size: [80, 80], fillColor: [1, 0.5, 0.1]
    });
    assertNoError(lr);
    ctx.repeaterLayerIndex = 1; // new layer lands at index 1

    const r = await send('addShapeOperator', {
      compName: COMP_NAME, layerIndex: ctx.repeaterLayerIndex,
      type: 'repeater',
      settings: { Copies: 5 }
    });
    assertNoError(r);
    assertField(r, 'operator', 'object');
    assertValue(r.operator, 'type', 'repeater');
    ctx.repeaterOpName = r.operator.name;
  });

  await test('getLayerProperty — read Repeater Copies (should be 5)', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.repeaterLayerIndex,
      propertyPath: ['Contents', 'Group 1', ctx.repeaterOpName || 'Repeater 1', 'Copies']
    });
    assertNoError(r);
    if (r.property.value !== 5) throw new Error(`Expected Copies=5, got ${r.property.value}`);
  });

  // ── Rounded Corners ───────────────────────────────────────────────────────

  await test('addShapeOperator — roundedCorners with Radius=20 on a fresh shape layer', async () => {
    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'shape', name: 'Rounded Shape',
      shapeType: 'rectangle', size: [300, 200], fillColor: [0.9, 0.2, 0.4]
    });
    assertNoError(lr);
    ctx.roundedLayerIndex = 1;

    const r = await send('addShapeOperator', {
      compName: COMP_NAME, layerIndex: ctx.roundedLayerIndex,
      type: 'roundedCorners',
      settings: { Radius: 20 }
    });
    assertNoError(r);
    assertField(r, 'operator', 'object');
    assertValue(r.operator, 'type', 'roundedCorners');
    ctx.rcOpName = r.operator.name;
  });

  await test('getLayerProperty — read Rounded Corners Radius (should be 20)', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.roundedLayerIndex,
      propertyPath: ['Contents', 'Group 1', ctx.rcOpName || 'Round Corners 1', 'Radius']
    });
    assertNoError(r);
    if (r.property.value !== 20) throw new Error(`Expected Radius=20, got ${r.property.value}`);
  });

  // ── Error paths ───────────────────────────────────────────────────────────

  await test('addShapeOperator — invalid type returns error', async () => {
    const r = await send('addShapeOperator', {
      compName: COMP_NAME, layerIndex: ctx.shapesLayerIndex,
      type: 'flubber'
    });
    assertValue(r, 'status', 'error');
    if (!r.message || !r.message.includes('flubber')) throw new Error('Expected error mentioning invalid type name');
  });

  await test('setShapeOperatorProperty — invalid propertyName returns error', async () => {
    const r = await send('setShapeOperatorProperty', {
      compName: COMP_NAME, layerIndex: ctx.shapesLayerIndex,
      operatorPath: ['Contents', 'Group 1', ctx.trimPathsOpName || 'Trim Paths 1'],
      propertyName: 'NonExistentProp',
      value: 999
    });
    assertValue(r, 'status', 'error');
  });

  await test('getLayerProperty — invalid path returns error', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.shapesLayerIndex,
      propertyPath: ['Contents', 'DoesNotExist', 'Fake Property']
    });
    assertValue(r, 'status', 'error');
  });

  // ── Tier 4 — Gradient Fill ────────────────────────────────────────────────

  await test('addShapeOperator — gradientFill (red→blue, linear)', async () => {
    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'shape', name: 'Gradient Fill Shape',
      shapeType: 'rectangle', size: [600, 200], fillColor: [0, 0, 1]
    });
    assertNoError(lr);
    ctx.gradFillLayerIndex = 1;

    const r = await send('addShapeOperator', {
      compName: COMP_NAME, layerIndex: ctx.gradFillLayerIndex,
      type: 'gradientFill',
      settings: { Type: 1, 'Start Point': [-150, 0], 'End Point': [150, 0], Opacity: 100 }
    });
    assertNoError(r);
    assertField(r, 'operator', 'object');
    assertValue(r.operator, 'type', 'gradientFill');
    assertField(r.operator, 'name', 'string');
    ctx.gradFillOpName = r.operator.name;
  });

  await test('getLayerProperty — read Gradient Fill Opacity (should be 100)', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.gradFillLayerIndex,
      propertyPath: ['Contents', 'Group 1', ctx.gradFillOpName || 'Gradient Fill 1', 'Opacity']
    });
    assertNoError(r);
    assertField(r, 'property', 'object');
    if (r.property.value !== 100) throw new Error(`Expected Opacity=100, got ${r.property.value}`);
  });

  await test('setLayerProperty — change Gradient Fill Opacity from 100 to 80', async () => {
    const r = await send('setLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.gradFillLayerIndex,
      propertyPath: ['Contents', 'Group 1', ctx.gradFillOpName || 'Gradient Fill 1', 'Opacity'],
      value: 80
    });
    assertNoError(r);
    assertField(r, 'property', 'object');
    if (r.property.value !== 80) throw new Error(`Expected Opacity=80 after set, got ${r.property.value}`);
  });

  await test('getLayerProperty — verify Gradient Fill Opacity is now 80', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.gradFillLayerIndex,
      propertyPath: ['Contents', 'Group 1', ctx.gradFillOpName || 'Gradient Fill 1', 'Opacity']
    });
    assertNoError(r);
    if (r.property.value !== 80) throw new Error(`Expected 80 after update, got ${r.property.value}`);
  });

  // ── Tier 4 — Gradient Stroke ──────────────────────────────────────────────

  await test('addShapeOperator — gradientStroke (green→yellow, Stroke Width=12)', async () => {
    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'shape', name: 'Gradient Stroke Shape',
      shapeType: 'ellipse', size: [300, 300], fillColor: [0.15, 0.15, 0.15]
    });
    assertNoError(lr);
    ctx.gradStrokeLayerIndex = 1;

    const r = await send('addShapeOperator', {
      compName: COMP_NAME, layerIndex: ctx.gradStrokeLayerIndex,
      type: 'gradientStroke',
      settings: { Type: 1, 'Start Point': [-150, 0], 'End Point': [150, 0], 'Stroke Width': 12, Opacity: 100 }
    });
    assertNoError(r);
    assertField(r, 'operator', 'object');
    assertValue(r.operator, 'type', 'gradientStroke');
    ctx.gradStrokeOpName = r.operator.name;
  });

  await test('setLayerProperty — set Gradient Stroke Opacity to 60 (cross-domain setter smoke)', async () => {
    const r = await send('setLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.gradStrokeLayerIndex,
      propertyPath: ['Contents', 'Group 1', ctx.gradStrokeOpName || 'Gradient Stroke 1', 'Opacity'],
      value: 60
    });
    assertNoError(r);
    if (r.property.value !== 60) throw new Error(`Expected Opacity=60, got ${r.property.value}`);
  });

  // ── Tier 4 — setLayerProperty error paths ─────────────────────────────────

  await test('setLayerProperty — invalid path returns PROPERTY_NOT_FOUND', async () => {
    const r = await send('setLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.shapesLayerIndex,
      propertyPath: ['Contents', 'DoesNotExist', 'FakeProp'],
      value: 99
    });
    assertValue(r, 'status', 'error');
  });
}
