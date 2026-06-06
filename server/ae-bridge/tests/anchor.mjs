// anchor.mjs — tests for setAnchorPoint + centerAnchorPoint in layers.jsx
//
// Covers:
//   setAnchorPoint     (U — move anchor to named position on layer bbox; position-compensated;
//                           previousValues capture; position enum validation)
//   centerAnchorPoint  (U — alias for setAnchorPoint CENTER; backward compat)
//
// Visual verification (after --write, open __MCP_TEST_anchor__ in After Effects):
//   "Offset Shape" layer: anchor should sit at the visual center of the rectangle.
//   "Offset Text" layer: anchor should sit at the center of the text bounding box.
//   Both layers should not appear to have jumped (position compensated).

import {
  test, send,
  assertNoError, assertField, assertStructuredError, requireSetup,
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

  if (!requireSetup(setupOk)) return;

  // ── centerAnchorPoint on shape layer ──────────────────────────────────────

  await test('centerAnchorPoint — center anchor on shape layer; previousValues captured', async () => {
    const before = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.anchorShapeIndex,
      propertyPath: ['Transform', 'Anchor Point']
    });
    assertNoError(before);
    const oldAnchor = before.property.value;

    // Setup keyframed the Anchor Point to offset it — overwriteKeyframes:true acknowledges the clear.
    const r = await send('centerAnchorPoint', {
      compName: COMP_NAME, layerIndex: ctx.anchorShapeIndex, overwriteKeyframes: true
    });
    assertNoError(r);
    assertField(r, 'anchor');
    assertField(r, 'position');
    // B4: previousValues
    assertField(r, 'previousValues', 'object');
    if (!('anchorPoint' in r.previousValues)) throw new Error('previousValues missing anchorPoint');
    if (!('position'    in r.previousValues)) throw new Error('previousValues missing position');
    if (Array.isArray(r.previousValues.anchorPoint)) {
      if (Math.abs(r.previousValues.anchorPoint[0] - 200) > 1) {
        throw new Error(`expected previousValues.anchorPoint[0]≈200 (the offset set in setup), got ${r.previousValues.anchorPoint[0]}`);
      }
    }

    // The new anchor should differ from the offset starting point
    const newAnchor = r.anchor;
    if (Array.isArray(oldAnchor) && Array.isArray(newAnchor)) {
      const changed = Math.abs(newAnchor[0] - oldAnchor[0]) > 0.5 || Math.abs(newAnchor[1] - oldAnchor[1]) > 0.5;
      if (!changed) throw new Error('Anchor did not change after centerAnchorPoint');
    }
    ctx.anchorAfterCenter = r.anchor;
    return `anchor → [${r.anchor[0].toFixed(1)}, ${r.anchor[1].toFixed(1)}], previousValues.anchorPoint=[${r.previousValues.anchorPoint}]`;
  });

  await test('centerAnchorPoint — calling again is idempotent (no keyframes now)', async () => {
    // Previous call cleared the keyframes, so this call should work without the flag.
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

    // overwriteKeyframes:true acknowledges that the setup keyframe will be cleared.
    const r = await send('centerAnchorPoint', {
      compName: COMP_NAME, layerIndex: ctx.anchorShapeIndex, preservePosition: false, overwriteKeyframes: true
    });
    assertNoError(r);
    assertField(r, 'anchor');
  });

  // ── Error path ────────────────────────────────────────────────────────────

  await test('centerAnchorPoint — invalid layer index returns error', async () => {
    const r = await send('centerAnchorPoint', {
      compName: COMP_NAME, layerIndex: 99
    });
    assertStructuredError(r);
  });

  // ── overwriteKeyframes guard contract ────────────────────────────────────

  await test('centerAnchorPoint — throws INVALID_ARGS when anchor has keyframes and no overwriteKeyframes', async () => {
    // Re-keyframe the anchor on the shape layer to set up the guard condition
    await send('setLayerKeyframe', {
      compName: COMP_NAME, layerIndex: ctx.anchorShapeIndex,
      propertyName: 'Anchor Point', timeInSeconds: 0, value: [150, 150]
    });

    const r = await send('centerAnchorPoint', {
      compName: COMP_NAME, layerIndex: ctx.anchorShapeIndex
    });
    assertStructuredError(r, 'INVALID_ARGS');
    if (!r.message.toLowerCase().includes('overwritekeyframes')) {
      throw new Error(`expected message to mention overwriteKeyframes, got: "${r.message}"`);
    }
  });

  await test('centerAnchorPoint — overwriteKeyframes:true clears keyframes and succeeds', async () => {
    const r = await send('centerAnchorPoint', {
      compName: COMP_NAME, layerIndex: ctx.anchorShapeIndex, overwriteKeyframes: true
    });
    assertNoError(r);
    assertField(r, 'anchor');
  });

  // ── setAnchorPoint ────────────────────────────────────────────────────────

  await test('setAnchorPoint CENTER — same result as centerAnchorPoint', async () => {
    const r = await send('setAnchorPoint', {
      compName: COMP_NAME, layerIndex: ctx.anchorShapeIndex, position: 'CENTER'
    });
    assertNoError(r);
    assertField(r, 'anchor');
    assertField(r, 'position');
    assertField(r, 'anchorPosition');
    if (r.anchorPosition !== 'CENTER') throw new Error(`Expected anchorPosition=CENTER, got ${r.anchorPosition}`);
    assertField(r, 'previousValues', 'object');
    return `anchor=[${r.anchor}], anchorPosition=${r.anchorPosition}`;
  });

  await test('setAnchorPoint TOP_LEFT — anchor moves to top-left of bbox', async () => {
    const before = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.anchorShapeIndex,
      propertyPath: ['Transform', 'Anchor Point']
    });
    assertNoError(before);
    const r = await send('setAnchorPoint', {
      compName: COMP_NAME, layerIndex: ctx.anchorShapeIndex, position: 'TOP_LEFT'
    });
    assertNoError(r);
    assertField(r, 'anchor');
    // Anchor should have moved
    const changed = Math.abs(r.anchor[0] - before.property.value[0]) > 0.5 ||
                    Math.abs(r.anchor[1] - before.property.value[1]) > 0.5;
    if (!changed) throw new Error('Anchor did not move for TOP_LEFT');
    assertField(r, 'previousValues', 'object');
    return `anchor=[${r.anchor[0].toFixed(1)}, ${r.anchor[1].toFixed(1)}]`;
  });

  await test('setAnchorPoint BOTTOM_RIGHT — anchor moves to bottom-right of bbox', async () => {
    const r = await send('setAnchorPoint', {
      compName: COMP_NAME, layerIndex: ctx.anchorShapeIndex, position: 'BOTTOM_RIGHT'
    });
    assertNoError(r);
    assertField(r, 'anchor');
    return `anchor=[${r.anchor[0].toFixed(1)}, ${r.anchor[1].toFixed(1)}]`;
  });

  await test('setAnchorPoint — invalid position enum returns INVALID_ARGS', async () => {
    const r = await send('setAnchorPoint', {
      compName: COMP_NAME, layerIndex: ctx.anchorShapeIndex, position: 'BOGUS_POSITION'
    });
    assertStructuredError(r, 'INVALID_ARGS');
  });

  await test('setAnchorPoint — previousValues captured for revert', async () => {
    const r = await send('setAnchorPoint', {
      compName: COMP_NAME, layerIndex: ctx.anchorShapeIndex, position: 'MIDDLE_LEFT'
    });
    assertNoError(r);
    if (!r.previousValues || !('anchorPoint' in r.previousValues)) {
      throw new Error('previousValues.anchorPoint missing');
    }
    if (!('position' in r.previousValues)) {
      throw new Error('previousValues.position missing');
    }
    return `previousAnchor=[${r.previousValues.anchorPoint}]`;
  });
}
