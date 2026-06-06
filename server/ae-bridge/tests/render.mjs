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
//
// Flake note: AE's renderer flushes PNGs asynchronously, so a freshly-rendered file may
// not be on disk (or may be 0 bytes) the instant saveFrameToPng returns. Disk-backed
// checks go through renderToDisk(), which retries the render once — mirroring the
// retryable RENDER_FAILED contract that index.ts/the agent loop use in production.

import { test, send, assertNoError, assertField, assertValue, assertStructuredError, requireSetup, bold, yellow } from './helpers.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const FRAMES_DIR = join(homedir(), '.cubic', 'frames');

const COMP_NAME = '__MCP_TEST_render__';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Inspect the rendered file on disk. Returns an error string if the PNG is missing,
// empty, or malformed — otherwise null. AE's renderer flushes asynchronously, so the
// file may not have landed (or may be 0 bytes) the instant saveFrameToPng returns.
function pngProblem(path, { checkHeader = false } = {}) {
  if (!path) return 'no path returned';
  if (!existsSync(path)) return `file missing: ${path}`;
  if (!checkHeader) return null;
  const buf = readFileSync(path);
  if (buf.length < PNG_MAGIC.length) {
    return `PNG file is ${buf.length} bytes — AE render pipeline did not flush. Path: ${path}`;
  }
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (buf[i] !== PNG_MAGIC[i]) {
      return `PNG header byte ${i} = 0x${buf[i].toString(16).padStart(2, '0')}, expected 0x${PNG_MAGIC[i].toString(16).padStart(2, '0')}`;
    }
  }
  return null;
}

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
    const s = await send('createLayer', { compName: COMP_NAME, type: 'solid', name: 'bg', color: [1, 0, 0] });
    assertNoError(s);
  });
  if (!requireSetup(setupOk)) return;

  ctx.renderPaths = ctx.renderPaths ?? [];

  // Render a frame and confirm the bytes actually landed on disk, retrying ONCE on a
  // missing/empty/malformed file. AE's renderer flushes the PNG asynchronously — the
  // handler returns success before the bytes are guaranteed on disk (compositions.jsx
  // intentionally skips file.exists; ExtendScript's File stat is stale). In production
  // index.ts validates the PNG and returns a retryable RENDER_FAILED that the agent loop
  // retries once. The WS test bridge bypasses index.ts, so we mirror that same contract
  // here — re-rendering rather than sleeping/polling (a not-yet-flushed file is expected,
  // not a bug). The response-field assertions in each test are deterministic and stay
  // outside this helper.
  async function renderToDisk(args, { checkHeader = false } = {}) {
    let r;
    for (let attempt = 0; attempt < 2; attempt++) {
      r = await send('saveFrameToPng', args);
      if (r.path) ctx.renderPaths.push(r.path);  // track before assertions so failures don't leak
      assertNoError(r);
      if (!pngProblem(r.path, { checkHeader })) return r;
      // file not flushed yet — re-render once (mirrors agent retry on RENDER_FAILED)
    }
    throw new Error(pngProblem(r.path, { checkHeader }) + ' (after 1 retry)');
  }

  await test('render — default time returns PNG on disk', async () => {
    const defaultPath = join(FRAMES_DIR, `__MCP_TEST_render_default_${Date.now()}.png`);
    const r = await renderToDisk({ compName: COMP_NAME, outputPath: defaultPath });
    assertField(r, 'path', 'string');
    assertValue(r, 'width', 320);
    assertValue(r, 'height', 240);
    assertField(r, 'timeInSeconds', 'number');
    assertField(r, 'frame', 'number');
    assertField(r, 'comp', 'object');
    return r.path;
  });

  await test('render — explicit timeInSeconds reflects in response', async () => {
    const explicitPath = join(FRAMES_DIR, `__MCP_TEST_render_explicit_${Date.now()}.png`);
    const r = await renderToDisk({ compName: COMP_NAME, timeInSeconds: 1.0, outputPath: explicitPath });
    assertValue(r, 'timeInSeconds', 1.0);
    assertValue(r, 'frame', 30);
    return `frame=${r.frame}`;
  });

  await test('render — custom outputPath writes to specified location', async () => {
    const custom = join(FRAMES_DIR, `__MCP_TEST_render_custom_${Date.now()}.png`);
    const r = await renderToDisk({ compName: COMP_NAME, outputPath: custom });
    if (r.path !== custom && r.path !== custom + '.png') {
      throw new Error(`Expected path "${custom}", got "${r.path}"`);
    }
    return r.path;
  });

  await test('render — PNG magic header validates file on disk is a valid PNG', async () => {
    const hdrPath = join(FRAMES_DIR, `__MCP_TEST_render_pnghdr_${Date.now()}.png`);
    const r = await renderToDisk({ compName: COMP_NAME, outputPath: hdrPath }, { checkHeader: true });
    const buf = readFileSync(r.path);
    // The MCP image content block (inline base64) is attached by index.ts and requires
    // testing through the full MCP stack — not verifiable via the WebSocket-only test bridge.
    return `valid PNG header confirmed (${buf.length} bytes)`;
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
