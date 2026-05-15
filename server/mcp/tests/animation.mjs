// animation.mjs — tests for animation.jsx
//
// Covers:
//   getLayerExpressions    (R  — expressions)
//   setLayerExpression     (C/U — expressions; set + remove via empty string)
//   getLayerKeyframes      (R  — keyframes)
//   setLayerKeyframe       (C  — keyframes)
//   setKeyframeEasing      (U  — keyframes)
//   removePropertyKeyframes (D — keyframes)
//
// Missing: none — all CRUD covered for both keyframes and expressions.
//
// Visual verification (after --write, open __MCP_TEST_animation__ in After Effects):
//   Play 0–4 s:
//     • Text spins continuously (Rotation expression: time * 90)
//     • Text fades in from invisible to fully opaque over the first 2 s (Opacity keyframes)
//     • Text slides left-to-right across the frame (Position keyframes, easy-eased)
//   Rotation keyframes were set then removed; the expression still drives rotation.
//   Scrub the timeline — no stray keyframes on Rotation, only Position and Opacity.

import {
  test, send,
  assertNoError, assertField, assertArray, assertValue,
  bold, yellow
} from './helpers.mjs';

const COMP_NAME = '__MCP_TEST_animation__';

export async function run(ctx, opts) {
  console.log(bold('\nAnimation'));

  if (!opts.write) return;

  // ── Setup ─────────────────────────────────────────────────────────────────

  let li;

  const setupOk = await test('setup — create animation test comp + text layer', async () => {
    const cr = await send('createComposition', {
      name: COMP_NAME, width: 1920, height: 1080, frameRate: 30, duration: 10, pixelAspect: 1
    });
    assertField(cr, 'composition', 'object');

    const lr = await send('createTextLayer', {
      compName: COMP_NAME, text: 'MCP Test', fontSize: 120,
      position: [960, 540], color: [1, 1, 1]
    });
    assertNoError(lr);
    li = 1; // first layer added lands at index 1
    return `layer ${li}`;
  });

  if (!setupOk) {
    console.log(yellow('  Animation tests skipped — setup failed'));
    return;
  }

  // ── Expressions ───────────────────────────────────────────────────────────

  await test('setLayerExpression — Rotation: time*90 (spin, stays on layer)', async () => {
    const r = await send('setLayerExpression', {
      compName: COMP_NAME, layerIndex: li,
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
      compName: COMP_NAME, layerIndex: li
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
      compName: COMP_NAME, layerIndex: li, propertyName: 'Opacity', expressionString: 'value'
    });
    assertNoError(set);

    const remove = await send('setLayerExpression', {
      compName: COMP_NAME, layerIndex: li, propertyName: 'Opacity', expressionString: ''
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
      compName: COMP_NAME, layerIndex: li,
      propertyName: 'Position', timeInSeconds: 0, value: [200, 540]
    });
    assertNoError(r);
    assertField(r, 'message', 'string');
    if (!r.message.includes('Position')) throw new Error(`unexpected message: ${r.message}`);
  });

  await test('setLayerKeyframe — Position @ 4s: right edge', async () => {
    const r = await send('setLayerKeyframe', {
      compName: COMP_NAME, layerIndex: li,
      propertyName: 'Position', timeInSeconds: 4, value: [1720, 540]
    });
    assertNoError(r);
  });

  await test('setLayerKeyframe — Opacity @ 0s: 0%', async () => {
    const r = await send('setLayerKeyframe', {
      compName: COMP_NAME, layerIndex: li,
      propertyName: 'Opacity', timeInSeconds: 0, value: 0
    });
    assertNoError(r);
  });

  await test('setLayerKeyframe — Opacity @ 2s: 100%', async () => {
    const r = await send('setLayerKeyframe', {
      compName: COMP_NAME, layerIndex: li,
      propertyName: 'Opacity', timeInSeconds: 2, value: 100
    });
    assertNoError(r);
  });

  // ── Read keyframes ─────────────────────────────────────────────────────────

  await test('getLayerKeyframes — Position: 2 keyframes with correct times', async () => {
    const r = await send('getLayerKeyframes', {
      compName: COMP_NAME, layerIndex: li, propertyName: 'Position'
    });
    assertNoError(r);
    assertArray(r, 'keyframes');
    assertField(r, 'count', 'number');
    if (r.count !== 2) throw new Error(`expected 2 keyframes, got ${r.count}`);
    const k0 = r.keyframes[0];
    assertField(k0, 'keyIndex', 'number');
    assertField(k0, 'time', 'number');
    assertField(k0, 'inInterpolationType', 'number');
    assertField(k0, 'outInterpolationType', 'number');
    if (k0.time !== 0) throw new Error(`expected time=0 at keyframe 1, got ${k0.time}`);
    if (r.keyframes[1].time !== 4) throw new Error(`expected time=4 at keyframe 2, got ${r.keyframes[1].time}`);
    return `${r.count} keyframe(s) at t=${r.keyframes.map(k => k.time + 's').join(', ')}`;
  });

  // ── Easing (stays on layer) ───────────────────────────────────────────────

  await test('setKeyframeEasing — easyEase on all Position keyframes', async () => {
    const r = await send('setKeyframeEasing', {
      compName: COMP_NAME, layerIndex: li,
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
      compName: COMP_NAME, layerIndex: li,
      propertyName: 'Opacity', easeType: 'easeIn', keyIndex: 1
    });
    assertNoError(r);
  });

  // ── removePropertyKeyframes (Rotation — overridden by expression, visual unaffected) ──

  await test('setLayerKeyframe — Rotation @ 0s and 4s (overridden by expression)', async () => {
    const r0 = await send('setLayerKeyframe', {
      compName: COMP_NAME, layerIndex: li, propertyName: 'Rotation', timeInSeconds: 0, value: 0
    });
    assertNoError(r0);
    const r4 = await send('setLayerKeyframe', {
      compName: COMP_NAME, layerIndex: li, propertyName: 'Rotation', timeInSeconds: 4, value: 720
    });
    assertNoError(r4);
    return '2 keyframes set (expression takes precedence visually)';
  });

  await test('removePropertyKeyframes — clears Rotation keyframes (expression unaffected)', async () => {
    const r = await send('removePropertyKeyframes', {
      compName: COMP_NAME, layerIndex: li, propertyName: 'Rotation'
    });
    assertNoError(r);
    assertField(r, 'removed', 'number');
    if (r.removed < 2) throw new Error(`expected ≥2 keyframes removed, got ${r.removed}`);
    return `${r.removed} keyframe(s) removed`;
  });
}
