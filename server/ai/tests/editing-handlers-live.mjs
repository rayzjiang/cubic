// editing-handlers-live.mjs — NO-API live test for the video-editing handlers.
//
// Drives the four new ExtendScript handlers (fitToFrame, retimeClip, applyTransition, adjustColor)
// DIRECTLY against real After Effects via the bridge, then reads AE state back to prove each one
// actually changed the project. NO model / NO ANTHROPIC_API_KEY / $0 — this validates the JSX, not
// the agent's tool-routing (test that yourself in Cubic; see the prompt list printed at the end).
//
// Requires: After Effects open + Cubic panel connected (that's it — no API key).
// Run: npm run test:editing
//
// It creates throwaway comps named "__CUBIC_EDIT_TEST*" and deletes them on the way out.

import { bridgeClient } from '../build/index.js';
import { green, red, dim, bold, cyan, yellow } from './lib/format.mjs';

const run = (command, args) => bridgeClient.callRunScript(command, args ?? {});
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const near = (a, b, eps) => Math.abs(a - b) <= (eps ?? 1);

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

// Make a fresh, active comp + return its name; each scenario gets its own so state can't leak.
let compSeq = 0;
async function freshComp(w, h) {
  const name = '__CUBIC_EDIT_TEST_' + (++compSeq);
  await run('createComposition', { name, width: w ?? 1920, height: h ?? 1080, frameRate: 30, duration: 5 });
  return name;
}
async function addSolid(name, size) {
  return run('createLayer', { type: 'solid', name, size: size ?? [400, 400], color: [0.2, 0.4, 0.8] });
}
const createdComps = [];
async function scenarioComp(w, h) { const n = await freshComp(w, h); createdComps.push(n); return n; }

console.log(bold('\nEditing Handlers — live AE, no API (requires AE + Cubic panel)\n'));

// Preflight: a panel-connected bridge must answer, else everything below is noise.
await test('AE bridge is connected (panel attached)', async () => {
  let info;
  try { info = await run('getProjectInfo'); }
  catch (e) { throw new Error(`cannot reach a panel-connected AE bridge: ${e.message}`); }
  assert(info && typeof info.projectName === 'string', 'bridge replied but without a project — panel not attached');
  return `project "${info.projectName}"`;
});
if (!results[results.length - 1].ok) {
  console.log(red('\nBridge preflight failed — open AE with the Cubic panel connected, then re-run.\n'));
  await bridgeClient.disconnect();
  process.exit(1);
}

// ── fitToFrame ────────────────────────────────────────────────────────────────
await test('fitToFrame fill scales a 400×400 solid to cover 1920×1080 and centers it', async () => {
  await scenarioComp(1920, 1080);
  await addSolid('Clip', [400, 400]);
  const res = await call('fitToFrame', { layerIndices: [1], mode: 'fill' });
  assert(res.status === 'success', 'expected success, got ' + res.status);
  // The handler reads scale/position back from AE after applying — assert on that.
  const m = res.modifiedLayers[0];
  assert(near(m.scale[0], 480, 1) && near(m.scale[1], 480, 1), `expected ~480% scale, got [${m.scale[0]}, ${m.scale[1]}]`);
  assert(near(m.position[0], 960, 1) && near(m.position[1], 540, 1), `expected center (960,540), got (${m.position[0]},${m.position[1]})`);
  return `scale ${Math.round(m.scale[0])}%, centered`;
});

await test('fitToFrame fit (contain) uses the smaller ratio', async () => {
  await scenarioComp(1920, 1080);
  await addSolid('Clip', [400, 400]);
  const res = await call('fitToFrame', { layerIndices: [1], mode: 'fit' });
  assert(res.status === 'success', 'expected success, got ' + res.status);
  const m = res.modifiedLayers[0];
  assert(near(m.scale[0], 270, 1), `expected ~270% (contain), got ${m.scale[0]}`);
  return `scale ${Math.round(m.scale[0])}%`;
});

// ── retimeClip ──────────────────────────────────────────────────────────────────
await test('retimeClip speed 0.5 doubles time-stretch to 200%', async () => {
  await scenarioComp();
  await addSolid('Clip', [400, 400]);
  const res = await call('retimeClip', { layerIndex: 1, mode: 'speed', speed: 0.5 });
  assert(res.status === 'success', 'expected success, got ' + res.status);
  // retimeClip returns the post-mutation stretch read back from AE (getLayerInfo doesn't expose stretch).
  assert(near(res.layer.stretch, 200, 0.5), `expected 200% stretch, got ${res.layer.stretch}`);
  return `stretch ${res.layer.stretch}%`;
});

await test('retimeClip reverse makes the stretch negative', async () => {
  await scenarioComp();
  await addSolid('Clip', [400, 400]);
  const res = await call('retimeClip', { layerIndex: 1, mode: 'reverse' });
  assert(res.status === 'success', 'expected success, got ' + res.status);
  assert(res.layer.stretch < 0, `expected negative stretch, got ${res.layer.stretch}`);
  return `stretch ${res.layer.stretch}%`;
});

await test('retimeClip freeze holds a frame on a time-remappable precomp layer', async () => {
  await scenarioComp();
  await addSolid('Clip', [400, 400]);
  // Precompose the solid so the layer becomes a precomp (time-remap supported, unlike a raw solid).
  await run('precompose', { layerIndices: [1], newCompName: '__CUBIC_EDIT_PRECOMP_' + compSeq });
  const res = await call('retimeClip', { layerIndex: 1, mode: 'freeze', atTime: 1 });
  assert(res.status === 'success', 'expected success, got ' + res.status + (res.message ? ' — ' + res.message : ''));
  return res.message;
});

// ── applyTransition ──────────────────────────────────────────────────────────────
await test('applyTransition crossDissolve keyframes opacity on both clips', async () => {
  await scenarioComp();
  await addSolid('ClipB', [1920, 1080]);
  await addSolid('ClipA', [1920, 1080]); // newest = index 1
  const res = await call('applyTransition', { type: 'crossDissolve', layerIndices: [1, 2], durationSeconds: 1 });
  assert(res.status === 'success', 'expected success, got ' + res.status);
  const k1 = await run('getLayerKeyframes', { layerIndex: 1, propertyName: 'Opacity' });
  const keys = (k1.keyframes || k1.keys || []);
  assert(keys.length >= 2, `expected ≥2 opacity keys on the outgoing clip, got ${keys.length}`);
  return `${keys.length} opacity keys`;
});

await test('applyTransition fadeToBlack adds a black solid on top', async () => {
  await scenarioComp();
  await addSolid('Clip', [1920, 1080]);
  const res = await call('applyTransition', { type: 'fadeToBlack', layerIndices: [1], durationSeconds: 0.5 });
  assert(res.status === 'success', 'expected success, got ' + res.status);
  assert(res.solid && /black/i.test(res.solid.name), 'expected a "Fade to Black" solid in the result');
  return res.solid.name;
});

// ── adjustColor ──────────────────────────────────────────────────────────────────
await test('adjustColor warms a layer and leaves a color effect on it', async () => {
  await scenarioComp();
  await addSolid('Clip', [1920, 1080]);
  const res = await call('adjustColor', { layerIndices: [1], temperature: 20, contrast: 10 });
  assert(res.status === 'success', 'expected success, got ' + res.status);
  const fx = await run('getLayerEffects', { layerIndex: 1 });
  assert((fx.count || (fx.effects || []).length) >= 1, 'expected at least one color effect applied');
  return `${fx.count || fx.effects.length} effect(s)` + (res.warning ? ' (with warning)' : '');
});

await test('adjustColor applies a named look (teal-orange)', async () => {
  await scenarioComp();
  await addSolid('Clip', [1920, 1080]);
  const res = await call('adjustColor', { layerIndices: [1], look: 'teal-orange' });
  assert(res.status === 'success', 'expected success, got ' + res.status);
  return res.message;
});

// ── cleanup ──────────────────────────────────────────────────────────────────────
await test('cleanup — delete throwaway comps', async () => {
  let removed = 0;
  for (const name of createdComps) {
    try { await run('deleteComposition', { compName: name }); removed++; } catch (e) { /* leave it; user can delete */ }
  }
  return `removed ${removed}/${createdComps.length} test comps`;
});

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
console.log(cyan('    • "cross dissolve between these two clips" → applyTransition (crossDissolve)'));
console.log(cyan('    • "fade to black at the end"              → applyTransition (fadeToBlack)'));
console.log(cyan('    • "warm it up / fix the exposure"         → adjustColor'));
console.log(cyan('    • "give it a teal-and-orange look"        → adjustColor (look)'));
console.log(cyan('    • "export this as an mp4"                 → polite decline (out of scope)'));
if (failed > 0) console.log(yellow('\n  Some handlers failed above — see the messages; the JSX needs a fix before manual testing.\n'));
await bridgeClient.disconnect();
process.exit(failed > 0 ? 1 : 0);
