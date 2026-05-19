// errors.mjs — validates the structured error channel across handler categories.
//
// Confirms every error path returns { status:'error', errorCode, message }
// with a recognized errorCode drawn from the ERROR_CODES table in mcp-bridge.jsx.
//
// Read-only tests (always run): UNKNOWN_COMMAND, COMP_NOT_FOUND, INVALID_ARGS via batch.
// Write-gated tests (--write): LAYER_NOT_FOUND, LAYER_INDEX_OOB, TIME_OUT_OF_RANGE,
//   PROPERTY_NOT_FOUND, and INVALID_ARGS via empty propertyPath — these need a real
//   comp + layer to exercise the post-resolution validation paths.
//
// Cleanup: the __MCP_TEST_errors__ comp is removed by test-integration.mjs's
// cleanupTestComps() (matches __MCP_TEST_* prefix).
//
// Deliberately not asserted by name:
//   RENDER_FAILED     — only fires when AE's "Allow Scripts to Write Files" preference
//                       is disabled (env-dependent), not from any bad-arg shape.
//   HANDLER_UNCAUGHT  — only reachable when a batch sub-handler throws raw (no .code);
//                       can't be triggered from outside the handler code.
//   INTERNAL_ERROR    — catch-all fallback for JS-level exceptions; brittle to provoke.

import { test, send, assertField, assertNoError, assertStructuredError, requireSetup, bold, yellow } from './helpers.mjs';

const COMP_NAME = '__MCP_TEST_errors__';

export async function run(ctx, opts) {
  console.log(bold('\nStructured Errors'));

  await test('unknown command → UNKNOWN_COMMAND', async () => {
    const r = await send('thisCommandDoesNotExist_cubicTest', {});
    assertStructuredError(r, 'UNKNOWN_COMMAND');
  });

  await test('getCurrentTime — comp not found → COMP_NOT_FOUND', async () => {
    const r = await send('getCurrentTime', { compName: '__no_such_comp_errors_test__' });
    assertStructuredError(r, 'COMP_NOT_FOUND');
  });

  await test('getLayerProperty — comp not found → COMP_NOT_FOUND', async () => {
    const r = await send('getLayerProperty', { compName: '__nope__', layerIndex: 1, propertyPath: ['Transform', 'Opacity'] });
    assertStructuredError(r, 'COMP_NOT_FOUND');
  });

  await test('batch — missing commands array → INVALID_ARGS', async () => {
    const r = await send('batch', {});
    assertStructuredError(r, 'INVALID_ARGS');
  });

  await test('batch — entry missing command field → INVALID_ARGS per entry', async () => {
    const r = await send('batch', { commands: [{ args: {} }] });
    // outer response: status:'error' + results array
    assertField(r, 'results');
    if (!r.results[0]) throw new Error('no results array');
    assertStructuredError(r.results[0], 'INVALID_ARGS');
  });

  await test('batch — nested batch → INVALID_ARGS per entry', async () => {
    const r = await send('batch', { commands: [{ command: 'batch', args: { commands: [] } }] });
    assertField(r, 'results');
    assertStructuredError(r.results[0], 'INVALID_ARGS');
  });

  // ── Write-gated negative coverage ─────────────────────────────────────────
  // Below tests need a real comp + layer so the handler reaches the
  // post-resolution validation paths (layer index OOB, time out of range, etc.)
  // instead of bailing at COMP_NOT_FOUND first.

  if (!opts.write) {
    console.log(yellow('  Skipping write-gated negative tests — run with --write to enable.'));
    return;
  }

  const setupOk = await test('setup — create errors test comp + solid', async () => {
    const cr = await send('createComposition', {
      name: COMP_NAME, width: 320, height: 240, frameRate: 30, duration: 2, pixelAspect: 1
    });
    assertField(cr, 'composition', 'object');

    const lr = await send('createLayer', {
      compName: COMP_NAME, type: 'solid', name: 'Error Test Solid', color: [0.5, 0.5, 0.5]
    });
    assertNoError(lr);
  });
  if (!requireSetup(setupOk)) return;

  await test('getLayerProperty — layer name not found → LAYER_NOT_FOUND', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerName: '__no_such_layer_in_errors__',
      propertyPath: ['Transform', 'Opacity']
    });
    assertStructuredError(r, 'LAYER_NOT_FOUND');
  });

  await test('getLayerProperty — layerIndex out of bounds → LAYER_INDEX_OOB', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: 9999, propertyPath: ['Transform', 'Opacity']
    });
    assertStructuredError(r, 'LAYER_INDEX_OOB');
  });

  await test('saveFrameToPng — time past duration → TIME_OUT_OF_RANGE', async () => {
    const r = await send('saveFrameToPng', { compName: COMP_NAME, timeInSeconds: 9999 });
    assertStructuredError(r, 'TIME_OUT_OF_RANGE');
  });

  await test('getLayerProperty — empty propertyPath → INVALID_ARGS', async () => {
    const r = await send('getLayerProperty', { compName: COMP_NAME, layerIndex: 1, propertyPath: [] });
    assertStructuredError(r, 'INVALID_ARGS');
  });

  await test('getLayerProperty — unresolvable propertyPath → PROPERTY_NOT_FOUND', async () => {
    const r = await send('getLayerProperty', {
      compName: COMP_NAME, layerIndex: 1, propertyPath: ['Transform', '__DoesNotExist__']
    });
    assertStructuredError(r, 'PROPERTY_NOT_FOUND');
  });
}
