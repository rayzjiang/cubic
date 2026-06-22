#!/usr/bin/env node
// Dev-only preflight: ensure the OPEN After Effects panel is running the latest handler bundle.
//
// The panel bakes its handler bundle into main.js at panel-open and holds it in memory, so editing
// a .jsx has no effect until the panel reloads. This check — run via the unified scripts/preflight.mjs
// at the top of `npm run dev` (the Electron app's main process) and the panel-requiring test scripts —
// computes the latest build id from source, and if the connected panel reports an older one, rebuilds
// the plugin + reloads the panel and returns 1 so the dev re-runs on fresh code. A matching panel
// (or no panel/backend) returns 0 (proceed).
//
// Not a runtime/product feature: real users get fresh code via the prod auto-updater.
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { computeBuildIdFromSource } from './build-id.mjs';
import { green, yellow, dim, runNode, resolvePort, waitMs, queryBuildId, sendControl } from './preflight-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/** @returns {Promise<number>} intended exit code: 0 = fresh/unverifiable (proceed), 1 = was stale (re-run). */
export async function run() {
  // 1. Compute the latest build id straight from source — NO build/install yet (cheap content hash).
  const freshId = computeBuildIdFromSource(root);

  // 2. Compare against the open panel. No backend/panel, or an old panel that can't report an id →
  //    nothing to verify → proceed without touching anything.
  const port = resolvePort();
  const panelId = await queryBuildId(port, waitMs(), 'workerInfo');

  // 3. Fresh (or unverifiable) → verdict + return 0, no rebuild/reload. Only when the panel is
  //    DEFINITELY stale do we rebuild + reinstall + reload it, then return 1 so the dev re-runs clean.
  if (!panelId) {
    console.error(dim('[preflight] No AE panel connected — skipping panel freshness check; continuing.'));
    return 0;
  }
  if (panelId === freshId) {
    console.error(green(`[preflight] ✓ Cubic panel bundle is up to date (build ${freshId}) — continuing.`));
    return 0;
  }

  console.error(yellow(`\n[preflight] ⚠ AE panel is running a STALE bundle (${panelId}, latest ${freshId}) — rebuilding + reloading…`));
  await runNode(path.join(here, 'build-cep-extension.mjs'));
  await runNode(path.join(root, 'install-cep-extension.js'));
  await sendControl(port, 'devReload');
  console.error(yellow('[preflight] ↻ Rebuilt + reloaded the panel. Re-run your command (npm run dev / the test) — it will start on the fresh bundle.\n'));
  return 1;
}

// Standalone entry (also importable by preflight.mjs without auto-running).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await run());
}
