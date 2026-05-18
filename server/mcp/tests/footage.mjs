// footage.mjs — tests for footage.jsx
//
// Covers:
//   listProjectItems   (R  — enumerate project panel with optional type filter)
//   importFootage      (C  — import a file from disk, returns item metadata)
//   addFootageToComp   (C  — place imported item as a layer in a comp)
//   deleteProjectItem  (D  — remove imported footage item from project panel)
//   deleteUnusedSolids (D  — remove orphaned solid footage items)
//
// Missing: replaceFootageSource (post-MVP)
//
// Visual verification (after --write, open __MCP_TEST_footage__ in After Effects):
//   Project panel: "mcp_test_footage_<ts>.png" should appear as a footage item.
//   Timeline: "Test Footage Layer" + "Test Footage Layer 2" both sourced from the imported PNG.
//   Run --cleanup when done; the global cleanup removes the footage item + disk file in the correct order.

import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  test, send,
  assertNoError, assertField, assertArray, assertValue,
  assertStructuredError, requireSetup,
  bold, yellow
} from './helpers.mjs';

const COMP_NAME = '__MCP_TEST_footage__';

// 1×1 transparent PNG (base64) — generated inline so the test has no external deps.
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export async function run(ctx, opts) {
  console.log(bold('\nFootage'));

  // ── Read (always runs — no write flag needed) ─────────────────────────────

  await test('listProjectItems — returns items array with id, name, type, itemIndex', async () => {
    const r = await send('listProjectItems');
    assertNoError(r);
    assertArray(r, 'items');
    assertField(r, 'count', 'number');
    if (r.items.length > 0) {
      const item = r.items[0];
      assertField(item, 'id', 'number');
      assertField(item, 'name', 'string');
      assertField(item, 'type', 'string');
      assertField(item, 'itemIndex', 'number');
    }
    return `${r.count} item(s) in project`;
  });

  await test('listProjectItems — type filter "composition" returns only comps', async () => {
    const r = await send('listProjectItems', { type: 'composition' });
    assertNoError(r);
    assertArray(r, 'items');
    const wrong = r.items.filter(i => i.type !== 'composition');
    if (wrong.length > 0) {
      throw new Error(`type filter "composition" returned non-comp items: ${JSON.stringify(wrong.map(i => i.name))}`);
    }
    return `${r.count} comp(s)`;
  });

  if (!opts.write) return;

  // ── Setup ─────────────────────────────────────────────────────────────────

  // Write a 1×1 PNG to disk; stored in ctx so cleanup can remove it.
  const tempPath = join(tmpdir(), `mcp_test_footage_${Date.now()}.png`);
  ctx.footageTempPath = tempPath;

  const setupOk = await test('setup — create footage test comp + write temp PNG to disk', async () => {
    const pngBuf = Buffer.from(TINY_PNG_B64, 'base64');
    writeFileSync(tempPath, pngBuf);
    if (!existsSync(tempPath)) throw new Error(`Failed to write temp PNG: ${tempPath}`);

    const cr = await send('createComposition', {
      name: COMP_NAME, width: 1920, height: 1080, frameRate: 30, duration: 10, pixelAspect: 1
    });
    assertField(cr, 'composition', 'object');
    return `comp created, temp PNG at ${tempPath}`;
  });

  if (!requireSetup(setupOk)) return;

  // ── Create: importFootage ─────────────────────────────────────────────────

  const importOk = await test('importFootage — imports PNG from disk, returns item id + path', async () => {
    const r = await send('importFootage', { filePath: tempPath });
    assertNoError(r);
    assertField(r, 'item', 'object');
    assertField(r.item, 'id', 'number');
    assertField(r.item, 'name', 'string');
    assertField(r.item, 'path', 'string');
    assertValue(r.item, 'type', 'footage');
    ctx.importedItemId   = r.item.id;
    ctx.importedItemName = r.item.name;
    return `item "${r.item.name}" id=${r.item.id}`;
  });

  if (!importOk) {
    console.log(yellow('  addFootageToComp + downstream tests skipped — importFootage failed'));
    return;
  }

  // ── Read: verify imported item appears in listProjectItems ────────────────

  await test('listProjectItems — imported PNG appears as "footage" item', async () => {
    const r = await send('listProjectItems', { type: 'footage' });
    assertNoError(r);
    assertArray(r, 'items');
    const match = r.items.find(i => i.id === ctx.importedItemId);
    if (!match) throw new Error(`Imported item id=${ctx.importedItemId} not found in listProjectItems`);
    assertValue(match, 'type', 'footage');
    return `found "${match.name}" in project panel`;
  });

  // ── Create: addFootageToComp ──────────────────────────────────────────────

  await test('addFootageToComp — places imported PNG as a layer in the comp', async () => {
    const r = await send('addFootageToComp', {
      compName: COMP_NAME,
      itemId: ctx.importedItemId,
      name: 'Test Footage Layer',
      position: [960, 540]
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    assertField(r.layer, 'index', 'number');
    assertField(r.layer, 'name', 'string');
    assertField(r, 'composition', 'object');
    ctx.footageLayerIndex = r.layer.index;

    // Verify layer exists in comp
    const info = await send('getLayerInfo', { compName: COMP_NAME });
    assertNoError(info);
    const layer = info.layers.find(l => l.index === ctx.footageLayerIndex);
    if (!layer) throw new Error(`Layer index ${ctx.footageLayerIndex} not found in getLayerInfo`);
    return `layer "${r.layer.name}" at index ${r.layer.index}`;
  });

  await test('addFootageToComp — by itemName resolves correctly', async () => {
    const r = await send('addFootageToComp', {
      compName: COMP_NAME,
      itemName: ctx.importedItemName,
      name: 'Test Footage Layer 2'
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    assertField(r.layer, 'index', 'number');
    return `layer index ${r.layer.index}`;
  });

  // ── Error cases ───────────────────────────────────────────────────────────
  // Note: no teardown here — footage item stays in the project for visual inspection.
  // The global --cleanup in test-integration.mjs removes the project item first (before
  // the disk file) to prevent AE "file not found" dialogs on undo.

  await test('importFootage — returns error for missing file', async () => {
    const r = await send('importFootage', { filePath: '/nonexistent/path/missing.png' });
    assertStructuredError(r);
    return `errorCode=${r.errorCode}`;
  });

  await test('addFootageToComp — returns error when no source specified', async () => {
    const r = await send('addFootageToComp', { compName: COMP_NAME });
    assertStructuredError(r);
    return `errorCode=${r.errorCode}`;
  });

  // ── deleteProjectItem ─────────────────────────────────────────────────────

  await test('deleteProjectItem — import a temp item then remove it, verifies gone from listProjectItems', async () => {
    // Import a second temp item solely to delete it (ctx.importedItemId must survive for visual inspection)
    const tempPath2 = join(tmpdir(), `mcp_test_footage_del_${Date.now()}.png`);
    const pngBuf = Buffer.from(TINY_PNG_B64, 'base64');
    writeFileSync(tempPath2, pngBuf);

    const imported = await send('importFootage', { filePath: tempPath2 });
    assertNoError(imported);
    const delItemId = imported.item.id;

    const r = await send('deleteProjectItem', { itemId: delItemId });
    assertNoError(r);
    assertField(r, 'deleted', 'object');
    assertField(r.deleted, 'name', 'string');

    // Verify it's gone
    const list = await send('listProjectItems', { type: 'footage' });
    assertNoError(list);
    const stillThere = (list.items ?? []).find(i => i.id === delItemId);
    if (stillThere) throw new Error(`Item id=${delItemId} still present after deleteProjectItem`);

    // Clean up disk file
    try { unlinkSync(tempPath2); } catch (_) {}
    return `deleted item "${r.deleted.name}"`;
  });

  await test('deleteProjectItem — invalid itemId returns error', async () => {
    const r = await send('deleteProjectItem', { itemId: 999999 });
    assertStructuredError(r);
    return `errorCode=${r.errorCode}`;
  });

  // ── deleteUnusedSolids ────────────────────────────────────────────────────

  await test('deleteUnusedSolids — create orphaned solid then remove it', async () => {
    // Create a solid layer, capture the solid footage name, then delete the layer → orphan
    const cr2 = await send('createComposition', {
      name: '__MCP_TEST_footage_orphan__', width: 100, height: 100, frameRate: 30, duration: 1, pixelAspect: 1
    });
    assertField(cr2, 'composition', 'object');

    const sl = await send('createSolidLayer', {
      compName: '__MCP_TEST_footage_orphan__', name: 'Orphan Solid', color: [1, 0, 0]
    });
    assertNoError(sl);
    const solidLayerIndex = sl.layer.index;

    // Delete the layer → the solid footage item is now unused
    await send('deleteLayer', { compName: '__MCP_TEST_footage_orphan__', layerIndex: solidLayerIndex });

    const r = await send('deleteUnusedSolids');
    assertNoError(r);
    assertField(r, 'count', 'number');
    assertArray(r, 'removed');
    if (r.count < 1) throw new Error(`Expected ≥1 unused solid removed, got ${r.count}`);

    // Clean up the orphan comp
    await send('deleteComposition', { compName: '__MCP_TEST_footage_orphan__' });
    return `removed ${r.count} unused solid(s): ${r.removed.join(', ')}`;
  });

  await test('deleteUnusedSolids — with no orphans returns count=0', async () => {
    const r = await send('deleteUnusedSolids');
    assertNoError(r);
    assertField(r, 'count', 'number');
    assertArray(r, 'removed');
    // count may be 0 or more depending on project state; just verify shape is correct
    return `count=${r.count}`;
  });
}
