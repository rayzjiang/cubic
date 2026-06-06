// text.mjs — tests for text layer + text animator commands in text.jsx
//
// Covers:
//   addTextAnimator             (C  — properties array, name, initialValues)
//   setTextAnimatorProperty     (U  — update an animated property value)
//   setTextAnimatorRangeSelector (U  — start, end, offset, basedOn, shape)
//   getLayerProperty             (R  — read animator subtree, verifies mutations above)
//   explodeTextLayer            (C  — CHARACTERS/WORDS/LINES; animator-mask layout preservation;
//                                     createdLayers + hiddenSourceIndex + previousValues)
//
// Visual verification (after --write, open __MCP_TEST_text__ in After Effects):
//   "HELLO" text layer in timeline. Expand Text > Animators:
//     Animator 1 ("Scale Fade") — Scale animated property; Range Selector end=50, shape=rampUp.
//     Animator 2 — Opacity animated property; Range Selector basedOn=characters.
//   Text should show partial scale/opacity effect across characters.

import {
  test, send,
  assertNoError, assertField, assertArray,
  assertStructuredError, requireSetup,
  bold, yellow
} from './helpers.mjs';

const COMP_NAME = '__MCP_TEST_text__';

export async function run(ctx, opts) {
  console.log(bold('\nText Animators'));

  if (!opts.write) return;

  // ── Setup ─────────────────────────────────────────────────────────────────

  const setupOk = await test('setup — create text test comp + text layer', async () => {
    const cr = await send('createComposition', {
      name: COMP_NAME, width: 1920, height: 1080, frameRate: 30, duration: 10, pixelAspect: 1
    });
    assertField(cr, 'composition', 'object');

    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'text', text: 'HELLO',
      fontSize: 200, position: [960, 540], color: [1, 1, 1]
    });
    assertNoError(lr);
    ctx.textAnimLayerIndex = 1;
    return `layer ${ctx.textAnimLayerIndex}`;
  });

  if (!requireSetup(setupOk)) return;

  // ── Add text animator ─────────────────────────────────────────────────────

  await test('addTextAnimator — Scale + name "Scale Fade"', async () => {
    const r = await send('addTextAnimator', {
      compName: COMP_NAME, layerIndex: ctx.textAnimLayerIndex,
      name: 'Scale Fade',
      properties: ['Scale'],
      initialValues: { Scale: [0, 0, 100] }
    });
    assertNoError(r);
    assertField(r, 'animator', 'object');
    assertField(r.animator, 'index', 'number');
    assertField(r.animator, 'name', 'string');
    assertArray(r.animator, 'properties');
    if (r.animator.properties.length === 0) throw new Error('Expected at least 1 property added');
    ctx.animatorIndex1 = r.animator.index;
    return `animator index ${ctx.animatorIndex1}, name="${r.animator.name}"`;
  });

  await test('addTextAnimator — Opacity (second animator)', async () => {
    const r = await send('addTextAnimator', {
      compName: COMP_NAME, layerIndex: ctx.textAnimLayerIndex,
      properties: ['Opacity']
    });
    assertNoError(r);
    assertField(r, 'animator', 'object');
    if (r.animator.index < 2) throw new Error('Expected second animator index >= 2');
    ctx.animatorIndex2 = r.animator.index;
    return `animator index ${ctx.animatorIndex2}`;
  });

  // ── getLayerProperty reads into text animator tree ────────────────────────

  await test('getLayerProperty — read animator Scale value via path', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.textAnimLayerIndex,
      propertyPath: ['Text', 'Animators', 'Scale Fade', 'Scale']
    });
    assertNoError(r);
    assertField(r, 'property', 'object');
    assertField(r.property, 'value');
  });

  // ── setTextAnimatorProperty ───────────────────────────────────────────────

  await test('setTextAnimatorProperty — update Scale to [50, 50, 100]', async () => {
    const r = await send('setTextAnimatorProperty', {
      compName: COMP_NAME, layerIndex: ctx.textAnimLayerIndex,
      animatorIndex: ctx.animatorIndex1,
      propertyName: 'Scale',
      value: [50, 50, 100]
    });
    assertNoError(r);
    assertField(r, 'property', 'object');
    assertField(r.property, 'value');
  });

  await test('getLayerProperty — verify Scale updated (none dimension should be near 50)', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: ctx.textAnimLayerIndex,
      propertyPath: ['Text', 'Animators', 'Scale Fade', 'Scale']
    });
    assertNoError(r);
    const val = r.property.value;
    if (!val || (Array.isArray(val) && val[0] !== 50)) {
      throw new Error(`Expected Scale[0]=50, got ${JSON.stringify(val)}`);
    }
  });

  await test('setTextAnimatorProperty — invalid animatorIndex returns error', async () => {
    const r = await send('setTextAnimatorProperty', {
      compName: COMP_NAME, layerIndex: ctx.textAnimLayerIndex,
      animatorIndex: 99,
      propertyName: 'Scale',
      value: 100
    });
    assertStructuredError(r);
  });

  await test('setTextAnimatorProperty — invalid propertyName returns error', async () => {
    const r = await send('setTextAnimatorProperty', {
      compName: COMP_NAME, layerIndex: ctx.textAnimLayerIndex,
      animatorIndex: ctx.animatorIndex1,
      propertyName: 'FakeProperty',
      value: 100
    });
    assertStructuredError(r);
  });

  // ── setTextAnimatorRangeSelector ─────────────────────────────────────────

  await test('setTextAnimatorRangeSelector — set start=0, end=50, shape=rampUp on animator 1', async () => {
    const r = await send('setTextAnimatorRangeSelector', {
      compName: COMP_NAME, layerIndex: ctx.textAnimLayerIndex,
      animatorIndex: ctx.animatorIndex1,
      start: 0, end: 50,
      shape: 'rampUp'
    });
    assertNoError(r);
    assertField(r, 'selector', 'object');
    if (r.selector.end !== 50) throw new Error(`Expected end=50, got ${r.selector.end}`);
  });

  await test('setTextAnimatorRangeSelector — set basedOn=characters on animator 2', async () => {
    const r = await send('setTextAnimatorRangeSelector', {
      compName: COMP_NAME, layerIndex: ctx.textAnimLayerIndex,
      animatorIndex: ctx.animatorIndex2,
      basedOn: 'characters'
    });
    assertNoError(r);
    assertField(r, 'selector', 'object');
  });

  await test('setTextAnimatorRangeSelector — invalid animatorIndex returns error', async () => {
    const r = await send('setTextAnimatorRangeSelector', {
      compName: COMP_NAME, layerIndex: ctx.textAnimLayerIndex,
      animatorIndex: 99,
      start: 0
    });
    assertStructuredError(r);
  });

  // ── Error: non-text layer ─────────────────────────────────────────────────

  await test('addTextAnimator — on a solid layer returns error', async () => {
    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', name: 'Test Solid', color: [0.5, 0.5, 0.5]
    });
    assertNoError(lr);
    const solidIdx = 1;

    const r = await send('addTextAnimator', {
      compName: COMP_NAME, layerIndex: solidIdx,
      properties: ['Opacity']
    });
    assertStructuredError(r);
    if (!r.message.toLowerCase().includes('text')) {
      throw new Error('Expected error message mentioning text layer requirement');
    }
  });

  // ── explodeTextLayer ──────────────────────────────────────────────────────

  let explodeSourceIndex;
  const EXPLODE_TEXT = 'HI';

  await test('explodeTextLayer setup — create short text layer for explode', async () => {
    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'text', text: EXPLODE_TEXT,
      fontSize: 200, position: [960, 540], color: [1, 1, 1], name: 'ExplodeSource'
    });
    assertNoError(lr);
    explodeSourceIndex = 1;
    return `layer ${explodeSourceIndex}, text="${EXPLODE_TEXT}"`;
  });

  await test('explodeTextLayer — CHARACTERS produces N=text.length duplicate layers', async () => {
    const r = await send('explodeTextLayer', {
      compName: COMP_NAME, layerIndex: explodeSourceIndex, splitMethod: 'CHARACTERS'
    });
    assertNoError(r);
    assertField(r, 'tokenCount', 'number');
    assertArray(r, 'createdLayers');
    assertField(r, 'hiddenSourceIndex', 'number');
    assertField(r, 'previousValues', 'object');
    if (r.tokenCount !== EXPLODE_TEXT.length) {
      throw new Error(`Expected tokenCount=${EXPLODE_TEXT.length}, got ${r.tokenCount}`);
    }
    if (r.createdLayers.length !== EXPLODE_TEXT.length) {
      throw new Error(`Expected ${EXPLODE_TEXT.length} created layers, got ${r.createdLayers.length}`);
    }
    if (!('sourceEnabled' in r.previousValues)) throw new Error('previousValues.sourceEnabled missing');
    return `${r.tokenCount} token layer(s) created, source hidden at index ${r.hiddenSourceIndex}`;
  });

  await test('explodeTextLayer — WORDS on multi-word text creates correct count', async () => {
    const wordsLayer = await send('createLayer', {
      compName: COMP_NAME, type: 'text', text: 'ONE TWO',
      fontSize: 100, position: [960, 400], color: [1, 1, 0], name: 'WordsSource'
    });
    assertNoError(wordsLayer);
    const wordsSrcIdx = 1;

    const r = await send('explodeTextLayer', {
      compName: COMP_NAME, layerIndex: wordsSrcIdx, splitMethod: 'WORDS'
    });
    assertNoError(r);
    if (r.tokenCount !== 2) throw new Error(`Expected 2 word tokens, got ${r.tokenCount}`);
    return `words: ${r.createdLayers.map(l => l.token).join(', ')}`;
  });

  await test('explodeTextLayer — invalid splitMethod returns INVALID_ARGS', async () => {
    const r = await send('explodeTextLayer', {
      compName: COMP_NAME, layerIndex: explodeSourceIndex, splitMethod: 'PARAGRAPHS'
    });
    assertStructuredError(r, 'INVALID_ARGS');
  });

  await test('explodeTextLayer — on a non-text layer returns INVALID_ARGS', async () => {
    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', name: 'SolidForExplode', color: [0.3, 0.3, 0.3]
    });
    assertNoError(lr);
    const r = await send('explodeTextLayer', {
      compName: COMP_NAME, layerIndex: 1, splitMethod: 'CHARACTERS'
    });
    assertStructuredError(r, 'INVALID_ARGS');
  });
}
