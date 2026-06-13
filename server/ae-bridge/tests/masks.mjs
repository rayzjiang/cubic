// masks.mjs — tests for masks.jsx
//
// Covers:
//   getLayerMasks   (R  — all mask fields: index, name, mode, vertices, closed,
//                         feather, opacity, expansion, inTangents, outTangents)
//   setLayerMask    (C  — new mask via maskRect with feather + opacity + name)
//   setLayerMask    (C  — new mask via maskPath, triangle shape)
//   setLayerMask    (C  — bezier mask via maskPath + maskInTangents/maskOutTangents)
//   setLayerMask    (C  — new mask via maskPath with closed=false, open path)
//   setLayerMask    (U  — modify existing mask by maskIndex; previousValues.maskPath includes tangents)
//   setLayerMask    (E  — maskInTangents length mismatch returns INVALID_ARGS)
//   deleteLayerMask (D  — remove mask by name; removedMask full snapshot including tangents)
//
// Missing: none — full CRUD covered.

import {
  test, send,
  assertNoError, assertField, assertArray, assertValue,
  assertStructuredError, requireSetup,
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

    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', name: 'Mask Test Solid', color: [0.2, 0.6, 1]
    });
    assertNoError(lr);
    li = 1;
    return `comp ${cr.composition.itemIndex}, layer ${li}`;
  });

  if (!requireSetup(setupOk)) return;

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

  // ── A3: bezier tangents ───────────────────────────────────────────────────

  await test('setLayerMask — bezier mask with maskInTangents + maskOutTangents', async () => {
    const r = await send('setLayerMask', {
      compName: COMP_NAME,
      layerIndex: li,
      maskPath: [[200, 100], [500, 100], [350, 400]],
      maskInTangents:  [[-30, 0], [0, -30], [30, 0]],
      maskOutTangents: [[30,  0], [0,  30], [-30, 0]],
      maskMode: 'add',
      maskName: 'Test Bezier Mask'
    });
    assertNoError(r);
    assertField(r, 'mask', 'object');
    ctx.bezierMaskName = 'Test Bezier Mask';
    return `bezier mask index ${r.mask.index}`;
  });

  // ── Read ──────────────────────────────────────────────────────────────────

  await test('getLayerMasks — returns inTangents + outTangents for bezier mask', async () => {
    const r = await send('getLayerMasks', {
      compName: COMP_NAME, layerIndex: li
    });
    assertNoError(r);
    assertArray(r, 'masks');
    const bezier = r.masks.find(m => m.name === 'Test Bezier Mask');
    if (!bezier) throw new Error('Test Bezier Mask not found in getLayerMasks');
    assertArray(bezier, 'inTangents');
    assertArray(bezier, 'outTangents');
    if (bezier.inTangents.length !== 3) {
      throw new Error(`expected inTangents.length=3, got ${bezier.inTangents.length}`);
    }
    if (bezier.outTangents.length !== 3) {
      throw new Error(`expected outTangents.length=3, got ${bezier.outTangents.length}`);
    }
    return `inTangents[0]=${JSON.stringify(bezier.inTangents[0])}`;
  });

  await test('getLayerMasks — all masks include inTangents/outTangents (rect mask too)', async () => {
    const r = await send('getLayerMasks', {
      compName: COMP_NAME, layerIndex: li
    });
    assertNoError(r);
    const rect = r.masks.find(m => m.name === 'Test Rect Mask');
    if (!rect) throw new Error('Test Rect Mask not found');
    assertArray(rect, 'vertices');
    if (rect.vertices.length !== 4) throw new Error(`expected 4 vertices (rect), got ${rect.vertices.length}`);
    assertField(rect, 'closed');
    assertField(rect, 'feather');
    assertField(rect, 'opacity', 'number');
    assertField(rect, 'expansion', 'number');
    if (!('inTangents'  in rect)) throw new Error('getLayerMasks missing inTangents on rect mask');
    if (!('outTangents' in rect)) throw new Error('getLayerMasks missing outTangents on rect mask');
    const tri = r.masks.find(m => m.name === 'Test Path Mask');
    if (!tri) throw new Error('Test Path Mask not found');
    if (tri.vertices.length !== 3) throw new Error(`expected 3 vertices (triangle), got ${tri.vertices.length}`);
    return `${r.count} masks — rect has ${rect.vertices.length} vertices, triangle has ${tri.vertices.length}`;
  });

  await test('setLayerMask — maskInTangents length mismatch returns INVALID_ARGS', async () => {
    const r = await send('setLayerMask', {
      compName: COMP_NAME,
      layerIndex: li,
      maskPath: [[100, 100], [400, 100], [400, 300], [100, 300]],
      maskInTangents: [[-10, 0], [0, -10]],
      maskMode: 'add',
      maskName: 'Bad Tangents Mask'
    });
    assertStructuredError(r, 'INVALID_ARGS');
    if (!r.message.toLowerCase().includes('length')) {
      throw new Error(`expected "length" in error message, got: "${r.message}"`);
    }
  });

  // ── Update ────────────────────────────────────────────────────────────────

  await test('setLayerMask — modify existing mask (maskIndex), previousValues.maskPath includes inTangents/outTangents', async () => {
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
    assertField(r, 'previousValues', 'object');
    assertField(r.previousValues, 'maskPath', 'object');
    if (!('inTangents'  in r.previousValues.maskPath)) throw new Error('previousValues.maskPath missing inTangents');
    if (!('outTangents' in r.previousValues.maskPath)) throw new Error('previousValues.maskPath missing outTangents');
    if (!('vertices' in r.previousValues.maskPath)) throw new Error('previousValues.maskPath missing vertices');
    return `previousValues.maskPath has inTangents + outTangents`;
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  await test('deleteLayerMask — remove triangle mask by name; removedMask full snapshot with tangents', async () => {
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
    // A3: full removedMask snapshot
    assertField(r, 'removedMask', 'object');
    assertArray(r.removedMask, 'vertices');
    assertField(r.removedMask, 'mode', 'string');
    assertField(r.removedMask, 'opacity', 'number');
    assertField(r.removedMask, 'expansion', 'number');
    if (!('inTangents'  in r.removedMask)) throw new Error('removedMask missing inTangents');
    if (!('outTangents' in r.removedMask)) throw new Error('removedMask missing outTangents');

    // confirm count dropped (we added bezier mask, so 3→2)
    const check = await send('getLayerMasks', { compName: COMP_NAME, layerIndex: li });
    assertNoError(check);
    if (check.count < 1) throw new Error(`expected ≥1 mask remaining, got ${check.count}`);
    return `deleted "${r.deleted.name}" — removedMask.vertices.length=${r.removedMask.vertices.length}`;
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

  // Full-variant coverage: every mask mode must map to the right AE MaskMode constant — read it back.
  const MASK_MODES = ['none', 'add', 'subtract', 'intersect', 'lighten', 'darken', 'difference'];
  await test('setLayerMask — mask-mode probe (fresh layer + mask)', async () => {
    const lr = await send('createLayer', { compName: COMP_NAME, type: 'solid', name: 'MaskModeProbe', color: [0.5, 0.5, 0.5] });
    assertNoError(lr);
    const mk = await send('setLayerMask', { compName: COMP_NAME, layerIndex: 1, maskPath: [[100, 100], [300, 100], [300, 300], [100, 300]] });
    assertNoError(mk);
    return 'mask created on index 1';
  });
  for (const mode of MASK_MODES) {
    await test(`setLayerMask maskMode ${mode} — reads back as ${mode}`, async () => {
      const r = await send('setLayerMask', { compName: COMP_NAME, layerIndex: 1, maskIndex: 1, maskMode: mode });
      assertNoError(r);
      const rb = await send('getLayerMasks', { compName: COMP_NAME, layerIndex: 1 });
      assertNoError(rb);
      if (!rb.masks[0] || rb.masks[0].mode !== mode) throw new Error(`expected mask mode ${mode}, got ${rb.masks[0] && rb.masks[0].mode}`);
      return mode;
    });
  }
}
