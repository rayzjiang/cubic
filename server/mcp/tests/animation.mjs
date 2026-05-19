// animation.mjs — tests for animation.jsx
//
// Covers:
//   getLayerExpressions    (R  — expressions)
//   setLayerExpression     (C/U — expressions; set + remove via empty string; previousValue capture)
//   getLayerKeyframes      (R  — keyframes; via propertyName and propertyPath)
//   setLayerKeyframe       (C  — keyframes; previousKey capture; propertyPath for nested props)
//   setKeyframeEasing      (U  — keyframes; previousEasings capture; propertyPath)
//   setKeyframeSpatial     (U  — spatial tangents, autoBezier, continuous, roving; previousSpatial;
//                                propertyPath form; endpoint-roving warning; error paths)
//   removePropertyKeyframes (D — keyframes; propertyPath)
//   getLayerProperty       (R  — path-based property read, at current time and at given time)
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
  assertStructuredError, requireSetup,
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

    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'text', text: 'MCP Test', fontSize: 120,
      position: [960, 540], color: [1, 1, 1]
    });
    assertNoError(lr);
    li = 1; // first layer added lands at index 1
    return `layer ${li}`;
  });

  if (!requireSetup(setupOk)) return;

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
    assertField(set, 'previousValue', 'string');

    const remove = await send('setLayerExpression', {
      compName: COMP_NAME, layerIndex: li, propertyName: 'Opacity', expressionString: ''
    });
    assertNoError(remove);
    if (remove.previousValue !== 'value') {
      throw new Error(`expected previousValue="value", got "${remove.previousValue}"`);
    }
    if (!remove.message.toLowerCase().includes('remov')) {
      throw new Error(`expected "removed" in message, got: "${remove.message}"`);
    }
    return 'set + removed, previousValue captured';
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
    assertField(r, 'previousKey', 'object');
    if (r.previousKey.existed !== false) throw new Error('expected previousKey.existed=false for first keyframe');
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
    assertField(k0, 'inInterpolationLabel', 'string');
    assertField(k0, 'outInterpolationType', 'number');
    assertField(k0, 'outInterpolationLabel', 'string');
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
    assertField(r, 'previousEasings');
    if (!Array.isArray(r.previousEasings)) throw new Error('previousEasings is not an array');
    if (r.previousEasings.length === 0) throw new Error('expected previousEasings to capture prior state');
    const pe = r.previousEasings[0];
    assertField(pe, 'keyIndex', 'number');
    assertField(pe, 'inInterp', 'number');
    assertField(pe, 'outInterp', 'number');
    return `${r.previousEasings.length} prior easings captured`;
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

  // ── setKeyframeSpatial — spatial tangents on Position keyframes ───────────

  await test('setKeyframeSpatial — autoBezier:true on all Position keyframes, previousSpatial captured', async () => {
    const r = await send('setKeyframeSpatial', {
      compName: COMP_NAME, layerIndex: li,
      propertyName: 'Position', autoBezier: true
    });
    assertNoError(r);
    assertField(r, 'keysModified');
    if (!Array.isArray(r.keysModified) || r.keysModified.length < 2) {
      throw new Error(`expected ≥2 keysModified, got ${JSON.stringify(r.keysModified)}`);
    }
    assertField(r, 'previousSpatial');
    if (!Array.isArray(r.previousSpatial) || r.previousSpatial.length === 0) {
      throw new Error('previousSpatial should be a non-empty array');
    }
    const ps = r.previousSpatial[0];
    assertField(ps, 'keyIndex', 'number');
    assertField(ps, 'inTangent');
    assertField(ps, 'outTangent');
    if (!('autoBezier'  in ps)) throw new Error('previousSpatial[0] missing autoBezier');
    if (!('continuous'  in ps)) throw new Error('previousSpatial[0] missing continuous');
    if (!('roving'      in ps)) throw new Error('previousSpatial[0] missing roving');
    return `${r.keysModified.length} keys modified, ${r.previousSpatial.length} prior states captured`;
  });

  await test('setKeyframeSpatial — explicit spatialIn/spatialOut on keyIndex:1, previousSpatial has 1 entry', async () => {
    const r = await send('setKeyframeSpatial', {
      compName: COMP_NAME, layerIndex: li,
      propertyName: 'Position', keyIndex: 1,
      spatialIn: [10, 0, 0], spatialOut: [10, 0, 0]
    });
    assertNoError(r);
    if (!Array.isArray(r.previousSpatial) || r.previousSpatial.length !== 1) {
      throw new Error(`expected previousSpatial.length=1, got ${r.previousSpatial && r.previousSpatial.length}`);
    }
    return `keyIndex=${r.keysModified[0]}, previousSpatial captured`;
  });

  await test('setKeyframeSpatial — continuous:true via propertyPath form', async () => {
    const r = await send('setKeyframeSpatial', {
      compName: COMP_NAME, layerIndex: li,
      propertyPath: ['Transform', 'Position'], continuous: true
    });
    assertNoError(r);
    assertField(r, 'keysModified');
    if (!Array.isArray(r.keysModified) || r.keysModified.length === 0) {
      throw new Error('expected at least one key modified via propertyPath');
    }
    return `${r.keysModified.length} keys made continuous via propertyPath`;
  });

  await test('setKeyframeSpatial — roving on endpoint key (keyIndex:1) surfaces warning, does not throw', async () => {
    const r = await send('setKeyframeSpatial', {
      compName: COMP_NAME, layerIndex: li,
      propertyName: 'Position', keyIndex: 1, roving: true
    });
    assertNoError(r);
    assertField(r, 'warnings');
    if (!Array.isArray(r.warnings) || r.warnings.length === 0) {
      throw new Error('expected a warning about endpoint roving, got none');
    }
    if (!r.warnings[0].toLowerCase().includes('first or last')) {
      throw new Error(`unexpected warning text: "${r.warnings[0]}"`);
    }
    return `warning: "${r.warnings[0]}"`;
  });

  await test('setKeyframeSpatial — non-spatial property (Opacity) returns INVALID_ARGS', async () => {
    const r = await send('setKeyframeSpatial', {
      compName: COMP_NAME, layerIndex: li,
      propertyName: 'Opacity', autoBezier: true
    });
    assertStructuredError(r, 'INVALID_ARGS');
    if (!r.message.toLowerCase().includes('spatial')) {
      throw new Error(`expected "spatial" in error message, got: "${r.message}"`);
    }
  });

  await test('setKeyframeSpatial — property with no keyframes (Rotation, cleared above) returns INVALID_ARGS', async () => {
    const r = await send('setKeyframeSpatial', {
      compName: COMP_NAME, layerIndex: li,
      propertyName: 'Rotation', autoBezier: true
    });
    assertStructuredError(r, 'INVALID_ARGS');
  });

  // ── propertyPath — nested keyframing on shape Trim Paths (Issue A) ────────

  let shapeLi;
  let trimPathsOpName = 'Trim Paths 1';

  const shapeSetupOk = await test('propertyPath setup — shape layer + Trim Paths operator', async () => {
    const sl = await send('createLayer', {
      compName: COMP_NAME, type: 'shape', name: 'Trim Paths Test', shapeType: 'rectangle',
      size: [400, 400], fillColor: [0.2, 0.6, 1], duration: 10
    });
    assertNoError(sl);
    shapeLi = sl.layer.index;

    const tp = await send('addShapeOperator', {
      compName: COMP_NAME, layerIndex: shapeLi, type: 'trimPaths'
    });
    assertNoError(tp);
    trimPathsOpName = tp.operator.name;
    return `layer ${shapeLi}, operator "${trimPathsOpName}"`;
  });

  if (shapeSetupOk) {
    li++; // shape layer landed at index 1 (top), text layer shifted down to li

    await test('setLayerKeyframe — propertyPath: Trim Paths End @ 0s = 0', async () => {
      const path = ['Contents', 'Group 1', trimPathsOpName, 'End'];
      const r = await send('setLayerKeyframe', {
        compName: COMP_NAME, layerIndex: shapeLi,
        propertyPath: path, timeInSeconds: 0, value: 0
      });
      assertNoError(r);
      assertField(r, 'previousKey', 'object');
      if (r.previousKey.existed !== false) throw new Error('expected previousKey.existed=false for first keyframe');
      return `previousKey.existed=${r.previousKey.existed}`;
    });

    await test('setLayerKeyframe — propertyPath: Trim Paths End @ 2s = 100', async () => {
      const path = ['Contents', 'Group 1', trimPathsOpName, 'End'];
      const r = await send('setLayerKeyframe', {
        compName: COMP_NAME, layerIndex: shapeLi,
        propertyPath: path, timeInSeconds: 2, value: 100
      });
      assertNoError(r);
    });

    await test('getLayerKeyframes — propertyPath: Trim Paths End has 2 keyframes, property is object', async () => {
      const path = ['Contents', 'Group 1', trimPathsOpName, 'End'];
      const r = await send('getLayerKeyframes', {
        compName: COMP_NAME, layerIndex: shapeLi,
        propertyPath: path
      });
      assertNoError(r);
      assertArray(r, 'keyframes');
      if (r.count !== 2) throw new Error(`expected 2 keyframes, got ${r.count}`);
      assertField(r, 'property', 'object');
      if (typeof r.property !== 'object' || Array.isArray(r.property)) {
        throw new Error('expected property to be an object (not a flat string)');
      }
      return `${r.count} keyframes, property.name="${r.property.name}"`;
    });

    await test('setKeyframeEasing — propertyPath: easyEase on Trim Paths End', async () => {
      const path = ['Contents', 'Group 1', trimPathsOpName, 'End'];
      const r = await send('setKeyframeEasing', {
        compName: COMP_NAME, layerIndex: shapeLi,
        propertyPath: path, easeType: 'easyEase'
      });
      assertNoError(r);
      assertField(r, 'previousEasings');
      if (!Array.isArray(r.previousEasings)) throw new Error('previousEasings not an array');
      if (r.previousEasings.length === 0) throw new Error('expected previousEasings entries');
      return `${r.previousEasings.length} prior easings captured`;
    });

    await test('removePropertyKeyframes — propertyPath: clears Trim Paths End keyframes', async () => {
      const path = ['Contents', 'Group 1', trimPathsOpName, 'End'];
      const r = await send('removePropertyKeyframes', {
        compName: COMP_NAME, layerIndex: shapeLi,
        propertyPath: path
      });
      assertNoError(r);
      assertField(r, 'removed', 'number');
      if (r.removed < 2) throw new Error(`expected ≥2 keyframes removed, got ${r.removed}`);
      return `${r.removed} keyframe(s) removed`;
    });
  }

  // ── getLayerProperty (path-based reads) ──────────────────────────────────

  await test('getLayerProperty — read Position via Transform path', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: li,
      propertyPath: ['Transform', 'Position']
    });
    assertNoError(r);
    assertField(r, 'property', 'object');
    assertField(r.property, 'name', 'string');
    assertField(r.property, 'value');
    assertField(r.property, 'numKeys', 'number');
    if (r.property.numKeys < 2) throw new Error(`Expected >=2 keyframes on Position (set earlier), got ${r.property.numKeys}`);
    return `Position value=${JSON.stringify(r.property.value)}, numKeys=${r.property.numKeys}`;
  });

  await test('getLayerProperty — valueAtTime returns interpolated Position', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: li,
      propertyPath: ['Transform', 'Position'],
      timeInSeconds: 1.0
    });
    assertNoError(r);
    assertField(r.property, 'valueAtTime');
    assertField(r.property, 'timeInSeconds', 'number');
    return `Position at 1s=${JSON.stringify(r.property.valueAtTime)}`;
  });

  await test('getLayerProperty — Rotation has expression flag set', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: li,
      propertyPath: ['Transform', 'Rotation']
    });
    assertNoError(r);
    if (r.property.hasExpression !== true) throw new Error('Expected hasExpression=true on Rotation (expression set earlier)');
    if (!r.property.expression || r.property.expression.trim() === '') {
      throw new Error('Expected non-empty expression string on Rotation');
    }
    return `expression="${r.property.expression.slice(0, 30)}"`;
  });

  await test('getLayerProperty — Opacity via shorthand Transform path', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: li,
      propertyPath: ['Transform', 'Opacity']
    });
    assertNoError(r);
    assertField(r.property, 'value');
    return `Opacity=${r.property.value}`;
  });

  await test('getLayerProperty — invalid path returns error', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: li,
      propertyPath: ['DoesNot', 'Exist', 'AtAll']
    });
    assertStructuredError(r);
  });

  await test('getLayerProperty — empty propertyPath returns error', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: li,
      propertyPath: []
    });
    assertStructuredError(r);
  });
}
