// compositions.mjs — tests for compositions.jsx
//
// Covers:
//   getProjectInfo           (R)
//   listCompositions         (R)
//   getCompositionInfo       (R — single-comp full detail; mirror of listCompositions)
//   createComposition        (C)
//   setCompositionProperties (U)
//   deleteComposition        (D)
//
// Note: there is no programmatic undo. AE gates app.executeCommand(Undo) from
// CEP's evalScript context. Rollback is handled via inverse-CRUD (each create*
// has a matching delete*), and the user's own ⌘Z works because every mutation
// is wrapped in a named beginUndoGroup ("Cubic: <command>").

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

  await test('getCompositionInfo — full single-comp detail with name, dimensions, work area, render flags', async () => {
    const r = await send('getCompositionInfo', { compName: COMP_NAME });
    assertNoError(r);
    assertField(r, 'composition', 'object');
    const c = r.composition;
    assertValue(c, 'name', COMP_NAME);
    assertField(c, 'id', 'number');
    assertField(c, 'width', 'number');
    assertField(c, 'height', 'number');
    assertField(c, 'duration', 'number');
    assertField(c, 'frameRate', 'number');
    assertField(c, 'numLayers', 'number');
    assertField(c, 'workAreaStart', 'number');
    assertField(c, 'workAreaDuration', 'number');
    assertField(c, 'motionBlur', 'boolean');
    return `${c.width}×${c.height} @ ${c.frameRate}fps`;
  });

  await test('getCompositionInfo — unknown comp returns COMP_NOT_FOUND', async () => {
    const r = await send('getCompositionInfo', { compName: '__no_such_comp_getCompInfo_test__' });
    assertValue(r, 'status', 'error');
    if (r.errorCode !== 'COMP_NOT_FOUND') {
      throw new Error(`expected COMP_NOT_FOUND, got "${r.errorCode}"`);
    }
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
}
