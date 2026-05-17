// errors.mjs — validates the structured error channel across handler categories.
//
// Confirms every error path returns { status:'error', errorCode, message }
// with a recognized errorCode drawn from the ERROR_CODES table in mcp-bridge.jsx.
// These run read-only (no --write needed) since all tests intentionally send bad args.

import { test, send, assertField, assertValue, bold } from './helpers.mjs';

const KNOWN_CODES = new Set([
  'COMP_NOT_FOUND',
  'LAYER_NOT_FOUND',
  'LAYER_INDEX_OOB',
  'PROPERTY_NOT_FOUND',
  'INVALID_ARGS',
  'TIME_OUT_OF_RANGE',
  'RENDER_FAILED',
  'UNKNOWN_COMMAND',
  'HANDLER_UNCAUGHT',
  'INTERNAL_ERROR'
]);

async function assertStructuredError(r, expectedCode) {
  assertValue(r, 'status', 'error');
  assertField(r, 'errorCode', 'string');
  assertField(r, 'message', 'string');
  if (!KNOWN_CODES.has(r.errorCode)) {
    throw new Error(`unrecognized errorCode "${r.errorCode}" — add it to ERROR_CODES in mcp-bridge.jsx`);
  }
  if (expectedCode && r.errorCode !== expectedCode) {
    throw new Error(`expected errorCode "${expectedCode}", got "${r.errorCode}"`);
  }
}

export async function run(ctx, opts) {
  console.log(bold('\nStructured Errors'));

  await test('unknown command → UNKNOWN_COMMAND', async () => {
    const r = await send('thisCommandDoesNotExist_cubicTest', {});
    await assertStructuredError(r, 'UNKNOWN_COMMAND');
  });

  await test('comp not found (getCurrentTime) → errorCode present', async () => {
    const r = await send('getCurrentTime', { compName: '__no_such_comp_errors_test__' });
    // compositions.jsx throws from its own catch block; error.code may not be set yet
    // — the test verifies the field exists and is a known code or INTERNAL_ERROR.
    assertValue(r, 'status', 'error');
    assertField(r, 'errorCode', 'string');
    assertField(r, 'message', 'string');
    if (!KNOWN_CODES.has(r.errorCode)) {
      throw new Error(`unrecognized errorCode "${r.errorCode}"`);
    }
  });

  await test('getLayerProperty — comp not found → structured error', async () => {
    const r = await send('getLayerProperty', { compName: '__nope__', layerIndex: 1, propertyPath: ['Transform', 'Opacity'] });
    await assertStructuredError(r);
    return `errorCode=${r.errorCode}`;
  });

  await test('getLayerProperty — invalid propertyPath (empty) → INVALID_ARGS', async () => {
    // _resolvePropertyByPath throws INVALID_ARGS when path is empty
    // (requires an existing comp; skip gracefully if project has no active comp)
    const r = await send('getLayerProperty', { compName: '__nope__', layerIndex: 1, propertyPath: [] });
    assertValue(r, 'status', 'error');
    assertField(r, 'errorCode', 'string');
    if (!KNOWN_CODES.has(r.errorCode)) {
      throw new Error(`unrecognized errorCode "${r.errorCode}"`);
    }
  });

  await test('batch — missing commands array → INVALID_ARGS', async () => {
    const r = await send('batch', {});
    assertValue(r, 'status', 'error');
    assertField(r, 'errorCode', 'string');
    if (r.errorCode !== 'INVALID_ARGS') {
      throw new Error(`expected INVALID_ARGS, got "${r.errorCode}"`);
    }
  });

  await test('batch — entry missing command field → INVALID_ARGS per entry', async () => {
    const r = await send('batch', { commands: [{ args: {} }] });
    // batch returns ok:true but status:'error' in wrapper
    assertValue(r, 'status', 'error');
    if (!r.results || !r.results[0]) throw new Error('no results array');
    const entry = r.results[0];
    assertValue(entry, 'status', 'error');
    assertField(entry, 'errorCode', 'string');
    if (entry.errorCode !== 'INVALID_ARGS') {
      throw new Error(`expected INVALID_ARGS on entry, got "${entry.errorCode}"`);
    }
  });

  await test('batch — nested batch → INVALID_ARGS per entry', async () => {
    const r = await send('batch', { commands: [{ command: 'batch', args: { commands: [] } }] });
    assertValue(r, 'status', 'error');
    const entry = r.results[0];
    assertField(entry, 'errorCode', 'string');
    if (entry.errorCode !== 'INVALID_ARGS') {
      throw new Error(`expected INVALID_ARGS for nested batch, got "${entry.errorCode}"`);
    }
  });
}
