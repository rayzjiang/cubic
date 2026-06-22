#!/usr/bin/env node
// Dev-only preflight: ensure the OPEN After Effects panel is running the latest handler bundle.
//
// The panel bakes its handler bundle into main.js at panel-open and holds it in memory, so editing
// a .jsx has no effect until the panel reloads. This script — run at the top of `npm run dev` (the
// Electron app's main process) and the panel-requiring test scripts — rebuilds the plugin from
// source, and if the connected panel is running an older bundle, reloads it and EXITS non-zero so
// the dev re-runs on fresh code. A matching panel (or no panel/backend) exits 0 (proceed).
//
// Not a runtime/product feature: real users get fresh code via the prod auto-updater.
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/** Run a node entrypoint to completion (not via npm, so it works under Electron's ELECTRON_RUN_AS_NODE). */
function runNode(scriptPath) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [scriptPath], {
      cwd: root, stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(scriptPath)} → exit ${code}`))));
  });
}

/** Ask the backend for the connected panel's build id. Retries briefly so a panel reconnecting right
 *  after the backend starts (the `npm run dev` case) is seen. Returns the id, or null if none/unreachable. */
async function queryPanelBuildId(port, deadlineMs) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    const id = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; try { ws.close(); } catch { /* ignore */ } resolve(v); } };
      ws.on('open', () => ws.send(JSON.stringify({ type: 'workerInfo' })));
      ws.on('message', (d) => { try { const m = JSON.parse(d.toString()); if (m.type === 'workerInfo') finish(m.buildId ?? null); } catch { /* ignore */ } });
      ws.on('error', () => finish(null));
      setTimeout(() => finish(null), 600);
    });
    if (id) return id;            // panel connected + reported an id
    await new Promise((r) => setTimeout(r, 300)); // else wait for the panel to (re)connect
  }
  return null;
}

async function sendDevReload(port) {
  await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const done = () => { try { ws.close(); } catch { /* ignore */ } resolve(); };
    ws.on('open', () => { ws.send(JSON.stringify({ type: 'devReload' })); setTimeout(done, 150); });
    ws.on('error', done);
  });
}

// 1. Rebuild + reinstall from source so dist (and the CEP folder) hold the latest bundle.
await runNode(path.join(here, 'build-cep-extension.mjs'));
await runNode(path.join(root, 'install-cep-extension.js'));

const freshId = fs.readFileSync(path.join(root, 'cep-extension', 'dist', 'build-id'), 'utf8').trim();

// 2. Compare against the open panel. No backend/panel, or an old panel that can't report an id →
//    nothing to verify, proceed.
let port = 17923;
try { port = parseInt(fs.readFileSync(path.join(os.homedir(), '.cubic', 'port'), 'utf8').trim(), 10) || 17923; } catch { /* default */ }
const panelId = await queryPanelBuildId(port, 3000);

if (panelId && panelId !== freshId) {
  await sendDevReload(port);
  console.error(`\n[preflight] AE panel was running a stale bundle (${panelId}, latest ${freshId}) — rebuilt + reloaded it.`);
  console.error('[preflight] Re-run your command (npm run dev / the test) — it will start on the fresh bundle.\n');
  process.exit(1);
}

process.exit(0);
