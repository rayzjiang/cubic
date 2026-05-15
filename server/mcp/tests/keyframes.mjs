// keyframes.mjs — tests for animation.jsx
// Covers: getLayerKeyframes, setLayerKeyframe, setKeyframeEasing, removePropertyKeyframes,
//         setLayerExpression, getLayerExpressions
//
// Creates its own __MCP_TEST_keyframes__ comp so results are visually isolated.
// Visual result after run: spinning text (Rotation expression) that fades in
// (Opacity 0→100) and slides across screen (Position left→right).
// removePropertyKeyframes is verified on Rotation keyframes which exist but are
// overridden by the expression, so the visual is unaffected.

import {
  test, send,
  assertNoError, assertField, assertArray, assertValue,
  bold, yellow
} from './helpers.mjs';

const COMP_NAME = '__MCP_TEST_keyframes__';

export async function run(ctx, opts) {
  console.log(bold('\nKeyframes & Expressions'));

  if (!opts.write) return;

  // ── Setup ─────────────────────────────────────────────────────────────────

  let ci, li;

  const setupOk = await test('setup — create keyframes test comp + text layer', async () => {
    const cr = await send('createComposition', {
      name: COMP_NAME, width: 1920, height: 1080, frameRate: 30, duration: 10, pixelAspect: 1
    });
    assertField(cr, 'composition', 'object');
    ci = cr.composition.itemIndex;

    const lr = await send('createTextLayer', {
      compName: COMP_NAME, text: 'MCP Test', fontSize: 120,
      position: [960, 540], color: [1, 1, 1]
    });
    assertNoError(lr);
    li = 1; // first layer added lands at index 1
    return `comp ${ci}, layer ${li}`;
  });

  if (!setupOk) {
    console.log(yellow('  Keyframe tests skipped — setup failed'));
    return;
  }

  // ── Expressions ───────────────────────────────────────────────────────────

  await test('setLayerExpression — Rotation: time*90 (spin, stays on layer)', async () => {
    const r = await send('setLayerExpression', {
      compIndex: ci, layerIndex: li,
      propertyName: 'Rotation', expressionString: 'time * 90'
    });
    assertNoError(r);
    assertField(r, 'message', 'string');
    if (!r.message.toLowerCase().includes('set')) {
      throw new Error(`unexpected message: ${r.message}`);
    }
  });

  await test('getLayerExpressions — finds Rotation expression', async () => {
    const r = await send('getLayerExpressions', {
      compIndex: ci, layerIndex: li
    });
    assertNoError(r);
    assertArray(r, 'expressions');
    assertField(r, 'count', 'number');
    if (r.count === 0) throw new Error('expected ≥1 expression, got 0');
    const rotExpr = r.expressions.find(e => e.property && e.property.includes('Rotation'));
    if (!rotExpr) throw new Error(`Rotation expression not found in: ${JSON.stringify(r.expressions.map(e => e.property))}`);
    if (rotExpr.expression !== 'time * 90') throw new Error(`value mismatch: "${rotExpr.expression}"`);
    return `${r.count} expression(s)`;
  });

  await test('setLayerExpression — Opacity: set then remove via empty string', async () => {
    const set = await send('setLayerExpression', {
      compIndex: ci, layerIndex: li, propertyName: 'Opacity', expressionString: 'value'
    });
    assertNoError(set);

    const remove = await send('setLayerExpression', {
      compIndex: ci, layerIndex: li, propertyName: 'Opacity', expressionString: ''
    });
    assertNoError(remove);
    if (!remove.message.toLowerCase().includes('remov')) {
      throw new Error(`expected "removed" in message, got: "${remove.message}"`);
    }
    return 'set + removed';
  });

  // ── Keyframes (stay on layer for visual verification) ─────────────────────

  await test('setLayerKeyframe — Position @ 0s: left edge', async () => {
    const r = await send('setLayerKeyframe', {
      compIndex: ci, layerIndex: li,
      propertyName: 'Position', timeInSeconds: 0, value: [200, 540]
    });
    assertNoError(r);
    assertField(r, 'message', 'string');
    if (!r.message.includes('Position')) throw new Error(`unexpected message: ${r.message}`);
  });

  await test('setLayerKeyframe — Position @ 4s: right edge', async () => {
    const r = await send('setLayerKeyframe', {
      compIndex: ci, layerIndex: li,
      propertyName: 'Position', timeInSeconds: 4, value: [1720, 540]
    });
    assertNoError(r);
  });

  await test('setLayerKeyframe — Opacity @ 0s: 0%', async () => {
    const r = await send('setLayerKeyframe', {
      compIndex: ci, layerIndex: li,
      propertyName: 'Opacity', timeInSeconds: 0, value: 0
    });
    assertNoError(r);
  });

  await test('setLayerKeyframe — Opacity @ 2s: 100%', async () => {
    const r = await send('setLayerKeyframe', {
      compIndex: ci, layerIndex: li,
      propertyName: 'Opacity', timeInSeconds: 2, value: 100
    });
    assertNoError(r);
  });

  // ── Easing (stays on layer) ───────────────────────────────────────────────

  await test('setKeyframeEasing — easyEase on all Position keyframes', async () => {
    const r = await send('setKeyframeEasing', {
      compIndex: ci, layerIndex: li,
      propertyName: 'Position', easeType: 'easyEase'
    });
    assertNoError(r);
    assertField(r, 'keyframesModified', 'object');
    if (!Array.isArray(r.keyframesModified)) throw new Error('"keyframesModified" is not an array');
    if (r.keyframesModified.length === 0) throw new Error('no keyframes were modified');
    assertValue(r, 'easeType', 'easyEase');
  });

  await test('setKeyframeEasing — easeIn on Opacity keyframe 1', async () => {
    const r = await send('setKeyframeEasing', {
      compIndex: ci, layerIndex: li,
      propertyName: 'Opacity', easeType: 'easeIn', keyIndex: 1
    });
    assertNoError(r);
  });

  // ── removePropertyKeyframes (Rotation keyframes — overridden by expression) ─

  await test('setLayerKeyframe — Rotation @ 0s and 4s (overridden by expression)', async () => {
    const r0 = await send('setLayerKeyframe', {
      compIndex: ci, layerIndex: li, propertyName: 'Rotation', timeInSeconds: 0, value: 0
    });
    assertNoError(r0);
    const r4 = await send('setLayerKeyframe', {
      compIndex: ci, layerIndex: li, propertyName: 'Rotation', timeInSeconds: 4, value: 720
    });
    assertNoError(r4);
    return '2 keyframes set (expression takes precedence)';
  });

  await test('removePropertyKeyframes — clears Rotation keyframes (expression unaffected)', async () => {
    const r = await send('removePropertyKeyframes', {
      compIndex: ci, layerIndex: li, propertyName: 'Rotation'
    });
    assertNoError(r);
    assertField(r, 'removed', 'number');
    if (r.removed < 2) throw new Error(`expected ≥2 keyframes removed, got ${r.removed}`);
    return `${r.removed} keyframe(s) removed`;
  });
}
