// render.mjs — tests for saveFrameToPng in compositions.jsx
//
// Covers: render at default time (C), re-render at explicit time, custom outputPath,
//         out-of-range time error, missing comp error.
//
// Visual verification (after --write):
//   Open ~/.cubic/frames/ in Finder — 2 PNG files (default path renders) should
//   show a solid red rectangle at 320×240. The custom-path PNG goes to /tmp and
//   is verified on disk but not left for inspection.
//
// Cleanup: --cleanup removes all ctx.renderPaths entries from disk.

import { test, send, assertNoError, assertField, assertValue, assertStructuredError, requireSetup, bold, yellow } from './helpers.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const FRAMES_DIR = join(homedir(), '.cubic', 'frames');

const COMP_NAME = '__MCP_TEST_render__';

export async function run(ctx, opts) {
  console.log(bold('\nRender'));

  if (!opts.write) {
    console.log(yellow('  Render tests require --write (creates a test comp + renders frames)'));
    return;
  }

  const setupOk = await test('setup — create comp + red solid', async () => {
    const c = await send('createComposition', { name: COMP_NAME, width: 320, height: 240, frameRate: 30, duration: 2, pixelAspect: 1 });
    assertNoError(c);
    assertField(c, 'composition', 'object');
    const s = await send('createSolidLayer', { compName: COMP_NAME, name: 'bg', color: [1, 0, 0] });
    assertNoError(s);
  });
  if (!requireSetup(setupOk)) return;

  ctx.renderPaths = ctx.renderPaths ?? [];

  await test('render — default time returns PNG on disk', async () => {
    const defaultPath = join(FRAMES_DIR, `__MCP_TEST_render_default_${Date.now()}.png`);
    const r = await send('saveFrameToPng', { compName: COMP_NAME, outputPath: defaultPath });
    if (r.path) ctx.renderPaths.push(r.path);  // track before assertions so failures don't leak
    assertNoError(r);
    assertField(r, 'path', 'string');
    assertValue(r, 'width', 320);
    assertValue(r, 'height', 240);
    assertField(r, 'timeInSeconds', 'number');
    assertField(r, 'frame', 'number');
    assertField(r, 'comp', 'object');
    if (!existsSync(r.path)) throw new Error(`file missing: ${r.path}`);
    return r.path;
  });

  await test('render — explicit timeInSeconds reflects in response', async () => {
    const explicitPath = join(FRAMES_DIR, `__MCP_TEST_render_explicit_${Date.now()}.png`);
    const r = await send('saveFrameToPng', { compName: COMP_NAME, timeInSeconds: 1.0, outputPath: explicitPath });
    if (r.path) ctx.renderPaths.push(r.path);
    assertNoError(r);
    assertValue(r, 'timeInSeconds', 1.0);
    assertValue(r, 'frame', 30);
    if (!existsSync(r.path)) throw new Error(`file missing at explicit time: ${r.path}`);
    return `frame=${r.frame}`;
  });

  await test('render — custom outputPath writes to specified location', async () => {
    const custom = join(FRAMES_DIR, `__MCP_TEST_render_custom_${Date.now()}.png`);
    const r = await send('saveFrameToPng', { compName: COMP_NAME, outputPath: custom });
    if (r.path) ctx.renderPaths.push(r.path);
    assertNoError(r);
    if (r.path !== custom && r.path !== custom + '.png') {
      throw new Error(`Expected path "${custom}", got "${r.path}"`);
    }
    if (!existsSync(r.path)) throw new Error('custom-path PNG not found on disk');
    return r.path;
  });

  await test('render — time past duration returns structured error', async () => {
    const r = await send('saveFrameToPng', { compName: COMP_NAME, timeInSeconds: 999 });
    assertStructuredError(r);
    if (r.errorCode !== 'RENDER_FAILED' && r.errorCode !== 'TIME_OUT_OF_RANGE') {
      throw new Error(`unexpected errorCode "${r.errorCode}" (expected RENDER_FAILED or TIME_OUT_OF_RANGE)`);
    }
  });

  await test('render — missing comp returns structured error', async () => {
    const r = await send('saveFrameToPng', { compName: '__no_such_comp_render_test__' });
    assertStructuredError(r);
  });
}
