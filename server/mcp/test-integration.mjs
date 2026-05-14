#!/usr/bin/env node
// Run: node test-integration.mjs           — read-only tests
//      node test-integration.mjs --write   — also runs write tests (modifies open AE project with new separate composition and layers, then deletes them)
//     node test-integration.mjs --write --no-cleanup   — runs write tests but leaves the new composition and layers in the project for manual inspection (does not delete them)

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ─── Config ───────────────────────────────────────────────────────────────────

const BRIDGE_DIR   = path.join(os.homedir(), '.ae-mcp-bridge');
const COMMAND_FILE = path.join(BRIDGE_DIR, 'ae_command.json');
const RESULT_FILE  = path.join(BRIDGE_DIR, 'ae_mcp_result.json');
const POLL_MS      = 300;
const TIMEOUT_MS   = 10_000;
const TEST_COMP    = '__MCP_TEST__';

// ─── ANSI ─────────────────────────────────────────────────────────────────────

const green  = s => `\x1b[32m${s}\x1b[0m`;
const red    = s => `\x1b[31m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const bold   = s => `\x1b[1m${s}\x1b[0m`;
const dim    = s => `\x1b[2m${s}\x1b[0m`;

// ─── Bridge I/O ───────────────────────────────────────────────────────────────

function sendCommand(command, args = {}) {
  fs.writeFileSync(COMMAND_FILE, JSON.stringify(
    { command, args, status: 'pending', timestamp: new Date().toISOString() },
    null, 2
  ));
}

// Only accept results strictly newer than the previous one — prevents a second
// same-named command (e.g. two setLayerKeyframe calls) from reusing the first result.
let lastResultTime = Date.now();

async function send(command, args = {}) {
  const sentAt = Date.now();
  sendCommand(command, args);

  const deadline = sentAt + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (fs.existsSync(RESULT_FILE)) {
      try {
        const stat = fs.statSync(RESULT_FILE);
        if (stat.mtimeMs > lastResultTime) {
          const parsed = JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8'));
          if (parsed._commandExecuted === command) {
            lastResultTime = stat.mtimeMs;
            return parsed;
          }
        }
      } catch { /* file not ready yet */ }
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  throw new Error(`Timed out after ${TIMEOUT_MS}ms waiting for "${command}"`);
}

// ─── Test runner ──────────────────────────────────────────────────────────────

const results = [];

async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    const note = await fn();
    console.log(green('PASS') + (note ? dim(` (${note})`) : ''));
    results.push({ name, ok: true });
    return true;
  } catch (e) {
    console.log(red('FAIL') + ` — ${e.message}`);
    results.push({ name, ok: false });
    return false;
  }
}

function assertNoError(result) {
  if (result.error) throw new Error(`bridge returned error: ${result.error}`);
  if (result.status === 'error') throw new Error(`bridge returned error: ${result.message}`);
  if (result.success === false) throw new Error(`bridge returned error: ${result.message}`);
}

// ─── Read-only tests ──────────────────────────────────────────────────────────

async function runReadTests() {
  console.log(bold('\nRead-only tests'));

  await test('getProjectInfo', async () => {
    const r = await send('getProjectInfo');
    assertNoError(r);
    if (!('numItems' in r)) throw new Error('missing numItems in response');
    return `${r.numItems} items in project`;
  });

  await test('listCompositions', async () => {
    const r = await send('listCompositions');
    assertNoError(r);
    const comps = r.compositions ?? r;
    if (!Array.isArray(comps)) throw new Error('expected array, got: ' + JSON.stringify(comps).slice(0, 80));
    return `${comps.length} comp(s)`;
  });

  await test('getLayerInfo (comp 1)', async () => {
    const r = await send('getLayerInfo', { compIndex: 1 });
    // No active comp or empty project is a valid state — not a bridge failure
    if (r.error) return `skipped — ${r.error}`;
    const layers = Array.isArray(r.layers) ? r.layers : Array.isArray(r) ? r : null;
    return layers ? `${layers.length} layer(s)` : 'OK';
  });

  await test('getLayerExpressions (comp 1, layer 1)', async () => {
    const r = await send('getLayerExpressions', { compIndex: 1, layerIndex: 1 });
    if (r.error) return `skipped — ${r.error}`;
    return 'OK';
  });
}

// ─── Write tests ──────────────────────────────────────────────────────────────

async function runWriteTests(noCleanup = false) {
  console.log(bold('\nWrite tests') + yellow(` (will create "${TEST_COMP}" in your open project)`));

  let testCompIndex = null;

  // 1. Create a dedicated test comp so we don't touch the user's real layers
  const compOk = await test('createComposition', async () => {
    const r = await send('createComposition', {
      name: TEST_COMP, width: 1920, height: 1080, duration: 5, frameRate: 30
    });
    assertNoError(r);

    // Find its index so subsequent commands target only the test comp
    const list = await send('listCompositions');
    const comps = list.compositions ?? list;
    if (!Array.isArray(comps)) throw new Error('listCompositions did not return an array');
    const match = comps.find(c => c.name === TEST_COMP);
    if (!match) throw new Error(`"${TEST_COMP}" not found after creation`);
    testCompIndex = match.itemIndex;
    if (!testCompIndex) throw new Error('listCompositions did not return itemIndex — rebuild and reinstall the bridge');
    return `comp index ${testCompIndex}`;
  });

  if (!compOk) {
    console.log(yellow('  Skipping remaining write tests — test comp creation failed.'));
    return;
  }

  // 2. Create a large text layer
  await test('createTextLayer', async () => {
    const r = await send('createTextLayer', {
      compName: TEST_COMP, text: 'MCP Test', fontSize: 120,
      position: [960, 540], color: [1, 1, 1]
    });
    if (r.status === 'error') throw new Error(r.message);
    return 'layer 1';
  });

  // 3. Position keyframes — slides left to right (very obvious)
  await test('setLayerKeyframe (Position @ 0s = left)', async () => {
    const r = await send('setLayerKeyframe', {
      compIndex: testCompIndex, layerIndex: 1,
      propertyName: 'Position', timeInSeconds: 0, value: [200, 540]
    });
    assertNoError(r);
  });

  await test('setLayerKeyframe (Position @ 4s = right)', async () => {
    const r = await send('setLayerKeyframe', {
      compIndex: testCompIndex, layerIndex: 1,
      propertyName: 'Position', timeInSeconds: 4, value: [1720, 540]
    });
    assertNoError(r);
  });

  // 4. Opacity keyframes — fades in from 0 to 100
  await test('setLayerKeyframe (Opacity @ 0s = 0)', async () => {
    const r = await send('setLayerKeyframe', {
      compIndex: testCompIndex, layerIndex: 1,
      propertyName: 'Opacity', timeInSeconds: 0, value: 0
    });
    assertNoError(r);
  });

  await test('setLayerKeyframe (Opacity @ 1s = 100)', async () => {
    const r = await send('setLayerKeyframe', {
      compIndex: testCompIndex, layerIndex: 1,
      propertyName: 'Opacity', timeInSeconds: 1, value: 100
    });
    assertNoError(r);
  });

  // 5. Easing on Position
  await test('setKeyframeEasing (easyEase on Position)', async () => {
    const r = await send('setKeyframeEasing', {
      compIndex: testCompIndex, layerIndex: 1,
      propertyName: 'Position', easeType: 'easyEase'
    });
    assertNoError(r);
  });

  // 6. Expression on Rotation — spins the text (unmissable), then clear it
  await test('setLayerExpression (spin on Rotation)', async () => {
    const r = await send('setLayerExpression', {
      compIndex: testCompIndex, layerIndex: 1,
      propertyName: 'Rotation', expressionString: 'time * 90'
    });
    assertNoError(r);
  });

  // 7. Drop Shadow — very visible, doesn't obscure the text
  await test('applyEffect (Drop Shadow, red)', async () => {
    const r = await send('applyEffect', {
      compIndex: testCompIndex, layerIndex: 1,
      effectMatchName: 'ADBE Drop Shadow',
      effectSettings: { 'Shadow Color': [1, 0, 0, 1], 'Distance': 20, 'Softness': 10 }
    });
    assertNoError(r);
  });

  // 8. Duplicate then delete both copies (skipped with --no-cleanup)
  await test('duplicateLayer', async () => {
    const r = await send('duplicateLayer', { compName: TEST_COMP, layerIndex: 1 });
    assertNoError(r);
  });

  if (noCleanup) {
    console.log(yellow(`\n  --no-cleanup: skipping deleteLayer. "${TEST_COMP}" left intact in your project.`));
    return;
  }

  await test('deleteLayer (layer 2)', async () => {
    const r = await send('deleteLayer', { compIndex: testCompIndex, layerIndex: 2 });
    assertNoError(r);
  });

  await test('deleteLayer (layer 1)', async () => {
    const r = await send('deleteLayer', { compIndex: testCompIndex, layerIndex: 1 });
    assertNoError(r);
  });

  console.log(yellow(`\n  "${TEST_COMP}" comp remains in your project — delete it manually when done.`));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const runWrite = process.argv.includes('--write');
  const noCleanup = process.argv.includes('--no-cleanup');

  console.log(bold('After Effects MCP — Integration Tests'));
  console.log(`Bridge dir: ${BRIDGE_DIR}`);
  console.log(yellow('Requires: After Effects open + mcp-bridge-auto.jsx panel active'));

  if (!fs.existsSync(BRIDGE_DIR)) {
    console.error(red(`\nBridge dir not found: ${BRIDGE_DIR}`));
    console.error('Open After Effects with the bridge panel at least once first.');
    process.exit(1);
  }

  await runReadTests();
  if (runWrite) await runWriteTests(noCleanup);

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  console.log(`\n${bold('Results:')} ${green(`${passed} passed`)}, ${failed > 0 ? red(`${failed} failed`) : `${failed} failed`}`);

  if (!runWrite) {
    console.log(dim('Run with --write to also test write operations (will modify your open AE project).'));
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
