// playhead.mjs — tests for getCurrentTime + setCurrentTime in compositions.jsx
//
// Covers:
//   getCurrentTime  (R — playhead time in seconds + frames)
//   setCurrentTime  (U — move playhead by timeInSeconds or timeInFrames; clamps silently)
//
// Visual verification (after --write):
//   No persistent comp left — playhead tests are in-memory only.
//   __MCP_TEST_playhead__ comp is created and cleaned up within the suite.

import {
  test, send,
  assertNoError, assertField, assertValue,
  bold, yellow
} from './helpers.mjs';

const COMP_NAME = '__MCP_TEST_playhead__';

export async function run(ctx, opts) {
  console.log(bold('\nPlayhead Control'));

  // ── Read-only: getCurrentTime on active comp ───────────────────────────────

  await test('getCurrentTime — returns success on active comp', async () => {
    const r = await send('getCurrentTime', {});
    if (r.status === 'error') throw new Error(`bridge error: ${r.message}`);
    // Either returns a real time or the "no active comp" response
    if (r.activeComp === null) return 'no active comp (ok)';
    assertField(r, 'timeInSeconds');
    assertField(r, 'frame');
    assertField(r, 'frameRate');
    return `${r.timeInSeconds}s`;
  });

  if (!opts.write) return;

  // ── Setup ─────────────────────────────────────────────────────────────────

  const setupOk = await test('setup — create playhead test comp', async () => {
    const cr = await send('createComposition', {
      name: COMP_NAME, width: 1920, height: 1080, frameRate: 30, duration: 10, pixelAspect: 1
    });
    assertField(cr, 'composition', 'object');
    return 'comp created (10s @ 30fps)';
  });

  if (!setupOk) {
    console.log(yellow('  Playhead tests skipped — setup failed'));
    return;
  }

  // ── setCurrentTime / getCurrentTime round-trips ────────────────────────────

  await test('setCurrentTime — move to 3s by timeInSeconds', async () => {
    const r = await send('setCurrentTime', { compName: COMP_NAME, timeInSeconds: 3 });
    assertNoError(r);
    assertValue(r, 'compName', COMP_NAME);
    if (Math.abs(r.timeInSeconds - 3) > 0.02) {
      throw new Error(`Expected ≈3s, got ${r.timeInSeconds}`);
    }
    return `set to ${r.timeInSeconds}s`;
  });

  await test('getCurrentTime — reads back 3s', async () => {
    const r = await send('getCurrentTime', { compName: COMP_NAME });
    assertNoError(r);
    if (Math.abs(r.timeInSeconds - 3) > 0.02) {
      throw new Error(`Expected ≈3s, got ${r.timeInSeconds}`);
    }
  });

  await test('setCurrentTime — move to frame 60 (= 2s at 30fps)', async () => {
    const r = await send('setCurrentTime', { compName: COMP_NAME, timeInFrames: 60 });
    assertNoError(r);
    if (Math.abs(r.timeInSeconds - 2) > 0.04) {
      throw new Error(`Expected ≈2s (frame 60 @ 30fps), got ${r.timeInSeconds}`);
    }
    if (Math.abs(r.frame - 60) > 1) throw new Error(`Expected frame ≈ 60, got ${r.frame}`);
  });

  await test('setCurrentTime — negative time clamps to 0', async () => {
    const r = await send('setCurrentTime', { compName: COMP_NAME, timeInSeconds: -5 });
    assertNoError(r);
    if (r.timeInSeconds < 0) throw new Error(`Expected time ≥ 0, got ${r.timeInSeconds}`);
  });

  await test('setCurrentTime — time beyond duration clamps to last frame', async () => {
    const r = await send('setCurrentTime', { compName: COMP_NAME, timeInSeconds: 999 });
    assertNoError(r);
    // Should be <= 10s (the comp duration)
    if (r.timeInSeconds > 10) throw new Error(`Expected time ≤ 10s, got ${r.timeInSeconds}`);
  });

  await test('setCurrentTime — missing both timeInSeconds and timeInFrames returns error', async () => {
    const r = await send('setCurrentTime', { compName: COMP_NAME });
    assertValue(r, 'status', 'error');
    if (!r.message || !r.message.includes('timeInSeconds')) {
      throw new Error('Expected error mentioning timeInSeconds');
    }
  });
}
