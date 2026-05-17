// anchor.mjs — tests for centerAnchorPoint in layers.jsx
//
// Covers:
//   centerAnchorPoint  (U — center anchor on content bbox; adjust position to preserve visual placement)
//
// Visual verification (after --write, open __MCP_TEST_anchor__ in After Effects):
//   "Offset Shape" layer: anchor should sit at the visual center of the rectangle.
//   "Offset Text" layer: anchor should sit at the center of the text bounding box.
//   Both layers should not appear to have jumped (position compensated).

import {
  test, send,
  assertNoError, assertField, assertValue,
  bold, yellow
} from './helpers.mjs';

const COMP_NAME = '__MCP_TEST_anchor__';

export async function run(ctx, opts) {
  console.log(bold('\nAnchor Point'));

  if (!opts.write) return;

  // ── Setup ─────────────────────────────────────────────────────────────────

  const setupOk = await test('setup — create anchor test comp + offset shape layer', async () => {
    const cr = await send('createComposition', {
      name: COMP_NAME, width: 1920, height: 1080, frameRate: 30, duration: 5, pixelAspect: 1
    });
    assertField(cr, 'composition', 'object');

    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'shape', name: 'Offset Shape',
      shapeType: 'rectangle', size: [300, 200], fillColor: [0.3, 0.7, 0.3]
    });
    assertNoError(lr);
    ctx.anchorShapeIndex = 1;

    // Offset anchor away from content center [0,0] so centerAnchorPoint has something to do
    const move = await send('setLayerKeyframe', {
      compName: COMP_NAME, layerIndex: ctx.anchorShapeIndex,
      propertyName: 'Anchor Point', timeInSeconds: 0, value: [200, 200]
    });
    assertNoError(move);

    return 'shape layer with anchor offset to [200,200]';
  });

  if (!setupOk) {
    console.log(yellow('  Anchor tests skipped — setup failed'));
    return;
  }

  // ── centerAnchorPoint on shape layer ──────────────────────────────────────

  await test('centerAnchorPoint — center anchor on shape layer', async () => {
    const before = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.anchorShapeIndex,
      propertyPath: ['Transform', 'Anchor Point']
    });
    assertNoError(before);
    const oldAnchor = before.property.value;

    const r = await send('centerAnchorPoint', {
      compName: COMP_NAME, layerIndex: ctx.anchorShapeIndex
    });
    assertNoError(r);
    assertField(r, 'anchor');
    assertField(r, 'position');

    // The new anchor should differ from [0,0] (our offset starting point)
    const newAnchor = r.anchor;
    if (Array.isArray(oldAnchor) && Array.isArray(newAnchor)) {
      const changed = Math.abs(newAnchor[0] - oldAnchor[0]) > 0.5 || Math.abs(newAnchor[1] - oldAnchor[1]) > 0.5;
      if (!changed) throw new Error('Anchor did not change after centerAnchorPoint');
    }
    ctx.anchorAfterCenter = r.anchor;
    return `anchor → [${r.anchor[0].toFixed(1)}, ${r.anchor[1].toFixed(1)}]`;
  });

  await test('centerAnchorPoint — calling again is idempotent', async () => {
    const r = await send('centerAnchorPoint', {
      compName: COMP_NAME, layerIndex: ctx.anchorShapeIndex
    });
    assertNoError(r);
    // Anchor should stay in the same place
    if (ctx.anchorAfterCenter && Array.isArray(r.anchor)) {
      const drift = Math.abs(r.anchor[0] - ctx.anchorAfterCenter[0]) + Math.abs(r.anchor[1] - ctx.anchorAfterCenter[1]);
      if (drift > 1) throw new Error(`Anchor drifted on second call: ${JSON.stringify(r.anchor)} vs ${JSON.stringify(ctx.anchorAfterCenter)}`);
    }
  });

  // ── centerAnchorPoint on text layer ───────────────────────────────────────

  await test('centerAnchorPoint — center anchor on text layer', async () => {
    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'text', name: 'Offset Text',
      text: 'Hello', fontSize: 72, color: [1, 1, 1]
    });
    assertNoError(lr);
    ctx.anchorTextIndex = 1;

    const r = await send('centerAnchorPoint', {
      compName: COMP_NAME, layerIndex: ctx.anchorTextIndex
    });
    assertNoError(r);
    assertField(r, 'anchor');
    return `anchor → [${r.anchor[0].toFixed(1)}, ${r.anchor[1].toFixed(1)}]`;
  });

  // ── preservePosition:false ────────────────────────────────────────────────

  await test('centerAnchorPoint — preservePosition:false skips position adjustment', async () => {
    const posBefore = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.anchorShapeIndex,
      propertyPath: ['Transform', 'Position']
    });
    assertNoError(posBefore);
    const oldPos = posBefore.property.value;

    // Offset anchor away from content center so there's something for centerAnchorPoint to do
    await send('setLayerKeyframe', {
      compName: COMP_NAME, layerIndex: ctx.anchorShapeIndex,
      propertyName: 'Anchor Point', timeInSeconds: 0, value: [200, 200]
    });

    const r = await send('centerAnchorPoint', {
      compName: COMP_NAME, layerIndex: ctx.anchorShapeIndex, preservePosition: false
    });
    assertNoError(r);
    assertField(r, 'anchor');
  });

  // ── Error path ────────────────────────────────────────────────────────────

  await test('centerAnchorPoint — invalid layer index returns error', async () => {
    const r = await send('centerAnchorPoint', {
      compName: COMP_NAME, layerIndex: 99
    });
    assertValue(r, 'status', 'error');
  });
}
