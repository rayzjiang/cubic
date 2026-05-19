// layer-time.mjs — tests for splitLayer, trimLayer, and mergeLayer in layers.jsx
//
// Covers:
//   splitLayer  (U — split layer at time into two halves; duplicate + inPoint/outPoint)
//   trimLayer   (U — set inPoint, outPoint, startTime, or mode)
//   mergeLayer  (U — rejoin two contiguous same-source halves from splitLayer)
//
// Visual verification (after --write, open __MCP_TEST_layer_time__ in After Effects):
//   "Shape Left" layer — outPoint should be 2s (trimmed right edge)
//   "Shape Left copy" layer — inPoint should be 2s (split right half)
//   "Trimmed Shape" layer — inPoint=1s, outPoint=4s
//   Both layers together span 0–5s with no gap after the split.

import {
  test, send,
  assertNoError, assertField,
  assertStructuredError, requireSetup,
  bold, yellow
} from './helpers.mjs';

const COMP_NAME = '__MCP_TEST_layer_time__';

export async function run(ctx, opts) {
  console.log(bold('\nLayer Time Ops'));

  if (!opts.write) return;

  // ── Setup ─────────────────────────────────────────────────────────────────

  const setupOk = await test('setup — create layer-time test comp + shape layer', async () => {
    const cr = await send('createComposition', {
      name: COMP_NAME, width: 1920, height: 1080, frameRate: 30, duration: 10, pixelAspect: 1
    });
    assertField(cr, 'composition', 'object');

    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'shape', name: 'Shape Left',
      shapeType: 'rectangle', size: [400, 300], fillColor: [0.2, 0.5, 0.9]
    });
    assertNoError(lr);
    ctx.ltLayerIndex = 1;
    return `layer index ${ctx.ltLayerIndex}`;
  });

  if (!requireSetup(setupOk)) return;

  // ── splitLayer ────────────────────────────────────────────────────────────

  await test('splitLayer — split shape layer at 2s', async () => {
    const r = await send('splitLayer', {
      compName: COMP_NAME, layerIndex: ctx.ltLayerIndex, time: 2
    });
    assertNoError(r);
    assertField(r, 'original', 'object');
    assertField(r, 'newLayer', 'object');
    // original (left half) should end at 2s
    if (Math.abs(r.original.outPoint - 2) > 0.01) {
      throw new Error(`Expected original.outPoint ≈ 2, got ${r.original.outPoint}`);
    }
    // new layer (right half) should start at 2s
    if (Math.abs(r.newLayer.inPoint - 2) > 0.01) {
      throw new Error(`Expected newLayer.inPoint ≈ 2, got ${r.newLayer.inPoint}`);
    }
    // save new layer index for further tests
    ctx.ltNewLayerIndex = r.newLayer.index;
  });

  await test('splitLayer — verify original layer outPoint via getLayerInfo', async () => {
    const r = await send('getLayerInfo', { compName: COMP_NAME });
    assertNoError(r);
    const original = r.layers && r.layers.find(l => l.name === 'Shape Left');
    if (!original) throw new Error('Shape Left layer not found');
    if (Math.abs(original.outPoint - 2) > 0.01) {
      throw new Error(`Expected Shape Left outPoint ≈ 2s, got ${original.outPoint}`);
    }
  });

  await test('splitLayer — error when split time is outside layer range', async () => {
    const r = await send('splitLayer', {
      compName: COMP_NAME, layerIndex: ctx.ltLayerIndex, time: 99
    });
    assertStructuredError(r);
    if (!r.message.includes('outside')) {
      throw new Error('Expected error mentioning "outside"');
    }
  });

  // ── trimLayer ─────────────────────────────────────────────────────────────

  await test('trimLayer — create fresh shape layer for trim tests', async () => {
    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'shape', name: 'Trimmed Shape',
      shapeType: 'ellipse', size: [200, 200], fillColor: [0.9, 0.3, 0.1]
    });
    assertNoError(lr);
    ctx.ltTrimIndex = 1; // new layer lands at index 1
  });

  await test('trimLayer — set inPoint=1s and outPoint=4s', async () => {
    const r = await send('trimLayer', {
      compName: COMP_NAME, layerIndex: ctx.ltTrimIndex,
      inPoint: 1, outPoint: 4
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    if (Math.abs(r.layer.inPoint - 1) > 0.01) {
      throw new Error(`Expected inPoint ≈ 1, got ${r.layer.inPoint}`);
    }
    if (Math.abs(r.layer.outPoint - 4) > 0.01) {
      throw new Error(`Expected outPoint ≈ 4, got ${r.layer.outPoint}`);
    }
  });

  await test('trimLayer — set startTime=0.5s (shifts layer in timeline)', async () => {
    const r = await send('trimLayer', {
      compName: COMP_NAME, layerIndex: ctx.ltTrimIndex,
      startTime: 0.5
    });
    assertNoError(r);
    if (Math.abs(r.layer.startTime - 0.5) > 0.01) {
      throw new Error(`Expected startTime ≈ 0.5, got ${r.layer.startTime}`);
    }
  });

  await test('trimLayer — inPoint >= outPoint returns error', async () => {
    const r = await send('trimLayer', {
      compName: COMP_NAME, layerIndex: ctx.ltTrimIndex,
      inPoint: 8, outPoint: 3
    });
    assertStructuredError(r);
    if (!r.message.includes('outPoint')) {
      throw new Error('Expected error mentioning inPoint/outPoint constraint');
    }
  });

  await test('trimLayer — mode=currentTimeOut snaps outPoint to playhead', async () => {
    // Set playhead to 3s first
    const st = await send('setCurrentTime', { compName: COMP_NAME, timeInSeconds: 3 });
    assertNoError(st);

    const r = await send('trimLayer', {
      compName: COMP_NAME, layerIndex: ctx.ltTrimIndex,
      mode: 'currentTimeOut'
    });
    assertNoError(r);
    if (Math.abs(r.layer.outPoint - 3) > 0.01) {
      throw new Error(`Expected outPoint ≈ 3 (playhead), got ${r.layer.outPoint}`);
    }
  });

  // ── mergeLayer ────────────────────────────────────────────────────────────

  await test('mergeLayer — split a solid then rejoin; merged outPoint equals original', async () => {
    const sc = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', name: 'Merge Test Solid', color: [0.5, 0.5, 0.5], duration: 10
    });
    assertNoError(sc);
    const solidIdx = sc.layer.index;

    const split = await send('splitLayer', {
      compName: COMP_NAME, layerIndex: solidIdx, time: 5
    });
    assertNoError(split);
    assertField(split, 'original', 'object');
    assertField(split, 'newLayer', 'object');
    const leftIdx = split.original.index;
    const rightIdx = split.newLayer.index;
    const origOut  = split.newLayer.outPoint;

    const r = await send('mergeLayer', {
      compName: COMP_NAME, layerIndex: leftIdx, mergeWithIndex: rightIdx
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    assertField(r, 'removed', 'object');
    assertField(r.removed, 'name', 'string');
    assertField(r.removed, 'index', 'number');
    if (Math.abs(r.layer.outPoint - origOut) > 0.001) {
      throw new Error(`merged outPoint ${r.layer.outPoint} != expected ${origOut}`);
    }
    return `merged; outPoint=${r.layer.outPoint}s`;
  });

  await test('mergeLayer — mismatched sources returns INVALID_ARGS', async () => {
    const a = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', name: 'Merge Err A', color: [1, 0, 0]
    });
    const b = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', name: 'Merge Err B', color: [0, 0, 1]
    });
    assertNoError(a); assertNoError(b);
    const r = await send('mergeLayer', {
      compName: COMP_NAME, layerIndex: b.layer.index, mergeWithIndex: a.layer.index
    });
    assertStructuredError(r, 'INVALID_ARGS');
  });
}
