// masks.mjs — tests for masks.jsx
// Covers: setLayerMask (C/U)
// Missing coverage (not yet implemented): getLayerMasks (R), deleteLayerMask (D)
//
// Creates its own __MCP_TEST_masks__ comp so mask results stay visible.

import {
  test, send,
  assertNoError, assertField, assertValue,
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

  // ── Masks ─────────────────────────────────────────────────────────────────

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

  await test('setLayerMask — custom path mask via maskPath (triangle)', async () => {
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
  });

  await test('setLayerMask — modify existing mask (maskIndex)', async () => {
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
}
