// compositions.mjs — tests for compositions.jsx
//
// Covers:
//   getProjectInfo           (R)
//   listCompositions         (R)
//   createComposition        (C)
//   setCompositionProperties (U)
//   deleteComposition        (D)
//   undoAction               (project op — self-healing loop support)
//
// Missing: none — full CRUD + undo covered.

import {
  test, send,
  assertNoError, assertField, assertArray, assertValue, assertIncludes,
  bold, yellow
} from './helpers.mjs';

const COMP_NAME = '__MCP_TEST_compositions__';

export async function run(ctx, opts) {
  console.log(bold('\nCompositions'));

  // ── Read ──────────────────────────────────────────────────────────────────

  await test('getProjectInfo — numItems + itemCounts + items array', async () => {
    const r = await send('getProjectInfo');
    assertNoError(r);
    assertField(r, 'numItems', 'number');
    assertField(r, 'itemCounts', 'object');
    assertArray(r, 'items');
    return `${r.numItems} item(s) in project`;
  });

  await test('listCompositions — array with name, itemIndex, frameRate', async () => {
    const r = await send('listCompositions');
    assertNoError(r);
    assertArray(r, 'compositions');
    if (r.compositions.length > 0) {
      const c = r.compositions[0];
      assertField(c, 'name', 'string');
      assertField(c, 'itemIndex', 'number');
      assertField(c, 'duration', 'number');
      assertField(c, 'frameRate', 'number');
      assertField(c, 'width', 'number');
      assertField(c, 'height', 'number');
    }
    return `${r.compositions.length} comp(s)`;
  });

  if (!opts.write) return;

  // ── Write ─────────────────────────────────────────────────────────────────

  let compIndex;

  const compOk = await test('createComposition — returns comp properties, found in listCompositions', async () => {
    const r = await send('createComposition', {
      name: COMP_NAME, width: 1920, height: 1080, duration: 10, frameRate: 30
    });
    assertNoError(r);
    assertField(r, 'composition', 'object');
    assertField(r.composition, 'name', 'string');
    assertField(r.composition, 'width', 'number');
    assertField(r.composition, 'height', 'number');
    assertField(r.composition, 'duration', 'number');
    assertField(r.composition, 'frameRate', 'number');

    // Confirm it appears in the project
    const list = await send('listCompositions');
    const match = list.compositions.find(c => c.name === COMP_NAME);
    if (!match) throw new Error(`"${COMP_NAME}" not found in listCompositions after creation`);
    if (!match.itemIndex) throw new Error('itemIndex missing — rebuild + reinstall bridge');
    compIndex = match.itemIndex;
    return `comp index ${compIndex}`;
  });

  if (!compOk) {
    console.log(yellow('  createComposition failed — downstream write tests skipped'));
    return;
  }

  await test('setCompositionProperties — updates frameRate, reports changed props', async () => {
    const r = await send('setCompositionProperties', {
      compName: COMP_NAME, frameRate: 24
    });
    assertNoError(r);
    assertField(r, 'composition', 'object');
    assertField(r.composition, 'name', 'string');
    assertArray(r, 'changedProperties');
    assertIncludes(r, 'changedProperties', 'frameRate');
  });

  await test('deleteComposition — removes comp, no longer in listCompositions', async () => {
    const r = await send('deleteComposition', { compName: COMP_NAME });
    assertNoError(r);
    assertField(r, 'deleted', 'object');
    assertField(r.deleted, 'name', 'string');

    const list = await send('listCompositions');
    const still = list.compositions.find(c => c.name === COMP_NAME);
    if (still) throw new Error(`"${COMP_NAME}" still present in listCompositions after deletion`);
    return `deleted "${r.deleted.name}"`;
  });

  // ── undoAction ────────────────────────────────────────────────────────────
  // These tests create their own isolated comp so the undo target is always
  // the most recent entry on AE's undo stack.

  const UNDO_COMP = '__MCP_TEST_undo_scratch__';

  const undoSetupOk = await test('undoAction setup — create isolated scratch comp', async () => {
    // Clean up leftover comp from a previous run.
    const existing = await send('listCompositions');
    if (existing.compositions.find(c => c.name === UNDO_COMP)) {
      await send('deleteComposition', { compName: UNDO_COMP });
    }
    // Clean up any orphaned "Undo Test Solid" footage items left by prior failed runs
    // (undo may not have removed the solid footage source from the project panel).
    await send('deleteProjectItem', { itemName: 'Undo Test Solid' }).catch(() => {});
    await send('deleteUnusedSolids').catch(() => {});

    const cr = await send('createComposition', {
      name: UNDO_COMP, width: 1920, height: 1080, frameRate: 30, duration: 5, pixelAspect: 1
    });
    assertField(cr, 'composition', 'object');
    return 'scratch comp ready';
  });

  if (undoSetupOk) {
    await test('undoAction — single undo reverts createSolidLayer', async () => {
      // createSolidLayer is the LAST thing we do before calling undo, so it sits
      // at the very top of AE's undo stack regardless of prior history.
      const lr = await send('createSolidLayer', { compName: UNDO_COMP, name: 'Undo Test Solid', color: [1, 0, 0] });
      assertNoError(lr);

      const before = await send('getLayerInfo', { compName: UNDO_COMP });
      assertNoError(before);
      if (before.layers.length < 1) throw new Error('Solid layer was not created — nothing to undo');

      const ur = await send('undoAction', { steps: 1 });
      assertNoError(ur);
      assertField(ur, 'executed', 'number');
      if (ur.executed < 1) throw new Error(`Expected executed ≥ 1, got ${ur.executed}`);

      // Confirm the comp itself still exists (undo removed the layer, not the comp).
      // If UNDO_COMP was accidentally removed, getLayerInfo falls back to activeItem
      // and we'd get a misleading count — check the comp is still in the project first.
      const compList = await send('listCompositions');
      assertNoError(compList);
      const compExists = compList.compositions.some(c => c.name === UNDO_COMP);
      if (!compExists) {
        throw new Error(`"${UNDO_COMP}" is gone — undo removed the composition itself, not just the solid layer`);
      }

      const after = await send('getLayerInfo', { compName: UNDO_COMP });
      assertNoError(after);
      if (after.layers.length !== 0) {
        throw new Error(
          `Expected 0 layers after undo, got ${after.layers.length} — solid layer was not reverted` +
          ` (undo path: ${ur._via || 'evalScript-fallback — Node.js unavailable in CEP, restart AE fully'})`
        );
      }
      return `layer count ${before.layers.length} → ${after.layers.length}`;
    });

    await test('undoAction — steps param respected, stops gracefully at stack end', async () => {
      const ur = await send('undoAction', { steps: 20 });
      assertNoError(ur);
      assertField(ur, 'executed', 'number');
      assertField(ur, 'requested', 'number');
      if (ur.executed > 20) throw new Error(`executed (${ur.executed}) exceeds max of 20`);
      return `requested=${ur.requested} executed=${ur.executed}`;
    });

    // Clean up — the comp may or may not exist after the steps=20 test; ignore errors.
    // Also explicitly remove the solid footage item in case undo left it orphaned.
    await send('deleteComposition', { compName: UNDO_COMP }).catch(() => {});
    await send('deleteProjectItem', { itemName: 'Undo Test Solid' }).catch(() => {});
    await send('deleteUnusedSolids').catch(() => {});
  }
}
