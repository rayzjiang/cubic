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
// Available suites: compositions, layers, nesting, animation, masks, effects, batch, footage, shapes, text, layer-time, markers, playhead, selection, project, anchor, render, errors, property-paths, bridge
//
// Requires: MCP server running (npm start) + MCP Bridge CEP panel open in After Effects
//
// After --write, each suite leaves a named comp in your project for visual inspection:
//
//   __MCP_TEST_compositions__  — comp is deleted at end of suite; nothing to inspect
//   __MCP_TEST_layers__        — open comp: null + light + camera + shape + text + solid in timeline; text parented to null
//   __MCP_TEST_nesting__       — TM Content (luma-matted by TM Matte); DC Inner A/B restored from decompose test
//   __MCP_TEST_animation__     — play 0-4s: text spins (Rotation expr), fades in (Opacity), slides left→right (Position)
//   __MCP_TEST_masks__         — select the blue solid: masks panel should show 1 mask (Test Rect Mask, add mode); triangle was deleted
//   __MCP_TEST_effects__       — open Effect Controls on white solid: 4 effects (Gaussian Blur ×2, Curves, Vibrance); Drop Shadow was deleted
//   __MCP_TEST_batch__         — play 0-3s: text grows 50→100% (Scale) and spins (Rotation expr)
//   __MCP_TEST_footage__       — project panel: imported PNG; timeline: "Test Footage Layer" + "Test Footage Layer 2" (stays until --cleanup)
//   __MCP_TEST_shapes__        — shape layers: Trim Paths End=100%, Repeater Copies=5, Round Corners Radius=20
//   __MCP_TEST_text__          — "HELLO" text: Animator 1 "Scale Fade" end=50 rampUp, Animator 2 Opacity by characters
//   __MCP_TEST_layer_time__    — "Shape Left" outPoint=2s, "Shape Left copy" inPoint=2s, "Trimmed Shape" inPoint=1s outPoint=3s
//   __MCP_TEST_markers__       — comp ruler: 1 marker at 2s "updated comment"; "Marked Layer": 0 layer markers
//   __MCP_TEST_playhead__      — playhead test comp (no visual residue after tests)
//   __MCP_TEST_selection__     — 3 solid layers; no layers selected after final test
//   __MCP_TEST_anchor__        — "Offset Shape" + "Offset Text": anchors centered on content bounding boxes
//   __MCP_TEST_render__        — open ~/.cubic/frames/ in Finder: 3 PNG files rendered from a red solid comp
//   __MCP_TEST_property_paths__ — "Path Shape": Fill=green; "Path Camera": Zoom=2000; "Path Solid" Drop Shadow Opacity=60
//
// Run --cleanup or npm run test:clean when done. Deletes comps + orphaned solid footage items.

import * as compositionsSuite from './tests/compositions.mjs';
import * as layersSuite       from './tests/layers.mjs';
import * as nestingSuite      from './tests/nesting.mjs';
import * as animationSuite    from './tests/animation.mjs';
import * as masksSuite        from './tests/masks.mjs';
import * as effectsSuite      from './tests/effects.mjs';
import * as batchSuite        from './tests/batch.mjs';
import * as footageSuite      from './tests/footage.mjs';
import * as shapesSuite       from './tests/shapes.mjs';
import * as textSuite         from './tests/text.mjs';
import * as layerTimeSuite    from './tests/layer-time.mjs';
import * as markersSuite      from './tests/markers.mjs';
import * as playheadSuite     from './tests/playhead.mjs';
import * as selectionSuite    from './tests/selection.mjs';
import * as projectSuite      from './tests/project.mjs';
import * as anchorSuite       from './tests/anchor.mjs';
import * as renderSuite       from './tests/render.mjs';
import * as errorsSuite        from './tests/errors.mjs';
import * as propertyPathsSuite from './tests/property-paths.mjs';
import * as bridgeSuite        from './tests/bridge.mjs';

import { WS_URL, send, results, printSummary, bold, yellow, red, dim, checkConnection, closeConnection } from './tests/helpers.mjs';
import { unlinkSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ─── Args ─────────────────────────────────────────────────────────────────────

const cleanup     = process.argv.includes('--cleanup') || process.argv.includes('--cleanup-only');
const cleanupOnly = process.argv.includes('--cleanup-only');
const suiteArg    = (process.argv.find(a => a.startsWith('--suite=')) ?? '').replace('--suite=', '') || null;

const opts = { write: process.argv.includes('--write') };

// ─── Suite registry ───────────────────────────────────────────────────────────

const suites = [
  { name: 'compositions',   mod: compositionsSuite  },
  { name: 'layers',         mod: layersSuite        },
  { name: 'nesting',        mod: nestingSuite       },
  { name: 'animation',      mod: animationSuite     },
  { name: 'masks',          mod: masksSuite         },
  { name: 'effects',        mod: effectsSuite       },
  { name: 'batch',          mod: batchSuite         },
  { name: 'footage',        mod: footageSuite       },
  { name: 'shapes',         mod: shapesSuite        },
  { name: 'text',           mod: textSuite          },
  { name: 'layer-time',     mod: layerTimeSuite     },
  { name: 'markers',        mod: markersSuite       },
  { name: 'playhead',       mod: playheadSuite      },
  { name: 'selection',      mod: selectionSuite     },
  { name: 'project',        mod: projectSuite       },
  { name: 'anchor',         mod: anchorSuite        },
  { name: 'render',         mod: renderSuite        },
  { name: 'errors',         mod: errorsSuite        },
  { name: 'property-paths', mod: propertyPathsSuite },
  { name: 'bridge',         mod: bridgeSuite        },
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

  // Remove any imported test footage items left by the footage suite.
  // Delete the project item FIRST (before the disk file) to prevent AE from
  // showing "file not found" dialogs on future undo operations.
  try {
    const items = await send('listProjectItems', { type: 'footage' });
    const testFootage = (items.items ?? []).filter(i =>
      typeof i.path === 'string' && i.path.includes('mcp_test_footage_')
    );
    let removedCount = 0;
    for (const item of testFootage) {
      // 1. Remove from AE project panel
      try { await send('deleteProjectItem', { itemId: item.id }); } catch (_) {}
      // 2. Delete disk file
      if (item.path && existsSync(item.path)) {
        try { unlinkSync(item.path); } catch (_) {}
      }
      removedCount++;
    }
    if (removedCount > 0) {
      console.log(`  Removed ${removedCount} temp footage item(s) from project + disk`);
    }
  } catch (_) {}
}

function cleanupRenderFrames(ctx) {
  let removed = 0;
  // Pass 1: paths tracked in ctx (catches default-path renders from this run)
  for (const p of ctx.renderPaths ?? []) {
    if (p && existsSync(p)) { try { unlinkSync(p); removed++; } catch (_) {} }
  }
  // Pass 2: scan ~/.cubic/frames/ for __MCP_TEST_* prefix — catches leaks from failed/prior runs
  const dir = join(homedir(), '.cubic', 'frames');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (f.startsWith('__MCP_TEST_')) {
        try { unlinkSync(join(dir, f)); removed++; } catch (_) {}
      }
    }
  }
  if (removed > 0) console.log(`  Removed ${removed} render frame(s) from disk`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Preflight: verify the MCP server's WS bridge is reachable
  try {
    await checkConnection(5000);
  } catch {
    console.error(red(`\nCould not connect to WS bridge at ${WS_URL}`));
    console.error('Start the MCP server (npm start) and open the MCP Bridge CEP panel in After Effects (Window → Extensions → MCP Bridge).');
    process.exit(1);
  }

  if (cleanupOnly) {
    console.log(bold('After Effects MCP — Cleanup'));
    console.log(yellow('Requires: After Effects open + MCP Bridge UXP panel active'));
    await cleanupTestComps();
    cleanupRenderFrames({});
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
    cleanupRenderFrames(ctx);
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
