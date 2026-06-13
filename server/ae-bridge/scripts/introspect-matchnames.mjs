// Dev tool: ask live AE for the real matchName + properties of candidate EFFECT matchNames, and
// write the ground-truth fixture the static matchname guard checks our EFFECT_DICT against.
//
// Usage (AE open + MCP Bridge panel connected, with the current handler bundle loaded):
//   node scripts/introspect-matchnames.mjs
//
// Connects to the WS bridge exactly like server/ai's BridgeClient and runs the internal
// `introspectMatchNames` command. Effect-only: text/shape matchNames live in different property
// groups and are covered by their live integration tests + the guard's reviewed allowlist.

import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '..', 'tests', 'fixtures', 'ae-matchnames.json');
const PORT_FILE = path.join(os.homedir(), '.ae-mcp-bridge', 'port');
const PORTS = [17923, 17924, 17925, 17926, 17927];

// Every EFFECT matchName our code hardcodes (EFFECT_DICT), plus the two known-wrong guesses so the
// fixture documents that they are NOT real (valid:false) — proof the guard would have caught them.
const CANDIDATES = [
  'ADBE Gaussian Blur 2', 'ADBE Motion Blur', 'ADBE Color Balance (HLS)',
  'ADBE Brightness & Contrast 2', 'ADBE CurvesCustom', 'ADBE Glo2',
  'ADBE Drop Shadow', 'ADBE Vibrance',
  // known-wrong (should report valid:false):
  'ADBE Glow', 'ADBE Directional Blur',
];

function candidatePorts() {
  try {
    const p = parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim(), 10);
    if (p) return [p, ...PORTS.filter((x) => x !== p)];
  } catch { /* no file */ }
  return PORTS;
}

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', () => reject(new Error('no bridge on ' + port)));
  });
}

async function findBridge() {
  for (const port of candidatePorts()) {
    try { return await connect(port); } catch { /* next */ }
  }
  throw new Error('Could not reach the AE WS bridge — is AE open with the MCP Bridge panel connected?');
}

function call(ws, command, args) {
  const id = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(command + ' timed out (10s)')), 10000);
    ws.on('message', function onMsg(data) {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.off('message', onMsg);
      if (!msg.ok) return reject(new Error(msg.error ?? 'bridge error'));
      let parsed;
      try { parsed = JSON.parse(msg.result); } catch { parsed = msg.result; }
      resolve(parsed);
    });
    ws.send(JSON.stringify({ id, command, args }));
  });
}

const ws = await findBridge();
console.log('Connected to AE bridge. Probing', CANDIDATES.length, 'effect matchNames…\n');
const res = await call(ws, 'introspectMatchNames', { matchNames: CANDIDATES });
ws.close();

if (res.status !== 'success') {
  console.error('introspectMatchNames failed:', JSON.stringify(res, null, 2));
  process.exit(1);
}

const results = res.results;
for (const mn of CANDIDATES) {
  const r = results[mn] || { valid: false, error: 'no result' };
  const tag = r.valid ? 'OK  ' : 'BAD ';
  const detail = r.valid ? `-> ${r.canonicalMatchName} ("${r.displayName}")` : `(${r.error || 'rejected'})`;
  console.log(`  ${tag} ${mn} ${detail}`);
}

fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
fs.writeFileSync(FIXTURE, JSON.stringify({ effects: results }, null, 2) + '\n');
console.log('\nWrote fixture ->', path.relative(path.join(__dirname, '..'), FIXTURE));
