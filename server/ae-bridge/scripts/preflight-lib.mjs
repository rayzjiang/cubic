// Shared helpers for the dev preflight scripts (preflight-panel.mjs + preflight-backend.mjs +
// preflight.mjs). Dev-only tooling — see those files / CLAUDE.md for the why.
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import WebSocket from 'ws';

// Color helpers so the verdict line is easy to spot in a noisy dev log.
const paint = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
export const green = (s) => paint('1;32', s);
export const yellow = (s) => paint('1;33', s);
export const dim = (s) => paint('2', s);

/** Run a node entrypoint to completion (not via npm, so it works under Electron's ELECTRON_RUN_AS_NODE). */
export function runNode(scriptPath, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [scriptPath], {
      cwd: cwd ?? path.dirname(scriptPath),
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(scriptPath)} → exit ${code}`))));
  });
}

/** The backend WS connection ({port, token}) — published to ~/.cubic/conn.json on boot. Returns
 *  {port:0, token:''} when no backend is up, so a query below simply fails to connect (→ null). */
export function resolveConn() {
  try {
    const { port, token } = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.cubic', 'conn.json'), 'utf8'));
    if (typeof port === 'number' && typeof token === 'string') return { port, token };
  } catch { /* no backend up yet */ }
  return { port: 0, token: '' };
}

/** How long to wait for a panel/backend to (re)connect before giving up. Tests run with things already
 *  connected (3s default returns instantly); the app sets a longer window (CUBIC_PREFLIGHT_WAIT_MS)
 *  because the panel/backend reconnect a few seconds after launch. */
export function waitMs() {
  return parseInt(process.env.CUBIC_PREFLIGHT_WAIT_MS ?? '', 10) || 3000;
}

/** Ask the backend for a build id over a `{type}` query (reply `{type, buildId}`). Retries briefly so
 *  a panel/backend reconnecting right after launch is seen. Returns the id, or null if none/unreachable. */
export async function queryBuildId(port, deadlineMs, type, token) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    const id = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; try { ws.close(); } catch { /* ignore */ } resolve(v); } };
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'hello', token, role: 'dev' })); // authenticate first
        ws.send(JSON.stringify({ type }));
      });
      ws.on('message', (d) => { try { const m = JSON.parse(d.toString()); if (m.type === type) finish(m.buildId ?? null); } catch { /* ignore */ } });
      ws.on('error', () => finish(null));
      setTimeout(() => finish(null), 600);
    });
    if (id) return id;            // connected + reported an id
    await new Promise((r) => setTimeout(r, 300)); // else wait for a (re)connect
  }
  return null;
}

/** Fire a one-way control message at the backend (e.g. devReload) and close. */
export async function sendControl(port, type, token) {
  await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const done = () => { try { ws.close(); } catch { /* ignore */ } resolve(); };
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', token, role: 'dev' })); // authenticate first
      ws.send(JSON.stringify({ type }));
      setTimeout(done, 150);
    });
    ws.on('error', done);
  });
}
