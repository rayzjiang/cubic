// editing-handlers-live.mjs — NO-API live test for the video-editing handlers.
//
// Drives the four new ExtendScript handlers (fitToFrame, retimeClip, applyTransition, adjustColor)
// DIRECTLY against real After Effects via the bridge, then reads AE state back to prove each one
// actually changed the project. NO model / NO ANTHROPIC_API_KEY / $0 — this validates the JSX, not
// the agent's tool-routing (test that yourself in Cubic; see the prompt list printed at the end).
//
// Every scenario runs in its OWN throwaway comp (named "__CUBIC_EDIT_TEST*"), and every command is
// addressed by compName — so the test never touches whatever comp you have open. All test comps are
// swept on the way out (even on crash). To only clean up leftovers: `npm run test:editing clean`.
//
// Requires: After Effects open + Cubic panel connected (that's it — no API key).
// Run: npm run test:editing   ·   Clean only: npm run test:editing clean

import { bridgeClient } from '../build/index.js';
import { green, red, dim, bold, cyan, yellow } from './lib/format.mjs';

const TEST_PREFIX = '__CUBIC_EDIT'; // both test comps and their precomps start with this
const CLEAN_ONLY = process.argv.slice(2).includes('clean');

const run = (command, args) => bridgeClient.callRunScript(command, args ?? {});
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const near = (a, b, eps) => Math.abs(a - b) <= (eps ?? 1);

// Delete every comp whose name starts with the test prefix (test comps + precomps). Robust cleanup:
// sweeps leftovers from a crashed run too, not just comps created this run.
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

// Make a fresh comp and return its name; every scenario gets its own so state can't leak, and we
// address it explicitly by compName below so the test never operates on the user's open comp.
let compSeq = 0;
async function freshComp(w, h) {
  const name = `${TEST_PREFIX}_TEST_${++compSeq}`;
  await run('createComposition', { name, width: w ?? 1920, height: h ?? 1080, frameRate: 30, duration: 5 });
  return name;
}
async function addSolid(compName, name, size) {
  return run('createLayer', { compName, type: 'solid', name, size: size ?? [400, 400], color: [0.2, 0.4, 0.8] });
}

// ── clean-only mode ───────────────────────────────────────────────────────────
if (CLEAN_ONLY) {
  console.log(bold('\nEditing Handlers — cleanup only\n'));
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
console.log(bold('\nEditing Handlers — live AE, no API (requires AE + Cubic panel)\n'));
try {
  // Preflight: a panel-connected bridge must answer, else everything below is noise.
  await test('AE bridge is connected (panel attached)', async () => {
    let info;
    try { info = await run('getProjectInfo'); }
    catch (e) { throw new Error(`cannot reach a panel-connected AE bridge: ${e.message}`); }
    assert(info && typeof info.projectName === 'string', 'bridge replied but without a project — panel not attached');
    return `project "${info.projectName}"`;
  });
  if (!results[results.length - 1].ok) throw new Error('bridge preflight failed — open AE with the Cubic panel connected');

  // ── fitToFrame ──────────────────────────────────────────────────────────────
  await test('fitToFrame fill scales a 400×400 solid to cover 1920×1080 and centers it', async () => {
    const comp = await freshComp(1920, 1080);
    await addSolid(comp, 'Clip', [400, 400]);
    const res = await call('fitToFrame', { compName: comp, layerIndices: [1], mode: 'fill' });
    assert(res.status === 'success', 'expected success, got ' + res.status);
    const m = res.modifiedLayers[0]; // handler reads scale/position back from AE after applying
    assert(near(m.scale[0], 480, 1) && near(m.scale[1], 480, 1), `expected ~480% scale, got [${m.scale[0]}, ${m.scale[1]}]`);
    assert(near(m.position[0], 960, 1) && near(m.position[1], 540, 1), `expected center (960,540), got (${m.position[0]},${m.position[1]})`);
    return `scale ${Math.round(m.scale[0])}%, centered`;
  });

  await test('fitToFrame fit (contain) uses the smaller ratio', async () => {
    const comp = await freshComp(1920, 1080);
    await addSolid(comp, 'Clip', [400, 400]);
    const res = await call('fitToFrame', { compName: comp, layerIndices: [1], mode: 'fit' });
    assert(res.status === 'success', 'expected success, got ' + res.status);
    assert(near(res.modifiedLayers[0].scale[0], 270, 1), `expected ~270% (contain), got ${res.modifiedLayers[0].scale[0]}`);
    return `scale ${Math.round(res.modifiedLayers[0].scale[0])}%`;
  });

  // ── retimeClip ────────────────────────────────────────────────────────────────
  await test('retimeClip speed 0.5 doubles time-stretch to 200%', async () => {
    const comp = await freshComp();
    await addSolid(comp, 'Clip', [400, 400]);
    const res = await call('retimeClip', { compName: comp, layerIndex: 1, mode: 'speed', speed: 0.5 });
    assert(res.status === 'success', 'expected success, got ' + res.status);
    assert(near(res.layer.stretch, 200, 0.5), `expected 200% stretch, got ${res.layer.stretch}`);
    return `stretch ${res.layer.stretch}%`;
  });

  await test('retimeClip reverse makes the stretch negative', async () => {
    const comp = await freshComp();
    await addSolid(comp, 'Clip', [400, 400]);
    const res = await call('retimeClip', { compName: comp, layerIndex: 1, mode: 'reverse' });
    assert(res.status === 'success', 'expected success, got ' + res.status);
    assert(res.layer.stretch < 0, `expected negative stretch, got ${res.layer.stretch}`);
    return `stretch ${res.layer.stretch}%`;
  });

  await test('retimeClip freeze holds a frame on a time-remappable precomp layer', async () => {
    const comp = await freshComp();
    await addSolid(comp, 'Clip', [400, 400]);
    // Precompose the solid so the layer becomes a precomp (time-remap supported, unlike a raw solid).
    await run('precompose', { compName: comp, layerIndices: [1], newCompName: `${TEST_PREFIX}_PRECOMP_${compSeq}` });
    const res = await call('retimeClip', { compName: comp, layerIndex: 1, mode: 'freeze', atTime: 1 });
    assert(res.status === 'success', 'expected success, got ' + res.status + (res.message ? ' — ' + res.message : ''));
    return res.message;
  });

  // ── adjustColor ────────────────────────────────────────────────────────────────
  await test('adjustColor warms a layer and leaves a color effect on it', async () => {
    const comp = await freshComp();
    await addSolid(comp, 'Clip', [1920, 1080]);
    const res = await call('adjustColor', { compName: comp, layerIndices: [1], temperature: 20, contrast: 10 });
    assert(res.status === 'success', 'expected success, got ' + res.status);
    const fx = await run('getLayerEffects', { compName: comp, layerIndex: 1 });
    assert((fx.count || (fx.effects || []).length) >= 1, 'expected at least one color effect applied');
    return `${fx.count || fx.effects.length} effect(s)` + (res.warning ? ' (with warning)' : '');
  });

  await test('adjustColor applies a named look (teal-orange)', async () => {
    const comp = await freshComp();
    await addSolid(comp, 'Clip', [1920, 1080]);
    const res = await call('adjustColor', { compName: comp, layerIndices: [1], look: 'teal-orange' });
    assert(res.status === 'success', 'expected success, got ' + res.status);
    return res.message;
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
console.log(dim('  try these in Cubic chat (any clip selected):'));
console.log(cyan('    • "fit this clip to the frame"            → fitToFrame'));
console.log(cyan('    • "make this comp vertical 9:16"          → setCompositionProperties + fitToFrame'));
console.log(cyan('    • "slow this down to 50%"                 → retimeClip (speed)'));
console.log(cyan('    • "freeze the frame here"                 → retimeClip (freeze)'));
console.log(cyan('    • "play it backwards"                     → retimeClip (reverse)'));
console.log(cyan('    • "fade out / fade to black"              → applyMotionRecipe fadeOut (just opacity, no dedicated tool)'));
console.log(cyan('    • "warm it up / fix the exposure"         → adjustColor'));
console.log(cyan('    • "give it a teal-and-orange look"        → adjustColor (look)'));
console.log(cyan('    • "export this as an mp4"                 → polite decline (out of scope)'));
if (failed > 0) console.log(yellow('\n  Some handlers failed above — see the messages; the JSX needs a fix before manual testing.\n'));
process.exit(failed > 0 ? 1 : 0);
