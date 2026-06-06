// compositions.mjs — tests for compositions.jsx
//
// Covers:
//   getProjectInfo           (R)
//   listCompositions         (R)
//   getCompositionInfo       (R — single-comp full detail; includes workArea, display, shutter,
//                                 resolutionFactor, motionBlur, draft3d)
//   createComposition        (C)
//   setCompositionProperties (U — frameRate; workAreaStart + workAreaDuration atomic pair;
//                                 displayStartTime, resolutionFactor; shutterAngle clamped 0–720;
//                                 shutterPhase clamped ±360; motionBlur + draft3d; previousValues)
//   deleteComposition        (D)
//   duplicateComposition     (C — shallow: CompItem.duplicate; deep: recursive nested-comp remap)
//
// Note: there is no programmatic undo. AE gates app.executeCommand(Undo) from
// CEP's evalScript context. Rollback is handled via inverse-CRUD (each create*
// has a matching delete*), and the user's own ⌘Z works because every mutation
// is wrapped in a named beginUndoGroup ("Cubic: <command>").

import {
  test, send,
  assertNoError, assertField, assertArray, assertValue, assertIncludes,
  assertStructuredError, requireSetup,
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

  // ── A4: new setCompositionProperties fields ───────────────────────────────

  await test('setCompositionProperties — workArea pair round-trip + previousValues captured', async () => {
    const r = await send('setCompositionProperties', {
      compName: COMP_NAME, workAreaStart: 1, workAreaDuration: 3
    });
    assertNoError(r);
    assertIncludes(r, 'changedProperties', 'workAreaStart', 'workAreaDuration');
    assertField(r, 'previousValues', 'object');
    assertField(r.previousValues, 'workAreaStart', 'number');
    assertField(r.previousValues, 'workAreaDuration', 'number');
    if (Math.abs(r.composition.workAreaStart - 1) > 0.01) {
      throw new Error(`expected workAreaStart≈1, got ${r.composition.workAreaStart}`);
    }
    return `workArea ${r.composition.workAreaStart}s–${r.composition.workAreaStart + r.composition.workAreaDuration}s`;
  });

  await test('setCompositionProperties — workAreaStart >= comp duration returns INVALID_ARGS', async () => {
    const r = await send('setCompositionProperties', {
      compName: COMP_NAME, workAreaStart: 999
    });
    assertStructuredError(r, 'INVALID_ARGS');
    if (!r.message.toLowerCase().includes('duration')) {
      throw new Error(`expected error mentioning "duration", got: "${r.message}"`);
    }
  });

  await test('setCompositionProperties — workArea sum exceeds comp duration returns INVALID_ARGS', async () => {
    const r = await send('setCompositionProperties', {
      compName: COMP_NAME, workAreaStart: 8, workAreaDuration: 5
    });
    assertStructuredError(r, 'INVALID_ARGS');
  });

  await test('setCompositionProperties — displayStartTime + resolutionFactor, previousValues present', async () => {
    const r = await send('setCompositionProperties', {
      compName: COMP_NAME, displayStartTime: 1, resolutionFactor: [1, 2]
    });
    assertNoError(r);
    assertIncludes(r, 'changedProperties', 'displayStartTime', 'resolutionFactor');
    assertField(r.previousValues, 'displayStartTime', 'number');
    if (!('resolutionFactor' in r.previousValues)) throw new Error('previousValues missing resolutionFactor');
    return `displayStartTime=${r.composition.displayStartTime}, resolutionFactor=${JSON.stringify(r.composition.resolutionFactor)}`;
  });

  await test('setCompositionProperties — shutterAngle:1000 clamps to 720', async () => {
    const r = await send('setCompositionProperties', {
      compName: COMP_NAME, shutterAngle: 1000
    });
    assertNoError(r);
    assertIncludes(r, 'changedProperties', 'shutterAngle');
    if (r.composition.shutterAngle !== 720) {
      throw new Error(`expected shutterAngle=720 after clamping, got ${r.composition.shutterAngle}`);
    }
    assertField(r.previousValues, 'shutterAngle', 'number');
    return `shutterAngle clamped to ${r.composition.shutterAngle}`;
  });

  await test('setCompositionProperties — shutterPhase:-9999 clamps to -360', async () => {
    const r = await send('setCompositionProperties', {
      compName: COMP_NAME, shutterPhase: -9999
    });
    assertNoError(r);
    assertIncludes(r, 'changedProperties', 'shutterPhase');
    if (r.composition.shutterPhase !== -360) {
      throw new Error(`expected shutterPhase=-360 after clamping, got ${r.composition.shutterPhase}`);
    }
    return `shutterPhase clamped to ${r.composition.shutterPhase}`;
  });

  await test('setCompositionProperties — motionBlur + draft3d toggle, previousValues for both', async () => {
    const rOn = await send('setCompositionProperties', {
      compName: COMP_NAME, motionBlur: true, draft3d: true
    });
    assertNoError(rOn);
    assertIncludes(rOn, 'changedProperties', 'motionBlur', 'draft3d');
    if (!('motionBlur' in rOn.previousValues)) throw new Error('previousValues missing motionBlur');
    if (!('draft3d' in rOn.previousValues)) throw new Error('previousValues missing draft3d');
    if (rOn.composition.motionBlur !== true) throw new Error('expected motionBlur=true');
    if (typeof rOn.composition.draft3d !== 'boolean') throw new Error(`expected draft3d to be boolean, got ${typeof rOn.composition.draft3d}`);
    // Reset
    const rOff = await send('setCompositionProperties', {
      compName: COMP_NAME, motionBlur: false, draft3d: false
    });
    assertNoError(rOff);
    return 'motionBlur + draft3d toggled on then off';
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
    // A4 new fields
    assertField(c, 'displayStartTime', 'number');
    if (!('resolutionFactor' in c)) throw new Error('getCompositionInfo missing resolutionFactor');
    assertField(c, 'shutterAngle', 'number');
    assertField(c, 'shutterPhase', 'number');
    if (!('draft3d' in c)) throw new Error('getCompositionInfo missing draft3d');
    return `${c.width}×${c.height} @ ${c.frameRate}fps, shutterAngle=${c.shutterAngle}`;
  });

  await test('getCompositionInfo — unknown comp returns COMP_NOT_FOUND', async () => {
    const r = await send('getCompositionInfo', { compName: '__no_such_comp_getCompInfo_test__' });
    assertStructuredError(r, 'COMP_NOT_FOUND');
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

  // ── duplicateComposition ──────────────────────────────────────────────────

  if (opts.write) {
    const DUP_SRC    = '__MCP_TEST_dup_src__';
    const DUP_NESTED = '__MCP_TEST_dup_nested__';

    const dupSetup = await test('duplicateComposition setup — source + nested comp', async () => {
      const nc = await send('createComposition', {
        name: DUP_NESTED, width: 1920, height: 1080, frameRate: 30, duration: 5
      });
      assertField(nc, 'composition', 'object');
      const sc = await send('createComposition', {
        name: DUP_SRC, width: 1920, height: 1080, frameRate: 30, duration: 5
      });
      assertField(sc, 'composition', 'object');
      // Place nested comp inside src comp
      const nested = await send('addFootageToComp', { compName: DUP_SRC, itemName: DUP_NESTED });
      assertNoError(nested);
      return 'src + nested comps created';
    });

    if (requireSetup(dupSetup)) {
      await test('duplicateComposition — shallow duplicate creates new comp with correct name', async () => {
        const r = await send('duplicateComposition', {
          compName: DUP_SRC, newName: DUP_SRC + '_shallow'
        });
        assertNoError(r);
        assertField(r, 'original', 'object');
        assertField(r, 'duplicate', 'object');
        assertField(r.duplicate, 'id', 'number');
        if (r.duplicate.name !== DUP_SRC + '_shallow') {
          throw new Error(`Expected name="${DUP_SRC}_shallow", got "${r.duplicate.name}"`);
        }
        const list = await send('listCompositions');
        if (!list.compositions.find(c => c.name === DUP_SRC + '_shallow')) {
          throw new Error('Shallow duplicate not found in listCompositions');
        }
        return `id=${r.duplicate.id}`;
      });

      await test('duplicateComposition — deep:true returns duplicatedCompIds with root + nested', async () => {
        const r = await send('duplicateComposition', {
          compName: DUP_SRC, newName: DUP_SRC + '_deep', deep: true
        });
        assertNoError(r);
        assertField(r, 'rootDuplicate', 'object');
        assertField(r, 'duplicatedCompIds');
        if (!Array.isArray(r.duplicatedCompIds)) throw new Error('duplicatedCompIds should be array');
        if (r.duplicatedCompIds.length < 2) {
          throw new Error(`Expected >=2 comps (root + nested), got ${r.duplicatedCompIds.length}`);
        }
        return `${r.duplicatedCompIds.length} comp(s), root="${r.rootDuplicate.name}"`;
      });

      // Cleanup duplicates and originals
      for (const n of [DUP_SRC + '_shallow', DUP_SRC + '_deep', DUP_SRC, DUP_NESTED]) {
        await send('deleteComposition', { compName: n });
      }
    }
  }
}
