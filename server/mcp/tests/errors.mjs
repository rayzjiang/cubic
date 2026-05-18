// errors.mjs — validates the structured error channel across handler categories.
//
// Confirms every error path returns { status:'error', errorCode, message }
// with a recognized errorCode drawn from the ERROR_CODES table in mcp-bridge.jsx.
// These run read-only (no --write needed) since all tests intentionally send bad args.

import { test, send, assertField, assertStructuredError, bold } from './helpers.mjs';

export async function run(ctx, opts) {
  console.log(bold('\nStructured Errors'));

  await test('unknown command → UNKNOWN_COMMAND', async () => {
    const r = await send('thisCommandDoesNotExist_cubicTest', {});
    await assertStructuredError(r, 'UNKNOWN_COMMAND');
  });

  await test('comp not found (getCurrentTime) → errorCode present', async () => {
    const r = await send('getCurrentTime', { compName: '__no_such_comp_errors_test__' });
    assertStructuredError(r);
    return `errorCode=${r.errorCode}`;
  });

  await test('getLayerProperty — comp not found → structured error', async () => {
    const r = await send('getLayerProperty', { compName: '__nope__', layerIndex: 1, propertyPath: ['Transform', 'Opacity'] });
    assertStructuredError(r);
    return `errorCode=${r.errorCode}`;
  });

  await test('getLayerProperty — invalid propertyPath (empty) → INVALID_ARGS', async () => {
    const r = await send('getLayerProperty', { compName: '__nope__', layerIndex: 1, propertyPath: [] });
    assertStructuredError(r);
    return `errorCode=${r.errorCode}`;
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
}
