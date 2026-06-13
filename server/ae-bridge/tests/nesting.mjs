// nesting.mjs — tests for nesting and matte commands in layers.jsx
//
// Covers:
//   precompose    (C  — groups layers into a nested sub-comp)
//   setTrackMatte (U  — alpha/luma/none, adjacent + explicit matteLayerIndex)
//   decomposeLayer (U — lifts inner layers from a precomp back into the parent comp)
//
// Visual verification (after --write, open __MCP_TEST_nesting__ in After Effects):
//   Timeline should contain TM Content (luma-matted by TM Matte), plus any layers
//   left over after the decompose test (DC Inner A, DC Inner B restored from precomp).

import {
  test, send,
  assertNoError, assertField, assertArray, assertValue, assertIncludes,
  assertStructuredError, requireSetup,
  bold, yellow
} from './helpers.mjs';

const COMP_NAME = '__MCP_TEST_nesting__';

export async function run(ctx, opts) {
  console.log(bold('\nNesting & Mattes'));

  if (!opts.write) return;

  // ── Setup ─────────────────────────────────────────────────────────────────

  const setupOk = await test('setup — create nesting test comp', async () => {
    const cr = await send('createComposition', {
      name: COMP_NAME, width: 1920, height: 1080, frameRate: 30, duration: 10, pixelAspect: 1
    });
    assertField(cr, 'composition', 'object');
    return `comp "${COMP_NAME}" created`;
  });

  if (!requireSetup(setupOk)) return;

  // ── precompose ────────────────────────────────────────────────────────────

  await test('precompose — group 2 layers into a sub-comp', async () => {
    const s1 = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', color: [1, 0, 0], name: 'PC Red'
    });
    assertNoError(s1);
    const s2 = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', color: [0, 0, 1], name: 'PC Blue'
    });
    assertNoError(s2);

    const idx1 = s2.layer.index; // most recently added = 1
    const idx2 = s1.layer.index; // previous = 2

    const r = await send('precompose', {
      compName: COMP_NAME,
      layerIndices: [idx1, idx2],
      newCompName: '__MCP_TEST_precompose__',
      moveAttributes: true
    });
    assertNoError(r);
    assertField(r, 'newComp', 'object');
    assertField(r.newComp, 'name', 'string');
    assertField(r.newComp, 'numLayers', 'number');
    if (r.newComp.numLayers < 1) throw new Error('Expected at least 1 layer inside the precomp');
    assertField(r, 'replacingLayer', 'object');
    assertField(r.replacingLayer, 'index', 'number');
    ctx.nestingPrecompLayerIdx = r.replacingLayer.index;

    const list = await send('listCompositions');
    const found = (list.compositions ?? []).some(c => c.name === '__MCP_TEST_precompose__');
    if (!found) throw new Error('New precomp not found in listCompositions');
    return `precomp at layer index ${r.replacingLayer.index} with ${r.newComp.numLayers} layer(s)`;
  });

  await test('precompose — invalid layer index returns error', async () => {
    const r = await send('precompose', {
      compName: COMP_NAME, layerIndices: [9999], newCompName: 'Should Fail'
    });
    assertStructuredError(r);
  });

  await test('precompose — empty layerIndices returns error', async () => {
    const r = await send('precompose', {
      compName: COMP_NAME, layerIndices: [], newCompName: 'Should Fail'
    });
    assertStructuredError(r);
  });

  await test('setLayerProperties — collapseTransformation toggle on precomp layer', async () => {
    // collapseTransformation is only settable on precomp (nested-comp) layers
    const r = await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: ctx.nestingPrecompLayerIdx, collapseTransformation: true
    });
    assertNoError(r);
    assertIncludes(r.layer, 'changedProperties', 'collapseTransformation');
    await send('setLayerProperties', {
      compName: COMP_NAME, layerIndex: ctx.nestingPrecompLayerIdx, collapseTransformation: false
    });
  });

  // ── setTrackMatte ─────────────────────────────────────────────────────────

  await test('setTrackMatte — set alpha matte using layer directly above (adjacent)', async () => {
    const matte = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', color: [1, 1, 1], name: 'TM Matte'
    });
    assertNoError(matte);
    const content = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', color: [0.2, 0.8, 0.2], name: 'TM Content'
    });
    assertNoError(content);
    // After both creates: TM Content=1, TM Matte=2 — content is below matte
    ctx.nestingContentIdx = 1;
    ctx.nestingMatteIdx   = 2;

    const r = await send('setTrackMatte', {
      compName: COMP_NAME, layerIndex: ctx.nestingContentIdx, matteType: 'alpha'
    });
    assertNoError(r);
    assertField(r, 'layer', 'object');
    assertValue(r.layer, 'trackMatteType', 'alpha');
  });

  await test('setTrackMatte — clear matte with matteType=none', async () => {
    const r = await send('setTrackMatte', {
      compName: COMP_NAME, layerIndex: ctx.nestingContentIdx, matteType: 'none'
    });
    assertNoError(r);
    assertValue(r.layer, 'trackMatteType', 'none');
  });

  await test('setTrackMatte — explicit matteLayerIndex (non-adjacent matte)', async () => {
    const r = await send('setTrackMatte', {
      compName: COMP_NAME, layerIndex: ctx.nestingContentIdx,
      matteType: 'luma',
      matteLayerIndex: ctx.nestingMatteIdx
    });
    assertNoError(r);
    assertValue(r.layer, 'trackMatteType', 'luma');
  });

  await test('setTrackMatte — invalid matteType returns error', async () => {
    const r = await send('setTrackMatte', {
      compName: COMP_NAME, layerIndex: ctx.nestingContentIdx, matteType: 'invalid'
    });
    assertStructuredError(r);
  });

  // ── decomposeLayer ────────────────────────────────────────────────────────

  await test('decomposeLayer — lifts inner layers into parent, removes precomp item', async () => {
    const r1 = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', color: [1, 0.5, 0], name: 'DC Inner A'
    });
    assertNoError(r1);
    const r2 = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', color: [0, 0.5, 1], name: 'DC Inner B'
    });
    assertNoError(r2);

    const idxA = r2.layer.index; // last added = 1
    const idxB = r1.layer.index; // previous   = 2

    const pc = await send('precompose', {
      compName: COMP_NAME,
      layerIndices: [idxA, idxB],
      newCompName: '__MCP_TEST_decompose__',
      moveAttributes: true
    });
    assertNoError(pc);
    assertField(pc, 'replacingLayer', 'object');
    const precompLayerIdx = pc.replacingLayer.index;

    const r = await send('decomposeLayer', {
      compName: COMP_NAME, layerIndex: precompLayerIdx
    });
    assertNoError(r);
    assertArray(r, 'unwrappedLayers');
    assertField(r, 'removedPrecomp', 'object');
    assertField(r.removedPrecomp, 'name', 'string');
    if (r.unwrappedLayers.length < 1) throw new Error('expected at least 1 unwrapped layer');

    const list = await send('listCompositions');
    const stillExists = (list.compositions ?? []).some(c => c.name === '__MCP_TEST_decompose__');
    if (stillExists) throw new Error('precomp item was not removed after decompose');
    return `unwrapped ${r.unwrappedLayers.length} layer(s)`;
  });

  await test('decomposeLayer — non-precomp layer returns INVALID_ARGS', async () => {
    const s = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', color: [0.2, 0.2, 0.2], name: 'DC Not A Precomp'
    });
    assertNoError(s);
    const r = await send('decomposeLayer', {
      compName: COMP_NAME, layerIndex: s.layer.index
    });
    assertStructuredError(r, 'INVALID_ARGS');
  });

  // Full-variant coverage: every track-matte type maps to the right AE TrackMatteType — read it back.
  // Target by NAME so setting a matte (which can reorder layers) doesn't drift the indices.
  await test('setTrackMatte — matte-type probe (content + matte layers)', async () => {
    const top = await send('createLayer', { compName: COMP_NAME, type: 'solid', name: 'MatteTop', color: [1, 1, 1] });
    assertNoError(top);
    const content = await send('createLayer', { compName: COMP_NAME, type: 'solid', name: 'MatteContent', color: [1, 0, 0] });
    assertNoError(content);
    return 'two layers';
  });
  for (const mt of ['alpha', 'alphaInverted', 'luma', 'lumaInverted', 'none']) {
    await test(`setTrackMatte ${mt} — reads back as ${mt}`, async () => {
      const args = { compName: COMP_NAME, layerName: 'MatteContent', matteType: mt };
      if (mt !== 'none') args.matteLayerName = 'MatteTop';
      const r = await send('setTrackMatte', args);
      assertNoError(r);
      if (r.layer.trackMatteType !== mt) throw new Error(`expected ${mt}, got ${r.layer.trackMatteType}`);
      return mt;
    });
  }
}
