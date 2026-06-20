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
