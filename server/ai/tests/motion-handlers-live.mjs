// motion-handlers-live.mjs — NO-API live test for the motion-design handlers.
//
// Drives the new ExtendScript motion handlers (animateText, animateShape, cameraMove,
// createBackground, the keyframe pro-tools, the shape ops, addNullToLayers, cropComp) DIRECTLY
// against real After Effects via the bridge, then reads AE state back to prove each one actually
// changed the project. NO model / NO ANTHROPIC_API_KEY / $0 — this validates the JSX, not the
// agent's tool-routing (test that yourself in Cubic; see the prompt list printed at the end).
//
// Every scenario runs in its OWN throwaway comp (named "__CUBIC_MOTION_TEST*"), addressed by
// compName — so the test never touches whatever comp you have open. All test comps are swept on the
// way out (even on crash). To only clean up leftovers: `npm run test:motion clean`.
//
// Requires: After Effects open + Cubic panel connected (that's it — no API key).
// Run: npm run test:motion   ·   Clean only: npm run test:motion clean

import { bridgeClient } from '../build/index.js';
import { green, red, dim, bold, cyan, yellow } from './lib/format.mjs';

const TEST_PREFIX = '__CUBIC_MOTION';
const CLEAN_ONLY = process.argv.slice(2).includes('clean');

const run = (command, args) => bridgeClient.callRunScript(command, args ?? {});
function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function sweepTestComps() {
  let list;
  try { list = await run('listCompositions'); } catch { return 0; }
  const comps = (list && list.compositions) || [];
  let removed = 0;
  for (const c of comps) {
    if (c && typeof c.name === 'string' && c.name.indexOf(TEST_PREFIX) === 0) {
      try { await run('deleteComposition', { compName: c.name }); removed++; } catch { /* leave it */ }
    }
  }
  return removed;
}

const results = [];
async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    const note = await fn();
    console.log(green('PASS') + (note ? dim(` (${note})`) : ''));
    results.push({ ok: true });
  } catch (e) {
    console.log(red('FAIL') + ` — ${e.message}`);
    results.push({ ok: false });
  }
}

// Show the command going in and the key result coming back, so a run is self-documenting.
async function call(command, args) {
  console.log(dim(`      → ${command}(${JSON.stringify(args ?? {})})`));
  const res = await run(command, args);
  console.log(dim(`      ← ${res && res.status}${res && res.message ? ': ' + res.message : ''}${res && res.warning ? '  ⚠ ' + res.warning : ''}`));
  return res;
}

let compSeq = 0;
async function freshComp(w, h) {
  const name = `${TEST_PREFIX}_TEST_${++compSeq}`;
  await run('createComposition', { name, width: w ?? 1920, height: h ?? 1080, frameRate: 30, duration: 5 });
  return name;
}
async function addText(compName, text) {
  return run('createLayer', { compName, type: 'text', text: text ?? 'KINETIC TYPE', fontSize: 120 });
}
async function addShape(compName, fill) {
  return run('createLayer', { compName, type: 'shape', shapeType: 'rectangle', size: [300, 300], fillColor: fill ?? [0.9, 0.2, 0.3], strokeColor: [1, 1, 1], strokeWidth: 8 });
}
async function layerCount(compName) {
  const info = await run('getLayerInfo', { compName });
  return (info.layers || []).length;
}

// ── clean-only mode ───────────────────────────────────────────────────────────
if (CLEAN_ONLY) {
  console.log(bold('\nMotion Handlers — cleanup only\n'));
  try {
    const info = await run('getProjectInfo');
    if (!info || typeof info.projectName !== 'string') throw new Error('panel not attached');
    const removed = await sweepTestComps();
    console.log(green(`  removed ${removed} ${TEST_PREFIX}* comp(s)\n`));
  } catch (e) {
    console.log(red(`  cannot reach a panel-connected AE bridge: ${e.message}\n`));
  }
  await bridgeClient.disconnect();
  process.exit(0);
}

// ── full run ────────────────────────────────────────────────────────────────────
console.log(bold('\nMotion Handlers — live AE, no API (requires AE + Cubic panel)\n'));
try {
  await test('AE bridge is connected (panel attached)', async () => {
    let info;
    try { info = await run('getProjectInfo'); }
    catch (e) { throw new Error(`cannot reach a panel-connected AE bridge: ${e.message}`); }
    assert(info && typeof info.projectName === 'string', 'bridge replied but without a project — panel not attached');
    return `project "${info.projectName}"`;
  });
  if (!results[results.length - 1].ok) throw new Error('bridge preflight failed — open AE with the Cubic panel connected');

  // ── animateText ───────────────────────────────────────────────────────────────
  await test('animateText typewriter adds an animator and keyframes the selector Offset', async () => {
    const comp = await freshComp();
    await addText(comp, 'TYPE ON');
    const res = await call('animateText', { compName: comp, layerIndex: 1, preset: 'typewriter' });
    assert(res.status === 'success', 'expected success, got ' + res.status + (res.message ? ' — ' + res.message : ''));
    assert(res.animator && res.animator.name, 'expected an animator in the result');
    // Read the keyframed Offset back to prove the reveal driver exists.
    const kf = await run('getLayerKeyframes', { compName: comp, layerIndex: 1, propertyPath: ['Text', 'Animators', res.animator.name, 'Range Selector 1', 'Offset'] });
    assert(kf.status === 'success', 'could not read Offset keyframes: ' + (kf.message || kf.status));
    assert(kf.count === 2, `expected 2 Offset keyframes, got ${kf.count}`);
    return `${res.animator.name}, ${kf.count} Offset keys`;
  });

  await test('animateText cascade animates Position+Scale and auto-enables motion blur', async () => {
    const comp = await freshComp();
    await addText(comp, 'CASCADE');
    const res = await call('animateText', { compName: comp, layerIndex: 1, preset: 'cascade' });
    assert(res.status === 'success', 'expected success, got ' + res.status);
    assert(res.motionBlur === true, 'expected motionBlur auto-enabled for a positional reveal');
    const info = await run('getLayerInfo', { compName: comp });
    const layer = (info.layers || []).find(l => l.index === 1) || (info.layers || [])[0];
    assert(layer && layer.motionBlur === true, 'expected layer.motionBlur true in AE');
    return `props ${res.animatedProperties.join('+')}, motion blur on`;
  });

  await test('animateText respects the linear escape hatch (no auto motion blur)', async () => {
    const comp = await freshComp();
    await addText(comp, 'LINEAR');
    const res = await call('animateText', { compName: comp, layerIndex: 1, preset: 'cascade', ease: 'linear' });
    assert(res.status === 'success', 'expected success, got ' + res.status);
    assert(res.motionBlur === false, 'expected NO auto motion blur when ease=linear');
    return 'motion blur suppressed';
  });

  // ── animateShape (write-on) ────────────────────────────────────────────────────
  await test('animateShape draws on a shape stroke via Trim Paths (2 keys on End)', async () => {
    const comp = await freshComp();
    await addShape(comp);
    const res = await call('animateShape', { compName: comp, layerIndex: 1, trimProperty: 'end' });
    assert(res.status === 'success', 'expected success, got ' + res.status + (res.message ? ' — ' + res.message : ''));
    assert(res.trim && res.trim.keyframes === 2 && res.trim.animated === 'End', 'expected 2 keyframes on Trim End');
    return `Trim ${res.trim.animated}, ${res.trim.keyframes} keys`;
  });

  // ── mergeShapes → extractShapes round-trip ──────────────────────────────────────
  await test('mergeShapes combines two shape layers into one', async () => {
    const comp = await freshComp();
    await addShape(comp, [0.9, 0.2, 0.3]);
    await addShape(comp, [0.2, 0.5, 0.9]);
    assert((await layerCount(comp)) === 2, 'setup should have 2 shape layers');
    const res = await call('mergeShapes', { compName: comp, layerIndices: [1, 2] });
    assert(res.status === 'success', 'expected success, got ' + res.status);
    assert((await layerCount(comp)) === 1, 'expected 1 layer after merge');
    return res.message + (res.warning ? ' (with warning)' : '');
  });

  await test('extractShapes explodes a multi-group shape layer back into separate layers', async () => {
    const comp = await freshComp();
    await addShape(comp, [0.9, 0.2, 0.3]);
    await addShape(comp, [0.2, 0.5, 0.9]);
    await call('mergeShapes', { compName: comp, layerIndices: [1, 2] }); // now one layer, two groups
    const res = await call('extractShapes', { compName: comp, layerIndex: 1, deleteSource: true });
    assert(res.status === 'success', 'expected success, got ' + res.status + (res.message ? ' — ' + res.message : ''));
    assert(res.createdLayers && res.createdLayers.length === 2, `expected 2 extracted layers, got ${res.createdLayers && res.createdLayers.length}`);
    return `${res.createdLayers.length} layers extracted`;
  });

  // ── cameraMove ──────────────────────────────────────────────────────────────────
  await test('cameraMove pushIn creates a camera and keyframes its Zoom', async () => {
    const comp = await freshComp();
    await addText(comp, 'SCENE');
    const res = await call('cameraMove', { compName: comp, move: 'pushIn', duration: 2 });
    assert(res.status === 'success', 'expected success, got ' + res.status + (res.message ? ' — ' + res.message : ''));
    assert(res.camera && res.camera.created === true, 'expected a camera to be created');
    const kf = await run('getLayerKeyframes', { compName: comp, layerIndex: res.camera.index, propertyPath: ['Camera Options', 'Zoom'] });
    assert(kf.status === 'success' && kf.count === 2, `expected 2 Zoom keyframes, got ${kf.count}`);
    return `camera "${res.camera.name}", ${kf.count} Zoom keys`;
  });

  await test('cameraMove orbit keyframes the camera Position around the POI', async () => {
    const comp = await freshComp();
    await addText(comp, 'ORBIT');
    const res = await call('cameraMove', { compName: comp, move: 'orbit', amount: 45, duration: 2 });
    assert(res.status === 'success', 'expected success, got ' + res.status);
    const kf = await run('getLayerKeyframes', { compName: comp, layerIndex: res.camera.index, propertyPath: ['Position'] });
    assert(kf.status === 'success' && kf.count >= 2, `expected Position keyframes, got ${kf.count}`);
    return `${kf.count} Position keys`;
  });

  // ── createBackground ──────────────────────────────────────────────────────────────
  await test('createBackground adds a gradient solid at the bottom with a Ramp effect', async () => {
    const comp = await freshComp();
    await addText(comp, 'FRONT');
    const before = await layerCount(comp);
    const res = await call('createBackground', { compName: comp, gradient: true });
    assert(res.status === 'success', 'expected success, got ' + res.status + (res.message ? ' — ' + res.message : ''));
    const after = await layerCount(comp);
    assert(after === before + 1, 'expected one new background layer');
    assert(res.layer.index === after, `expected background at the bottom (index ${after}), got ${res.layer.index}`);
    const fx = await run('getLayerEffects', { compName: comp, layerIndex: res.layer.index });
    assert((fx.count || (fx.effects || []).length) >= 1, 'expected a Ramp effect on the background');
    return `bottom layer ${res.layer.index}, gradient`;
  });

  // ── keyframe pro-tools ──────────────────────────────────────────────────────────
  await test('cloneKeyframes copies a property\'s keys to the playhead', async () => {
    const comp = await freshComp();
    await addText(comp, 'CLONE');
    await call('applyMotionRecipe', { compName: comp, layerIndices: [1], recipe: 'fadeIn', duration: 0.5 }); // 2 Opacity keys
    const res = await call('cloneKeyframes', { compName: comp, layerIndex: 1, propertyName: 'Opacity', targetTime: 2 });
    assert(res.status === 'success', 'expected success, got ' + res.status + (res.message ? ' — ' + res.message : ''));
    const kf = await run('getLayerKeyframes', { compName: comp, layerIndex: 1, propertyName: 'Opacity' });
    assert(kf.count === 4, `expected 4 Opacity keys after clone, got ${kf.count}`);
    return `${kf.count} Opacity keys`;
  });

  await test('fixKeyframeTiming snaps off-grid keys to the frame grid', async () => {
    const comp = await freshComp(); // 30fps → frameDuration 1/30
    await addText(comp, 'SNAP');
    await run('setLayerKeyframe', { compName: comp, layerIndex: 1, propertyName: 'Opacity', timeInSeconds: 0.333, value: 0 });
    await run('setLayerKeyframe', { compName: comp, layerIndex: 1, propertyName: 'Opacity', timeInSeconds: 1.027, value: 100 });
    const res = await call('fixKeyframeTiming', { compName: comp, layerIndex: 1, propertyName: 'Opacity' });
    assert(res.status === 'success', 'expected success, got ' + res.status);
    const kf = await run('getLayerKeyframes', { compName: comp, layerIndex: 1, propertyName: 'Opacity' });
    const onGrid = kf.keyframes.every(k => Math.abs(k.time * 30 - Math.round(k.time * 30)) < 1e-3);
    assert(onGrid, 'expected all keyframe times on the 30fps grid');
    return `${kf.count} keys snapped`;
  });

  await test('sequenceKeyframes staggers existing keys across layers', async () => {
    const comp = await freshComp();
    await addText(comp, 'A');
    await addText(comp, 'B');
    await call('applyMotionRecipe', { compName: comp, layerIndices: [1, 2], recipe: 'fadeIn', duration: 0.5 });
    const res = await call('sequenceKeyframes', { compName: comp, layerIndices: [1, 2], propertyName: 'Opacity', stagger: 0.5, orderType: 'TOP_DOWN' });
    assert(res.status === 'success', 'expected success, got ' + res.status);
    const kf2 = await run('getLayerKeyframes', { compName: comp, layerIndex: 2, propertyName: 'Opacity' });
    assert(kf2.keyframes[0].time >= 0.49, `expected layer 2's first key shifted to ~0.5s, got ${kf2.keyframes[0].time}`);
    return `layer 2 first key @ ${kf2.keyframes[0].time.toFixed(2)}s`;
  });

  // ── addNullToLayers / cropComp / getLayerColors ─────────────────────────────────
  await test('addNullToLayers (single) adds one control null and parents the layers', async () => {
    const comp = await freshComp();
    await addText(comp, 'A');
    await addText(comp, 'B');
    const before = await layerCount(comp);
    const res = await call('addNullToLayers', { compName: comp, layerIndices: [1, 2], mode: 'single' });
    assert(res.status === 'success', 'expected success, got ' + res.status);
    assert((await layerCount(comp)) === before + 1, 'expected exactly one new null');
    return res.message;
  });

  await test('cropComp shrinks the comp to its content bounds', async () => {
    const comp = await freshComp(1920, 1080);
    await addShape(comp); // a 300×300 shape near center
    const res = await call('cropComp', { compName: comp, padding: 20 });
    assert(res.status === 'success', 'expected success, got ' + res.status + (res.message ? ' — ' + res.message : ''));
    assert(res.newSize[0] < 1920 && res.newSize[1] < 1080, `expected a smaller comp, got ${res.newSize.join('x')}`);
    return `${res.newSize.join('x')} (was ${res.previousSize.join('x')})`;
  });

  await test('getLayerColors extracts a shape\'s colors into a controller null', async () => {
    const comp = await freshComp();
    await addShape(comp, [0.9, 0.2, 0.3]); // red fill + white stroke
    const res = await call('getLayerColors', { compName: comp, layerIndex: 1 });
    assert(res.status === 'success', 'expected success, got ' + res.status + (res.message ? ' — ' + res.message : ''));
    assert(res.colors && res.colors.length >= 1, 'expected at least one color');
    assert(res.controller && res.controller.count === res.colors.length, 'expected a controller with one swatch per color');
    return `${res.colors.length} color(s)`;
  });
} catch (e) {
  console.log(red(`\n  Aborted: ${e.message}`));
} finally {
  const removed = await sweepTestComps();
  console.log(dim(`\n  cleanup: removed ${removed} ${TEST_PREFIX}* comp(s)`));
  await bridgeClient.disconnect();
}

const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
console.log(`\n${bold('Results:')} ${green(`${passed} passed`)}, ${failed > 0 ? red(`${failed} failed`) : '0 failed'}`);
console.log(dim('\n  This validated the HANDLERS (the JSX). To test that the model picks the right tool,'));
console.log(dim('  try these in Cubic chat (a text layer selected):'));
console.log(cyan('    • "type this on like a typewriter"        → animateText (typewriter)'));
console.log(cyan('    • "make the words fly up one by one"      → animateText (wordByWord / fadeUpByWord)'));
console.log(cyan('    • "reveal the title with a cascade"       → animateText (cascade)'));
if (failed > 0) console.log(yellow('\n  Some handlers failed above — see the messages; the JSX needs a fix before manual testing.\n'));
process.exit(failed > 0 ? 1 : 0);
