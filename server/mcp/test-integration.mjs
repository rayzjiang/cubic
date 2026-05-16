#!/usr/bin/env node
// After Effects MCP — Integration Test Suite
//
// Usage:
//   node test-integration.mjs                    # read-only tests
//   node test-integration.mjs --write            # read + write tests (creates per-suite comps)
//   node test-integration.mjs --write --cleanup  # write tests, then delete all test comps + orphaned solids
//   node test-integration.mjs --cleanup-only     # delete all __MCP_TEST_* comps + orphaned solids, no tests
//   node test-integration.mjs --suite=effects    # only run one domain suite
//   node test-integration.mjs --write --suite=batch
//
// Available suites: compositions, layers, animation, masks, effects, batch
//
// Requires: MCP server running (npm start) + MCP Bridge UXP panel open in After Effects
//
// After --write, each suite leaves a named comp in your project for visual inspection:
//
//   __MCP_TEST_compositions__  — comp is deleted at end of suite; nothing to inspect
//   __MCP_TEST_layers__        — open comp: null + light + camera + shape + text + solid in timeline; text parented to null
//   __MCP_TEST_animation__     — play 0-4s: text spins (Rotation expr), fades in (Opacity), slides left→right (Position)
//   __MCP_TEST_masks__         — select the blue solid: masks panel should show 1 mask (Test Rect Mask, add mode); triangle was deleted
//   __MCP_TEST_effects__       — open Effect Controls on white solid: 4 effects (Gaussian Blur ×2, Curves, Vibrance); Drop Shadow was deleted
//   __MCP_TEST_batch__         — play 0-3s: text grows 50→100% (Scale) and spins (Rotation expr)
//
// Run --cleanup or npm run test:clean when done. Deletes comps + orphaned solid footage items.

import * as compositionsSuite from './tests/compositions.mjs';
import * as layersSuite       from './tests/layers.mjs';
import * as animationSuite    from './tests/animation.mjs';
import * as masksSuite        from './tests/masks.mjs';
import * as effectsSuite      from './tests/effects.mjs';
import * as batchSuite        from './tests/batch.mjs';

import { WS_URL, send, results, printSummary, bold, yellow, red, dim, checkConnection, closeConnection } from './tests/helpers.mjs';

// ─── Args ─────────────────────────────────────────────────────────────────────

const cleanup     = process.argv.includes('--cleanup') || process.argv.includes('--cleanup-only');
const cleanupOnly = process.argv.includes('--cleanup-only');
const suiteArg    = (process.argv.find(a => a.startsWith('--suite=')) ?? '').replace('--suite=', '') || null;

const opts = { write: process.argv.includes('--write') };

// ─── Suite registry ───────────────────────────────────────────────────────────

const suites = [
  { name: 'compositions', mod: compositionsSuite },
  { name: 'layers',       mod: layersSuite       },
  { name: 'animation',    mod: animationSuite    },
  { name: 'masks',        mod: masksSuite        },
  { name: 'effects',      mod: effectsSuite      },
  { name: 'batch',        mod: batchSuite        },
];

// ─── Cleanup ──────────────────────────────────────────────────────────────────

async function cleanupTestComps() {
  console.log(bold('\nCleanup — deleting test comps'));

  let listResult;
  try {
    listResult = await send('listCompositions');
  } catch (e) {
    console.error(red(`  Could not list comps: ${e.message}`));
    return;
  }

  const testComps = (listResult.compositions ?? []).filter(c =>
    typeof c.name === 'string' && c.name.startsWith('__MCP_TEST_')
  );

  if (testComps.length === 0) {
    console.log('  No __MCP_TEST_* comps found.');
    return;
  }

  for (const comp of testComps) {
    process.stdout.write(`  ${comp.name} ...`);
    try {
      const r = await send('deleteComposition', { compName: comp.name });
      if (r.status === 'error') throw new Error(r.message);
      console.log(' deleted');
    } catch (e) {
      console.log(red(` failed — ${e.message}`));
    }
  }

  process.stdout.write('  Cleaning up unused solids ...');
  try {
    const r = await send('deleteUnusedSolids');
    if (r.count > 0) {
      console.log(` removed ${r.count}: ${r.removed.join(', ')}`);
    } else {
      console.log(' none');
    }
  } catch (e) {
    console.log(red(` failed — ${e.message}`));
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Preflight: verify the MCP server's WS bridge is reachable
  try {
    await checkConnection(5000);
  } catch {
    console.error(red(`\nCould not connect to WS bridge at ${WS_URL}`));
    console.error('Start the MCP server (npm start) and open the MCP Bridge UXP panel in After Effects.');
    process.exit(1);
  }

  if (cleanupOnly) {
    console.log(bold('After Effects MCP — Cleanup'));
    console.log(yellow('Requires: After Effects open + MCP Bridge UXP panel active'));
    await cleanupTestComps();
    await closeConnection();
    return;
  }

  console.log(bold('After Effects MCP — Integration Tests'));
  console.log(`WS bridge: ${WS_URL}`);
  if (suiteArg) console.log(`Suite filter: ${suiteArg}`);
  console.log(yellow('Requires: After Effects open + MCP Bridge UXP panel active'));

  if (suiteArg && !suites.find(s => s.name === suiteArg)) {
    console.error(red(`\nUnknown suite "${suiteArg}". Available: ${suites.map(s => s.name).join(', ')}`));
    process.exit(1);
  }

  const ctx = {};

  for (const { name, mod } of suites) {
    if (suiteArg && suiteArg !== name) continue;
    await mod.run(ctx, opts);
  }

  if (opts.write && cleanup) {
    await cleanupTestComps();
  } else if (opts.write) {
    console.log(yellow('\n  Test comps left in project for visual inspection.'));
    console.log(dim('  Run with --cleanup or npm run test:clean to delete all test comps when done.'));
  }

  const failed = printSummary(opts.write);

  if (!opts.write) {
    console.log(dim('  Run with --write to also test write operations (creates comps in your open project).'));
  }

  await closeConnection();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
