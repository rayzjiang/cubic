// markers.mjs — tests for marker commands in markers.jsx
//
// Covers:
//   addMarker    (C — comp marker + layer marker)
//   listMarkers  (R — returns all markers for a target)
//   updateMarker (U — change comment / duration via markerIndex)
//   removeMarker (D — remove by time; remove all with all:true)
//
// Visual verification (after --write, open __MCP_TEST_markers__ in After Effects):
//   Comp timeline ruler: one marker at 2s labelled "updated comment"
//   "Marked Layer" layer: one marker at 1.5s labelled "layer marker"

import {
  test, send,
  assertNoError, assertField, assertValue, assertArray,
  assertStructuredError, requireSetup,
  bold, yellow
} from './helpers.mjs';

const COMP_NAME = '__MCP_TEST_markers__';

export async function run(ctx, opts) {
  console.log(bold('\nMarkers'));

  // ── Read-only: listMarkers on active comp (no write needed) ───────────────

  await test('listMarkers — returns success on active comp (no markers expected)', async () => {
    const r = await send('listMarkers', {});
    // May get "no active composition" status:success or a real comp with markers
    if (r.status === 'error') throw new Error(`bridge error: ${r.message}`);
  });

  if (!opts.write) return;

  // ── Setup ─────────────────────────────────────────────────────────────────

  const setupOk = await test('setup — create markers test comp + solid layer', async () => {
    const cr = await send('createComposition', {
      name: COMP_NAME, width: 1920, height: 1080, frameRate: 30, duration: 10, pixelAspect: 1
    });
    assertField(cr, 'composition', 'object');

    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', name: 'Marked Layer',
      size: [1920, 1080], color: [0.1, 0.1, 0.2]
    });
    assertNoError(lr);
    ctx.markerLayerIndex = 1;
    return 'layer index 1';
  });

  if (!requireSetup(setupOk)) return;

  // ── Comp markers ─────────────────────────────────────────────────────────

  await test('addMarker — add comp marker at 1s with comment "intro"', async () => {
    const r = await send('addMarker', { compName: COMP_NAME, time: 1, comment: 'intro' });
    assertNoError(r);
    assertField(r, 'marker', 'object');
    assertValue(r, 'target', 'comp');
    if (Math.abs(r.marker.time - 1) > 0.01) throw new Error(`Expected time ≈ 1, got ${r.marker.time}`);
    if (r.marker.comment !== 'intro') throw new Error(`Expected comment "intro", got "${r.marker.comment}"`);
    ctx.compMarkerTime = r.marker.time;
    ctx.compMarkerIndex = r.marker.index;
  });

  await test('addMarker — add second comp marker at 2s with duration=1s', async () => {
    const r = await send('addMarker', {
      compName: COMP_NAME, time: 2, comment: 'section B', duration: 1
    });
    assertNoError(r);
    assertValue(r, 'target', 'comp');
    if (r.marker.duration === undefined || Math.abs(r.marker.duration - 1) > 0.01) {
      throw new Error(`Expected duration ≈ 1, got ${r.marker.duration}`);
    }
    ctx.compMarkerIndex2 = r.marker.index;
  });

  await test('listMarkers — comp markers returns count=2', async () => {
    const r = await send('listMarkers', { compName: COMP_NAME });
    assertNoError(r);
    assertValue(r, 'target', 'comp');
    assertArray(r, 'markers');
    if (r.count !== 2) throw new Error(`Expected 2 comp markers, got ${r.count}`);
  });

  await test('updateMarker — change "intro" comment to "updated comment"', async () => {
    const r = await send('updateMarker', {
      compName: COMP_NAME,
      markerIndex: ctx.compMarkerIndex,
      comment: 'updated comment'
    });
    assertNoError(r);
    if (r.marker.comment !== 'updated comment') {
      throw new Error(`Expected "updated comment", got "${r.marker.comment}"`);
    }
  });

  await test('listMarkers — verify updated comment persisted', async () => {
    const r = await send('listMarkers', { compName: COMP_NAME });
    assertNoError(r);
    const m = r.markers && r.markers.find(mk => mk.index === ctx.compMarkerIndex);
    if (!m) throw new Error('Marker index not found in listMarkers result');
    if (m.comment !== 'updated comment') throw new Error(`Expected updated comment, got "${m.comment}"`);
  });

  await test('removeMarker — remove comp marker by time', async () => {
    const r = await send('removeMarker', { compName: COMP_NAME, time: ctx.compMarkerTime });
    assertNoError(r);
    assertValue(r, 'target', 'comp');
    if (!r.message || !r.message.includes('removed')) throw new Error('Expected success message');
  });

  await test('listMarkers — comp markers count is now 1 after removal', async () => {
    const r = await send('listMarkers', { compName: COMP_NAME });
    assertNoError(r);
    if (r.count !== 1) throw new Error(`Expected 1 comp marker remaining, got ${r.count}`);
  });

  // ── Layer markers ─────────────────────────────────────────────────────────

  await test('addMarker — add layer marker at 1.5s', async () => {
    const r = await send('addMarker', {
      compName: COMP_NAME, layerIndex: ctx.markerLayerIndex,
      time: 1.5, comment: 'layer marker'
    });
    assertNoError(r);
    assertValue(r, 'target', 'layer');
    if (r.marker.comment !== 'layer marker') throw new Error(`Expected "layer marker", got "${r.marker.comment}"`);
    ctx.layerMarkerIndex = r.marker.index;
  });

  await test('listMarkers — layer markers returns count=1', async () => {
    const r = await send('listMarkers', {
      compName: COMP_NAME, layerIndex: ctx.markerLayerIndex
    });
    assertNoError(r);
    assertValue(r, 'target', 'layer');
    if (r.count !== 1) throw new Error(`Expected 1 layer marker, got ${r.count}`);
  });

  await test('removeMarker — remove all layer markers with all:true', async () => {
    const r = await send('removeMarker', {
      compName: COMP_NAME, layerIndex: ctx.markerLayerIndex, all: true
    });
    assertNoError(r);
    assertValue(r, 'target', 'layer');
    if (r.removedCount !== 1) throw new Error(`Expected removedCount=1, got ${r.removedCount}`);
  });

  await test('listMarkers — layer markers count=0 after removeAll', async () => {
    const r = await send('listMarkers', {
      compName: COMP_NAME, layerIndex: ctx.markerLayerIndex
    });
    assertNoError(r);
    if (r.count !== 0) throw new Error(`Expected 0 layer markers, got ${r.count}`);
  });

  // ── Error paths ───────────────────────────────────────────────────────────

  await test('addMarker — missing time returns error', async () => {
    const r = await send('addMarker', { compName: COMP_NAME });
    assertStructuredError(r);
    if (!r.message.includes('time')) throw new Error('Expected error mentioning "time"');
  });

  await test('removeMarker — non-existent time returns error', async () => {
    const r = await send('removeMarker', { compName: COMP_NAME, time: 99 });
    assertStructuredError(r);
  });
}
