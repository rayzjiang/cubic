// masks.mjs — tests for masks.jsx
//
// Covers:
//   getLayerMasks   (R  — all mask fields: index, name, mode, vertices, closed,
//                         feather, opacity, expansion)
//   setLayerMask    (C  — new mask via maskRect with feather + opacity + name)
//   setLayerMask    (C  — new mask via maskPath, triangle shape)
//   setLayerMask    (C  — new mask via maskPath with closed=false, open path)
//   setLayerMask    (U  — modify existing mask by maskIndex)
//   deleteLayerMask (D  — remove mask by name, confirmed by count drop)
//
// Missing: none — full CRUD covered.

import {
  test, send,
  assertNoError, assertField, assertArray, assertValue,
  bold, yellow
} from './helpers.mjs';

const COMP_NAME = '__MCP_TEST_masks__';

export async function run(ctx, opts) {
  console.log(bold('\nMasks'));

  if (!opts.write) return;

  // ── Setup ─────────────────────────────────────────────────────────────────

  let li;

  const setupOk = await test('setup — create masks test comp + solid layer', async () => {
    const cr = await send('createComposition', {
      name: COMP_NAME, width: 1920, height: 1080, frameRate: 30, duration: 10, pixelAspect: 1
    });
    assertField(cr, 'composition', 'object');

    const lr = await send('createSolidLayer', {
      compName: COMP_NAME, name: 'Mask Test Solid', color: [0.2, 0.6, 1]
    });
    assertNoError(lr);
    li = 1;
    return `comp ${cr.composition.itemIndex}, layer ${li}`;
  });

  if (!setupOk) {
    console.log(yellow('  Mask tests skipped — setup failed'));
    return;
  }

  // ── Create ────────────────────────────────────────────────────────────────

  await test('setLayerMask — new mask via maskRect, returns mask index + mode', async () => {
    const r = await send('setLayerMask', {
      compName: COMP_NAME,
      layerIndex: li,
      maskRect: { top: 50, left: 50, width: 200, height: 150 },
      maskMode: 'add',
      maskFeather: [10, 10],
      maskOpacity: 90,
      maskName: 'Test Rect Mask'
    });
    assertNoError(r);
    assertField(r, 'mask', 'object');
    assertField(r.mask, 'index', 'number');
    assertValue(r.mask, 'mode', 'add');
    assertField(r.layer, 'name', 'string');
    ctx.maskIndex = r.mask.index;
    return `mask index ${ctx.maskIndex}`;
  });

  await test('setLayerMask — new mask via maskPath (triangle)', async () => {
    const r = await send('setLayerMask', {
      compName: COMP_NAME,
      layerIndex: li,
      maskPath: [[100, 50], [400, 50], [250, 300]],
      maskMode: 'subtract',
      maskOpacity: 75,
      maskName: 'Test Path Mask'
    });
    assertNoError(r);
    assertField(r, 'mask', 'object');
    assertValue(r.mask, 'mode', 'subtract');
    ctx.pathMaskName = 'Test Path Mask';
  });

  // ── Read ──────────────────────────────────────────────────────────────────

  await test('getLayerMasks — 2 masks with name, mode, vertices, feather, opacity, expansion', async () => {
    const r = await send('getLayerMasks', {
      compName: COMP_NAME, layerIndex: li
    });
    assertNoError(r);
    assertArray(r, 'masks');
    assertField(r, 'count', 'number');
    if (r.count !== 2) throw new Error(`expected 2 masks, got ${r.count}`);
    const rect = r.masks.find(m => m.name === 'Test Rect Mask');
    if (!rect) throw new Error('Test Rect Mask not found');
    assertField(rect, 'index', 'number');
    assertField(rect, 'mode', 'string');
    assertArray(rect, 'vertices');
    if (rect.vertices.length !== 4) throw new Error(`expected 4 vertices (rect), got ${rect.vertices.length}`);
    assertField(rect, 'closed');
    assertField(rect, 'feather');
    assertField(rect, 'opacity', 'number');
    assertField(rect, 'expansion', 'number');
    const tri = r.masks.find(m => m.name === 'Test Path Mask');
    if (!tri) throw new Error('Test Path Mask not found');
    if (tri.vertices.length !== 3) throw new Error(`expected 3 vertices (triangle), got ${tri.vertices.length}`);
    return `${r.count} masks — rect has ${rect.vertices.length} vertices, triangle has ${tri.vertices.length}`;
  });

  // ── Update ────────────────────────────────────────────────────────────────

  await test('setLayerMask — modify existing mask (maskIndex), sets expansion', async () => {
    if (!ctx.maskIndex) {
      throw new Error('maskIndex not set — first setLayerMask test must have passed');
    }
    const r = await send('setLayerMask', {
      compName: COMP_NAME,
      layerIndex: li,
      maskIndex: ctx.maskIndex,
      maskRect: { top: 0, left: 0, width: 400, height: 300 },
      maskMode: 'add',
      maskExpansion: 5
    });
    assertNoError(r);
    assertField(r, 'mask', 'object');
    assertValue(r.mask, 'index', ctx.maskIndex);
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  await test('deleteLayerMask — remove triangle mask by name, count drops to 1', async () => {
    const r = await send('deleteLayerMask', {
      compName: COMP_NAME,
      layerIndex: li,
      maskName: ctx.pathMaskName
    });
    assertNoError(r);
    assertField(r, 'deleted', 'object');
    assertField(r.deleted, 'name', 'string');
    assertField(r.deleted, 'index', 'number');
    if (r.deleted.name !== ctx.pathMaskName) {
      throw new Error(`expected deleted name "${ctx.pathMaskName}", got "${r.deleted.name}"`);
    }

    // confirm count dropped
    const check = await send('getLayerMasks', { compName: COMP_NAME, layerIndex: li });
    assertNoError(check);
    if (check.count !== 1) throw new Error(`expected 1 mask remaining, got ${check.count}`);
    return `deleted "${r.deleted.name}", ${check.count} mask remaining`;
  });

  await test('setLayerMask — open path (closed=false) stored and returned by getLayerMasks', async () => {
    const r = await send('setLayerMask', {
      compName: COMP_NAME,
      layerIndex: li,
      maskPath: [[50, 300], [300, 300], [200, 500]],
      closed: false,
      maskMode: 'add',
      maskName: 'Test Open Mask'
    });
    assertNoError(r);
    assertField(r, 'mask', 'object');

    const check = await send('getLayerMasks', { compName: COMP_NAME, layerIndex: li });
    assertNoError(check);
    const m = check.masks.find(m => m.name === 'Test Open Mask');
    if (!m) throw new Error('Test Open Mask not found in getLayerMasks');
    if (m.closed !== false) throw new Error(`expected closed=false, got ${m.closed}`);
    return `closed=${m.closed}`;
  });
}
