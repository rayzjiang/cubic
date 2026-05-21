// context-live.mjs — manual smoke test for the full AE context pipeline
//
// Requires: After Effects open + MCP Bridge CEP panel connected
// Run: npm run test:live   (or: node tests/context-live.mjs)

import { buildContext, formatStateForPrompt, mcpClient } from '../build/index.js';

// ─── Minimal test harness ─────────────────────────────────────────────────────

const green  = s => `\x1b[32m${s}\x1b[0m`;
const red    = s => `\x1b[31m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const bold   = s => `\x1b[1m${s}\x1b[0m`;
const dim    = s => `\x1b[2m${s}\x1b[0m`;

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

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertContains(str, substr, label = '') {
  if (!str.includes(substr))
    throw new Error(`${label ? label + ': ' : ''}expected to contain "${substr}"\nGot: ${str.slice(0, 300)}`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

console.log(bold('\nContext Live (requires AE + MCP panel)\n'));

await test('buildContext() returns without throwing', async () => {
  const state = await buildContext();
  assert(typeof state === 'object' && state !== null, 'state must be an object');
  assert('selectedLayers' in state,         'missing selectedLayers');
  assert('activeComp'     in state,         'missing activeComp');
  assert('playhead'       in state,         'missing playhead');
  assert('project'        in state,         'missing project');
  assert(Array.isArray(state.selectedLayers), 'selectedLayers must be an array');
  if (!state.activeComp && !state.project) return 'no project open — null state as expected';
  return 'populated';
});

await test('activeComp has all required fields when a comp is open', async () => {
  const state = await buildContext();
  if (!state.activeComp) { process.stdout.write(yellow('skipped (no active comp) ')); return 'skipped'; }
  const { name, width, height, fps, duration, numLayers } = state.activeComp;
  assert(typeof name      === 'string' && name.length > 0, `name must be non-empty string`);
  assert(typeof width     === 'number' && width > 0,       `width must be positive number`);
  assert(typeof height    === 'number' && height > 0,      `height must be positive number`);
  assert(typeof fps       === 'number' && fps > 0,         `fps must be positive number`);
  assert(typeof duration  === 'number' && duration > 0,    `duration must be positive number`);
  assert(typeof numLayers === 'number',                    `numLayers must be a number`);
  return `${name} (${width}x${height} @ ${fps}fps)`;
});

await test('playhead is a number when a comp is open', async () => {
  const state = await buildContext();
  if (!state.activeComp) { process.stdout.write(yellow('skipped ')); return 'skipped'; }
  assert(typeof state.playhead === 'number', `playhead must be a number, got ${typeof state.playhead}`);
  return `${state.playhead}s`;
});

await test('selectedLayers entries have required fields', async () => {
  const state = await buildContext();
  if (state.selectedLayers.length === 0) return 'no layers selected — select one in AE to verify shape';
  for (const layer of state.selectedLayers) {
    assert(typeof layer.index   === 'number',  'layer.index must be number');
    assert(typeof layer.name    === 'string',  'layer.name must be string');
    assert(typeof layer.type    === 'string',  'layer.type must be string');
    assert(typeof layer.enabled === 'boolean', 'layer.enabled must be boolean');
  }
  return `${state.selectedLayers.length} layer(s): ${state.selectedLayers.map(l => l.name).join(', ')}`;
});

await test('formatStateForPrompt produces valid XML + JSON from live state', async () => {
  const state = await buildContext();
  const out = formatStateForPrompt(state);
  assertContains(out, '<live_ae_state>',  'missing opening tag');
  assertContains(out, '</live_ae_state>', 'missing closing tag');
  const inner = out.replace('<live_ae_state>', '').replace('</live_ae_state>', '').trim();
  let parsed;
  try { parsed = JSON.parse(inner); }
  catch (e) { throw new Error(`body is not valid JSON: ${e.message}`); }
  assert(typeof parsed === 'object' && parsed !== null, 'body must be an object');
  console.log(dim(`\n\n${out}\n`));
  return 'valid';
});

// ─── Summary ──────────────────────────────────────────────────────────────────

await mcpClient.disconnect();

const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
console.log(`\n${bold('Results:')} ${green(`${passed} passed`)}, ${failed > 0 ? red(`${failed} failed`) : `${failed} failed`}`);
process.exit(failed > 0 ? 1 : 0);
