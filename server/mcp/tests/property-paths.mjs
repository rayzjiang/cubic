// property-paths.mjs — tests for the generic setLayerProperty command (layers.jsx)
//
// Covers:
//   setLayerProperty  (U  — path-based setter, mirrors getLayerProperty)
//                          Tested across: shape contents (Fill Color, Stroke Color),
//                          camera options (Zoom), effect nested props (Drop Shadow Opacity)
//   getLayerProperty  (R  — used to verify each mutation)
//
// Visual verification (after --write, open __MCP_TEST_property_paths__ in After Effects):
//   "Path Shape" solid rectangle: Fill color should be green [0,1,0].
//   "Path Camera": Zoom value changed from default to 2000.
//   "Path Solid" with Drop Shadow effect: Opacity of the shadow should be 60.
//
// Missing: none — full R+U cycle covered for each domain.

import {
  test, send,
  assertNoError, assertField,
  assertStructuredError, requireSetup,
  bold, yellow
} from './helpers.mjs';

const COMP_NAME = '__MCP_TEST_property_paths__';

export async function run(ctx, opts) {
  console.log(bold('\nProperty Paths (setLayerProperty)'));

  if (!opts.write) return;

  // ── Setup ─────────────────────────────────────────────────────────────────

  const setupOk = await test('setup — create property-paths test comp', async () => {
    const cr = await send('createComposition', {
      name: COMP_NAME, width: 1920, height: 1080, frameRate: 30, duration: 10, pixelAspect: 1
    });
    assertField(cr, 'composition', 'object');
    return `comp "${COMP_NAME}" created`;
  });

  if (!requireSetup(setupOk)) return;

  // ── Shape Contents — Fill Color ───────────────────────────────────────────

  await test('setup — create shape layer for path tests', async () => {
    const r = await send('createLayer', {
      compName: COMP_NAME, type: 'shape', name: 'Path Shape',
      shapeType: 'rectangle', size: [400, 300],
      fillColor: [1, 0, 0], strokeColor: [0, 0, 0], strokeWidth: 4
    });
    assertNoError(r);
    ctx.pathShapeIndex = 1;
  });

  await test('setLayerProperty — set Fill Color to green via Contents path', async () => {
    const r = await send('setLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.pathShapeIndex,
      propertyPath: ['Contents', 'Group 1', 'Fill 1', 'Color'],
      value: [0, 1, 0]
    });
    assertNoError(r);
    assertField(r, 'property', 'object');
    const v = r.property.value;
    if (!v || Math.abs(v[1] - 1) > 0.01) throw new Error(`Expected green [0,1,0], got ${JSON.stringify(v)}`);
  });

  await test('getLayerProperty — verify Fill Color is green', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.pathShapeIndex,
      propertyPath: ['Contents', 'Group 1', 'Fill 1', 'Color']
    });
    assertNoError(r);
    const v = r.property.value;
    if (!v || Math.abs(v[1] - 1) > 0.01) throw new Error(`Expected green after set, got ${JSON.stringify(v)}`);
  });

  // ── Shape Contents — Stroke Color ─────────────────────────────────────────

  await test('setLayerProperty — set Stroke Color to red via Contents path', async () => {
    const r = await send('setLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.pathShapeIndex,
      propertyPath: ['Contents', 'Group 1', 'Stroke 1', 'Color'],
      value: [1, 0, 0]
    });
    assertNoError(r);
    const v = r.property.value;
    if (!v || Math.abs(v[0] - 1) > 0.01) throw new Error(`Expected red [1,0,0], got ${JSON.stringify(v)}`);
  });

  // ── Camera Options ────────────────────────────────────────────────────────

  await test('setup — create camera for zoom path test', async () => {
    const r = await send('createLayer', {
      compName: COMP_NAME, type: 'camera', name: 'Path Camera'
    });
    assertNoError(r);
    ctx.pathCameraIndex = 1;
  });

  await test('setLayerProperty — set Camera Zoom via Camera Options path', async () => {
    const r = await send('setLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.pathCameraIndex,
      propertyPath: ['Camera Options', 'Zoom'],
      value: 2000
    });
    assertNoError(r);
    assertField(r, 'property', 'object');
    if (Math.abs(r.property.value - 2000) > 1) throw new Error(`Expected Zoom=2000, got ${r.property.value}`);
  });

  await test('getLayerProperty — verify Camera Zoom is 2000', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.pathCameraIndex,
      propertyPath: ['Camera Options', 'Zoom']
    });
    assertNoError(r);
    if (Math.abs(r.property.value - 2000) > 1) throw new Error(`Expected 2000 after set, got ${r.property.value}`);
  });

  // ── Effect — nested property via path ─────────────────────────────────────

  await test('setup — create solid + apply Drop Shadow for nested effect test', async () => {
    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', name: 'Path Solid', color: [0.8, 0.8, 0.8]
    });
    assertNoError(lr);
    ctx.pathSolidIndex = 1;

    const ef = await send('applyEffect', {
      compName: COMP_NAME, layerIndex: ctx.pathSolidIndex,
      effectMatchName: 'ADBE Drop Shadow'
    });
    assertNoError(ef);
    ctx.dropShadowName = ef.effect?.name || 'Drop Shadow';
  });

  await test('setLayerProperty — set Drop Shadow Opacity via Effects path', async () => {
    const r = await send('setLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.pathSolidIndex,
      propertyPath: ['Effects', ctx.dropShadowName, 'Opacity'],
      value: 60
    });
    assertNoError(r);
    if (Math.abs(r.property.value - 60) > 0.5) throw new Error(`Expected Opacity=60, got ${r.property.value}`);
  });

  await test('getLayerProperty — verify Drop Shadow Opacity is 60', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.pathSolidIndex,
      propertyPath: ['Effects', ctx.dropShadowName, 'Opacity']
    });
    assertNoError(r);
    if (Math.abs(r.property.value - 60) > 0.5) throw new Error(`Expected 60 after set, got ${r.property.value}`);
  });

  // ── Error paths ───────────────────────────────────────────────────────────

  await test('setLayerProperty — invalid path returns PROPERTY_NOT_FOUND error', async () => {
    const r = await send('setLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.pathShapeIndex,
      propertyPath: ['Contents', 'FakeGroup', 'FakeProp'],
      value: 999
    });
    assertStructuredError(r, 'PROPERTY_NOT_FOUND');
  });

  await test('setLayerProperty — path pointing to a group (not a leaf) returns error', async () => {
    // 'Contents' resolves to a PropertyGroup, not a settable Property
    const r = await send('setLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.pathShapeIndex,
      propertyPath: ['Contents'],
      value: 99
    });
    assertStructuredError(r);
  });
}
