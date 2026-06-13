// animation.mjs — tests for animation.jsx
//
// Covers:
//   getLayerExpressions    (R  — expressions)
//   setLayerExpression     (C/U — expressions; set + remove via empty string; previousValue capture;
//                                preset: WIGGLE/INERTIAL_BOUNCE/LOOP_OUT with presetParams)
//   getLayerKeyframes      (R  — keyframes; via propertyName and propertyPath;
//                                inTemporalEase/outTemporalEase additive fields)
//   setLayerKeyframe       (C  — keyframes; previousKey capture; propertyPath for nested props)
//   setKeyframeEasing      (U  — keyframes; previousEasings capture; propertyPath)
//   setKeyframeSpatial     (U  — spatial tangents, autoBezier, continuous, roving; previousSpatial;
//                                propertyPath form; endpoint-roving warning; error paths)
//   copyKeyframeEasing     (U  — copies easing from source to target without changing values;
//                                pairsCopied + previousEasings; cross-layer; timeOffset)
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

  // ── setLayerExpression with presets ───────────────────────────────────────

  await test('setLayerExpression — preset WIGGLE injects expression string', async () => {
    const r = await send('setLayerExpression', {
      compName: COMP_NAME, layerIndex: li,
      propertyName: 'Position',
      preset: 'WIGGLE', presetParams: { freq: 5, amp: 15 }
    });
    assertNoError(r);
    assertField(r, 'preset', 'string');
    if (r.preset !== 'WIGGLE') throw new Error(`Expected preset=WIGGLE, got ${r.preset}`);
    assertField(r, 'previousValue');
    // Verify expression was actually applied
    const check = await send('getLayerExpressions', { compName: COMP_NAME, layerIndex: li });
    assertNoError(check);
    const hasWiggle = check.expressions.some(e => e.expression && e.expression.toLowerCase().includes('wiggle'));
    if (!hasWiggle) throw new Error('Expected wiggle() expression on Position');
    return `preset WIGGLE applied`;
  });

  await test('setLayerExpression — preset LOOP_OUT on Opacity', async () => {
    // Add an opacity keyframe first so loopOut has something to loop
    await send('setLayerKeyframe', {
      compName: COMP_NAME, layerIndex: li,
      propertyName: 'Opacity', timeInSeconds: 0, value: 100
    });
    const r = await send('setLayerExpression', {
      compName: COMP_NAME, layerIndex: li,
      propertyName: 'Opacity',
      preset: 'LOOP_OUT'
    });
    assertNoError(r);
    if (r.preset !== 'LOOP_OUT') throw new Error(`Expected preset=LOOP_OUT, got ${r.preset}`);
    return `LOOP_OUT expression applied to Opacity`;
  });

  await test('setLayerExpression — invalid preset name returns INVALID_ARGS', async () => {
    const r = await send('setLayerExpression', {
      compName: COMP_NAME, layerIndex: li,
      propertyName: 'Opacity',
      preset: 'DOES_NOT_EXIST'
    });
    assertStructuredError(r, 'INVALID_ARGS');
  });

  // Clear expressions we added above
  await send('setLayerExpression', { compName: COMP_NAME, layerIndex: li, propertyName: 'Position', expressionString: '' });
  await send('setLayerExpression', { compName: COMP_NAME, layerIndex: li, propertyName: 'Opacity',   expressionString: '' });

  // ── getLayerKeyframes — verify new easing fields ──────────────────────────

  await test('getLayerKeyframes — inTemporalEase/outTemporalEase included in keyframe data', async () => {
    // Position was keyframed earlier in this suite
    const r = await send('getLayerKeyframes', {
      compName: COMP_NAME, layerIndex: li,
      propertyName: 'Position'
    });
    assertNoError(r);
    assertArray(r, 'keyframes');
    if (r.keyframes.length === 0) throw new Error('Expected at least 1 keyframe on Position');
    const kf = r.keyframes[0];
    if (!('inTemporalEase' in kf)) throw new Error('keyframe missing inTemporalEase');
    if (!('outTemporalEase' in kf)) throw new Error('keyframe missing outTemporalEase');
    if (!Array.isArray(kf.inTemporalEase) || kf.inTemporalEase.length === 0) {
      throw new Error('inTemporalEase should be non-empty array');
    }
    if (!('speed' in kf.inTemporalEase[0]) || !('influence' in kf.inTemporalEase[0])) {
      throw new Error('inTemporalEase[0] missing speed/influence fields');
    }
    return `keyframe[0].inTemporalEase[0]=${JSON.stringify(kf.inTemporalEase[0])}`;
  });

  // ── copyKeyframeEasing ────────────────────────────────────────────────────

  await test('copyKeyframeEasing — copy easing from source layer to target layer', async () => {
    // Create a second text layer to serve as the easing target
    const tgt = await send('createLayer', {
      compName: COMP_NAME, type: 'text', text: 'Target',
      fontSize: 80, position: [960, 700], color: [1, 0.5, 0]
    });
    assertNoError(tgt);
    const tgtIdx = 1; // new layers go to index 1
    li++; // tgt shifts the source text layer down one index

    // Add two keyframes on target Position so there's something to copy easing TO
    await send('setLayerKeyframe', { compName: COMP_NAME, layerIndex: tgtIdx, propertyName: 'Position', timeInSeconds: 0, value: [100, 700] });
    await send('setLayerKeyframe', { compName: COMP_NAME, layerIndex: tgtIdx, propertyName: 'Position', timeInSeconds: 2, value: [1820, 700] });

    // Source layer (li) already has position keyframes from earlier in the suite
    const r = await send('copyKeyframeEasing', {
      sourceCompName: COMP_NAME, sourceLayerIndex: li,
      targetCompName: COMP_NAME, targetLayerIndex: tgtIdx,
      propertyName: 'Position'
    });
    assertNoError(r);
    assertField(r, 'pairsCopied', 'number');
    assertField(r, 'previousEasings');
    if (r.pairsCopied === 0) throw new Error('Expected at least 1 keyframe pair copied');
    if (!Array.isArray(r.previousEasings) || r.previousEasings.length === 0) {
      throw new Error('previousEasings should be non-empty array');
    }
    return `pairsCopied=${r.pairsCopied}`;
  });

  await test('copyKeyframeEasing — source with no keyframes returns INVALID_ARGS', async () => {
    const fresh = await send('createLayer', {
      compName: COMP_NAME, type: 'text', text: 'Fresh', fontSize: 50, color: [1, 1, 1]
    });
    assertNoError(fresh);
    const freshIdx = 1;
    const r = await send('copyKeyframeEasing', {
      sourceCompName: COMP_NAME, sourceLayerIndex: freshIdx,
      targetCompName: COMP_NAME, targetLayerIndex: li + 1,
      propertyName: 'Position'
    });
    assertStructuredError(r, 'INVALID_ARGS');
  });

  // ── applyMotionRecipe ─────────────────────────────────────────────────────

  // Create a dedicated set of solid layers for recipe tests (avoid polluting the text layer)
  let recipeLayerIdx;
  const recipeSetupOk = await test('applyMotionRecipe setup — create solid layer for recipe tests', async () => {
    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', name: 'Recipe Test Solid',
      color: [0.2, 0.6, 1.0], size: [200, 200]
    });
    assertNoError(lr);
    recipeLayerIdx = 1; // newest layer lands at index 1
    return `solid at index ${recipeLayerIdx}`;
  });

  if (recipeSetupOk) {
    await test('applyMotionRecipe — popIn on single layer: keyframesAdded≥4, Scale+Opacity animated', async () => {
      const r = await send('applyMotionRecipe', {
        compName: COMP_NAME, layerIndices: [recipeLayerIdx],
        recipe: 'popIn', startTime: 0, duration: 0.5, overwriteKeyframes: true
      });
      assertNoError(r);
      assertValue(r, 'recipe', 'popIn');
      assertValue(r, 'layersAffected', 1);
      assertArray(r, 'results');
      if (r.results.length !== 1) throw new Error(`expected results.length=1, got ${r.results.length}`);
      const res = r.results[0];
      if (res.keyframesAdded < 4) throw new Error(`expected keyframesAdded≥4, got ${res.keyframesAdded}`);

      // Read back Scale keyframes
      const sc = await send('getLayerKeyframes', {
        compName: COMP_NAME, layerIndex: recipeLayerIdx, propertyName: 'Scale'
      });
      assertNoError(sc);
      if (sc.count < 2) throw new Error(`expected ≥2 Scale keyframes, got ${sc.count}`);
      if (Math.abs(sc.keyframes[0].time - 0) > 0.01) {
        throw new Error(`first Scale keyframe should be at t=0, got ${sc.keyframes[0].time}`);
      }
      if (Math.abs(sc.keyframes[sc.count - 1].time - 0.5) > 0.01) {
        throw new Error(`last Scale keyframe should be at t=0.5, got ${sc.keyframes[sc.count - 1].time}`);
      }

      // Read back Opacity keyframes
      const op = await send('getLayerKeyframes', {
        compName: COMP_NAME, layerIndex: recipeLayerIdx, propertyName: 'Opacity'
      });
      assertNoError(op);
      if (op.count < 2) throw new Error(`expected ≥2 Opacity keyframes, got ${op.count}`);
      return `keyframesAdded=${res.keyframesAdded}, Scale keys=${sc.count}, Opacity keys=${op.count}`;
    });

    await test('applyMotionRecipe — popIn with bounce:true adds INERTIAL_BOUNCE expression on Scale', async () => {
      const r = await send('applyMotionRecipe', {
        compName: COMP_NAME, layerIndices: [recipeLayerIdx],
        recipe: 'popIn', startTime: 0, duration: 0.5, bounce: true, overwriteKeyframes: true
      });
      assertNoError(r);
      const res = r.results[0];
      if (!Array.isArray(res.expressionsApplied) || res.expressionsApplied.length === 0) {
        throw new Error('expected expressionsApplied to be non-empty when bounce:true');
      }

      // Read back expression and verify it contains bounce signature
      const exprs = await send('getLayerExpressions', {
        compName: COMP_NAME, layerIndex: recipeLayerIdx
      });
      assertNoError(exprs);
      const scaleExpr = exprs.expressions.find(e => e.property && e.property.toLowerCase().includes('scale'));
      if (!scaleExpr) throw new Error('no Scale expression found after bounce:true');
      if (!scaleExpr.expression.includes('amp') || !scaleExpr.expression.includes('freq')) {
        throw new Error(`Scale expression missing bounce signature: ${scaleExpr.expression.slice(0, 60)}`);
      }
      return `expressionsApplied: ${JSON.stringify(res.expressionsApplied)}`;
    });

    await test('applyMotionRecipe — 5 layers + stagger: layersAffected=5, 5th layer startTime=4*stagger', async () => {
      // Create 4 more solids so we have 5 total (recipeLayerIdx is already 1)
      for (let i = 0; i < 4; i++) {
        const lr = await send('createLayer', {
          compName: COMP_NAME, type: 'solid', name: 'Stagger Solid ' + i,
          color: [0.5, 0.5, 0.5], size: [100, 100]
        });
        assertNoError(lr);
      }
      // After 4 creates, recipeLayerIdx has shifted down by 4
      const idxBase = recipeLayerIdx + 4;
      const indices = [1, 2, 3, 4, idxBase];

      const r = await send('applyMotionRecipe', {
        compName: COMP_NAME, layerIndices: indices,
        recipe: 'fadeIn', startTime: 0, duration: 0.3, stagger: 0.1, overwriteKeyframes: true
      });
      assertNoError(r);
      assertValue(r, 'layersAffected', 5);
      if (r.results.length !== 5) throw new Error(`expected 5 results, got ${r.results.length}`);

      // 5th layer (index 4 in results array) should start at 4 * 0.1 = 0.4s
      const fifth = r.results[4];
      if (Math.abs(fifth.startTime - 0.4) > 0.001) {
        throw new Error(`expected 5th layer startTime≈0.4s, got ${fifth.startTime}`);
      }
      return `5 layers staggered; 5th.startTime=${fifth.startTime}`;
    });

    await test('applyMotionRecipe — slideIn with from override: start position offset applied', async () => {
      const slideLayer = await send('createLayer', {
        compName: COMP_NAME, type: 'solid', name: 'Slide Test', color: [1, 0.5, 0], size: [150, 150]
      });
      assertNoError(slideLayer);
      const sli = 1;

      // Read current position before recipe
      const before = await send('getLayerProperty', {
        compName: COMP_NAME, layerIndex: sli, propertyPath: ['Transform', 'Position']
      });
      assertNoError(before);
      const baseX = Array.isArray(before.value) ? +before.value[0] : +before.value;

      const r = await send('applyMotionRecipe', {
        compName: COMP_NAME, layerIndices: [sli],
        recipe: 'slideIn', startTime: 0, duration: 0.5,
        from: [-500, 0, 0], overwriteKeyframes: true
      });
      assertNoError(r);

      // Read back the first Position keyframe (the "from" position) — should be baseX - 500
      const kf = await send('getLayerKeyframes', {
        compName: COMP_NAME, layerIndex: sli, propertyName: 'Position'
      });
      assertNoError(kf);
      if (kf.count < 2) throw new Error(`expected ≥2 Position keyframes, got ${kf.count}`);
      const startKfX = Array.isArray(kf.keyframes[0].value) ? +kf.keyframes[0].value[0] : +kf.keyframes[0].value;
      const expectedStartX = baseX - 500;
      if (Math.abs(startKfX - expectedStartX) > 1) {
        throw new Error(`expected start keyframe X≈${expectedStartX}, got ${startKfX}`);
      }
      return `start X=${startKfX.toFixed(1)}, expected ${expectedStartX.toFixed(1)}`;
    });

    await test('applyMotionRecipe — fadeOut: Opacity goes 100→0', async () => {
      const foLayer = await send('createLayer', {
        compName: COMP_NAME, type: 'solid', name: 'FadeOut Test', color: [0.8, 0.2, 0.2], size: [100, 100]
      });
      assertNoError(foLayer);
      const foi = 1;

      const r = await send('applyMotionRecipe', {
        compName: COMP_NAME, layerIndices: [foi],
        recipe: 'fadeOut', startTime: 0, duration: 0.5, overwriteKeyframes: true
      });
      assertNoError(r);

      const kf = await send('getLayerKeyframes', {
        compName: COMP_NAME, layerIndex: foi, propertyName: 'Opacity'
      });
      assertNoError(kf);
      if (kf.count < 2) throw new Error(`expected ≥2 Opacity keyframes, got ${kf.count}`);
      const startVal = +kf.keyframes[0].value;
      const endVal   = +kf.keyframes[kf.count - 1].value;
      if (Math.abs(startVal - 100) > 0.5) throw new Error(`expected first Opacity≈100, got ${startVal}`);
      if (Math.abs(endVal)         > 0.5) throw new Error(`expected last Opacity≈0, got ${endVal}`);
      return `Opacity: ${startVal}→${endVal}`;
    });

    await test('applyMotionRecipe — unknown recipe returns INVALID_ARGS', async () => {
      const r = await send('applyMotionRecipe', {
        compName: COMP_NAME, layerIndices: [recipeLayerIdx], recipe: 'doesNotExist'
      });
      assertStructuredError(r, 'INVALID_ARGS');
    });

    await test('applyMotionRecipe — empty layerIndices returns INVALID_ARGS', async () => {
      const r = await send('applyMotionRecipe', {
        compName: COMP_NAME, layerIndices: [], recipe: 'fadeIn'
      });
      assertStructuredError(r, 'INVALID_ARGS');
    });

    // ── Full-variant coverage (the glow class): exercise EVERY enumerable value + read it back ──
    // A wrong AE constant / expression / property name in an untested variant is exactly how the
    // glow bug shipped. Each variant is applied and then VERIFIED by reading state back.

    // Every setLayerExpression preset — assert the generated expression text (distinctive per preset;
    // the three bounce presets differ only by their freq/decay defaults, so assert those).
    const PRESET_TOKENS = {
      INERTIAL_BOUNCE: 'var freq=2.5', ELASTIC: 'var freq=4', OVERSHOOT: 'var freq=1.5',
      WIGGLE: 'wiggle(3,25)', AUTO_FADE: 'var fadeIn=0.5',
      LOOP_OUT: 'loopOut("cycle")', LOOP_IN: 'loopIn("cycle")', LOOP_PINGPONG: 'loopOut("pingpong")',
    };
    await test('setLayerExpression — probe layer for preset coverage', async () => {
      const lr = await send('createLayer', { compName: COMP_NAME, type: 'solid', name: 'ExprPresetProbe', color: [0.3, 0.3, 0.3] });
      assertNoError(lr);
      return 'probe at index 1';
    });
    for (const [preset, token] of Object.entries(PRESET_TOKENS)) {
      await test(`setLayerExpression preset ${preset} — generates the right expression`, async () => {
        const r = await send('setLayerExpression', { compName: COMP_NAME, layerIndex: 1, propertyName: 'Opacity', preset });
        assertNoError(r);
        const rb = await send('getLayerExpressions', { compName: COMP_NAME, layerIndex: 1 });
        assertNoError(rb);
        const hit = rb.expressions.find(e => e.expression && e.expression.indexOf(token) !== -1);
        if (!hit) throw new Error(`${preset}: expected expression containing "${token}", got ${JSON.stringify(rb.expressions)}`);
        return token;
      });
    }

    // Every applyMotionRecipe recipe — fresh layer each, read back the keyframes/expression it creates.
    const RECIPES = {
      popIn: { prop: 'Scale', kind: 'kf' }, popOut: { prop: 'Scale', kind: 'kf' },
      fadeIn: { prop: 'Opacity', kind: 'kf' }, fadeOut: { prop: 'Opacity', kind: 'kf' },
      slideIn: { prop: 'Position', kind: 'kf' }, slideOut: { prop: 'Position', kind: 'kf' },
      scaleIn: { prop: 'Scale', kind: 'kf' }, bounceIn: { prop: 'Scale', kind: 'kf' },
      wiggle: { prop: 'Position', kind: 'expr', token: 'wiggle(' },
    };
    for (const [recipe, spec] of Object.entries(RECIPES)) {
      await test(`applyMotionRecipe ${recipe} — animates ${spec.prop} (verified)`, async () => {
        const lr = await send('createLayer', { compName: COMP_NAME, type: 'solid', name: `Recipe_${recipe}`, color: [0.2, 0.2, 0.2] });
        assertNoError(lr);
        const r = await send('applyMotionRecipe', { compName: COMP_NAME, layerIndices: [1], recipe });
        assertNoError(r);
        if (spec.kind === 'kf') {
          const kf = await send('getLayerKeyframes', { compName: COMP_NAME, layerIndex: 1, propertyName: spec.prop });
          assertNoError(kf);
          if (kf.count < 2) throw new Error(`${recipe}: expected ≥2 ${spec.prop} keyframes, got ${kf.count}`);
          return `${kf.count} ${spec.prop} keys`;
        }
        const ex = await send('getLayerExpressions', { compName: COMP_NAME, layerIndex: 1 });
        assertNoError(ex);
        const hit = ex.expressions.find(e => e.expression && e.expression.indexOf(spec.token) !== -1);
        if (!hit) throw new Error(`${recipe}: expected a ${spec.prop} expression containing "${spec.token}"`);
        return spec.token;
      });
    }

    // Every setKeyframeEasing easeType — read back the interpolation labels on the middle keyframe.
    const EASE_EXPECT = {
      easyEase: ['bezier', 'bezier'], easeIn: ['bezier', 'linear'], easeOut: ['linear', 'bezier'],
      linear: ['linear', 'linear'], hold: ['hold', 'hold'], bezier: ['bezier', 'bezier'],
    };
    await test('setKeyframeEasing — probe layer with 3 Position keyframes', async () => {
      const lr = await send('createLayer', { compName: COMP_NAME, type: 'solid', name: 'EaseProbe', color: [0.4, 0.4, 0.4] });
      assertNoError(lr);
      for (const [t, v] of [[0, [100, 100]], [1, [300, 300]], [2, [500, 200]]]) {
        const k = await send('setLayerKeyframe', { compName: COMP_NAME, layerIndex: 1, propertyName: 'Position', value: v, timeInSeconds: t });
        assertNoError(k);
      }
      return '3 keyframes';
    });
    for (const [easeType, [expIn, expOut]] of Object.entries(EASE_EXPECT)) {
      await test(`setKeyframeEasing ${easeType} — in=${expIn} out=${expOut} (verified)`, async () => {
        const r = await send('setKeyframeEasing', { compName: COMP_NAME, layerIndex: 1, propertyName: 'Position', keyIndices: [1, 2, 3], easeType });
        assertNoError(r);
        const kf = await send('getLayerKeyframes', { compName: COMP_NAME, layerIndex: 1, propertyName: 'Position' });
        assertNoError(kf);
        const mid = kf.keyframes[1]; // middle key has real in + out tangents
        if (mid.inInterpolationLabel !== expIn || mid.outInterpolationLabel !== expOut) {
          throw new Error(`${easeType}: expected in=${expIn}/out=${expOut}, got in=${mid.inInterpolationLabel}/out=${mid.outInterpolationLabel}`);
        }
        return `in=${mid.inInterpolationLabel} out=${mid.outInterpolationLabel}`;
      });
    }
  }
}
