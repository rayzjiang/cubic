#!/usr/bin/env node
// Dev-only preflight: ensure the RUNNING Node backend matches your source.
//
// The backend is spawned from build/serve.js (esbuild of this package's src/) and loads the cubic-ai
// brain at runtime from server/ai/build/index.js — neither is rebuilt by `npm run dev` or by tests.
// So editing prompt/rules.ts, command-params.ts, wsBridge.ts, etc. and re-running silently uses stale
// compiled code. This check (run via the unified scripts/preflight.mjs) computes the latest backend
// build id from source, queries the running backend for its baked id (backendInfo), and if they differ
// rebuilds BOTH trees (server/ai → serve.js, dependency order) and returns 1 so the dev re-runs. A
// matching backend (or no backend reachable) returns 0 (proceed).
//
// Not a runtime/product feature: real users get fresh code via the prod auto-updater.
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { computeBackendBuildIdFromSource } from './build-id.mjs';
import { green, yellow, dim, runNode, resolvePort, waitMs, queryBuildId } from './preflight-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/** @returns {Promise<number>} intended exit code: 0 = fresh/unverifiable (proceed), 1 = was stale (re-run). */
export async function run() {
  // 1. Latest backend build id straight from source (cheap hash over ae-bridge/src + ../ai/src; no build).
  const freshId = computeBackendBuildIdFromSource(root);

  // 2. Ask the running backend for the id baked into its bundle. No backend reachable → nothing to
  //    verify → proceed.
  const port = resolvePort();
  const runningId = await queryBuildId(port, waitMs(), 'backendInfo');

  // 3. Fresh / unverifiable → verdict + return 0. Definitely stale → rebuild both trees in dependency
  //    order (cubic-ai first so serve.js's runtime import is current, then serve.js re-bakes the id),
  //    then return 1. The app maps 1 → quit + re-run; the test `&&` chain stops so the dev re-runs.
  if (!runningId) {
    console.error(dim('[preflight] No Cubic backend reachable — skipping backend freshness check; continuing.'));
    return 0;
  }
  if (runningId === freshId) {
    console.error(green(`[preflight] ✓ Cubic backend is up to date (build ${freshId}) — continuing.`));
    return 0;
  }

  console.error(yellow(`\n[preflight] ⚠ Cubic backend is running STALE code (${runningId}, latest ${freshId}) — rebuilding…`));
  await runNode(path.join(root, '..', 'ai', 'scripts', 'build-ai.mjs'));
  await runNode(path.join(here, 'build-backend.mjs'));
  console.error(yellow('[preflight] ↻ Rebuilt server/ai + serve.js. Restart the backend (npm run dev / npm run serve / the app) and re-run your command — it will start on the fresh backend.\n'));
  return 1;
}

// Standalone entry (also importable by preflight.mjs without auto-running).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await run());
}
