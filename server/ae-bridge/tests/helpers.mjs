import WebSocket from 'ws';

// ─── Constants ────────────────────────────────────────────────────────────────

export const WS_URL    = `ws://127.0.0.1:${process.env.AE_MCP_PORT ?? 17923}`;
export const TIMEOUT_MS = 30_000;

// ─── ANSI ─────────────────────────────────────────────────────────────────────

export const green  = s => `\x1b[32m${s}\x1b[0m`;
export const red    = s => `\x1b[31m${s}\x1b[0m`;
export const yellow = s => `\x1b[33m${s}\x1b[0m`;
export const bold   = s => `\x1b[1m${s}\x1b[0m`;
export const dim    = s => `\x1b[2m${s}\x1b[0m`;

// ─── WebSocket connection (lazy, shared across all suites) ────────────────────

let _ws = null;

async function getWS() {
  if (_ws && _ws.readyState === WebSocket.OPEN) return _ws;
  _ws = new WebSocket(WS_URL);
  await new Promise((resolve, reject) => {
    _ws.once('open', resolve);
    _ws.once('error', err => reject(new Error(`WS connect failed: ${err.message}`)));
  });
  _ws.on('error', () => { _ws = null; });
  _ws.on('close', () => { _ws = null; });
  return _ws;
}

export async function closeConnection() {
  if (_ws) {
    _ws.close();
    _ws = null;
  }
}

export async function checkConnection(timeoutMs = 5000) {
  const ws = new WebSocket(WS_URL);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('WS connect timed out'));
    }, timeoutMs);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.close();
      resolve();
    });
    ws.once('error', err => {
      clearTimeout(timer);
      reject(new Error(`WS connect failed: ${err.message}`));
    });
  });
}

// ─── Bridge I/O ───────────────────────────────────────────────────────────────

export async function send(command, args = {}) {
  const ws = await getWS();
  const id = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error(`Timed out after ${TIMEOUT_MS}ms waiting for "${command}"`));
    }, TIMEOUT_MS);

    function handler(data) {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.id !== id) return;
      ws.removeListener('message', handler);
      clearTimeout(timer);
      if (msg.ok) {
        try { resolve(JSON.parse(msg.result)); }
        catch { resolve(msg.result); }
      } else {
        reject(new Error(msg.error ?? 'Unknown bridge error'));
      }
    }

    ws.on('message', handler);
    ws.send(JSON.stringify({ id, command, args }));
  });
}

// ─── Test runner ──────────────────────────────────────────────────────────────

export const results = [];

export async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    const note = await fn();
    console.log(green('PASS') + (note ? dim(` (${note})`) : ''));
    results.push({ name, ok: true });
    return true;
  } catch (e) {
    console.log(red('FAIL') + ` — ${e.message}`);
    results.push({ name, ok: false });
    return false;
  }
}

// ─── Assertions ───────────────────────────────────────────────────────────────

export function assertNoError(r) {
  if (r.status === 'error') throw new Error(`bridge error: ${r.message}`);
}

export function assertField(r, field, type) {
  if (!(field in r)) throw new Error(`response missing field "${field}"`);
  if (type !== undefined && typeof r[field] !== type) {
    throw new Error(`"${field}" expected ${type}, got ${typeof r[field]} (value: ${JSON.stringify(r[field])})`);
  }
}

export function assertArray(r, field) {
  if (!(field in r)) throw new Error(`response missing field "${field}"`);
  if (!Array.isArray(r[field])) throw new Error(`"${field}" expected array, got ${typeof r[field]}`);
}

export function assertValue(r, field, expected) {
  assertField(r, field);
  if (r[field] !== expected) {
    throw new Error(`"${field}" expected ${JSON.stringify(expected)}, got ${JSON.stringify(r[field])}`);
  }
}

export function assertIncludes(r, field, ...members) {
  assertArray(r, field);
  for (const m of members) {
    if (!r[field].includes(m)) {
      throw new Error(`"${field}" array does not include "${m}" — got: ${JSON.stringify(r[field])}`);
    }
  }
}

// ─── Structured error assertion ───────────────────────────────────────────────

export const KNOWN_ERROR_CODES = new Set([
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

export function assertStructuredError(r, expectedCode) {
  assertValue(r, 'status', 'error');
  assertField(r, 'errorCode', 'string');
  assertField(r, 'message', 'string');
  if (!KNOWN_ERROR_CODES.has(r.errorCode)) {
    throw new Error(`unrecognized errorCode "${r.errorCode}" — add it to ERROR_CODES in mcp-bridge.jsx`);
  }
  if (expectedCode && r.errorCode !== expectedCode) {
    throw new Error(`expected errorCode "${expectedCode}", got "${r.errorCode}"`);
  }
}

export function requireSetup(ok) {
  if (!ok) console.log(yellow('  Skipped — setup failed'));
  return ok;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export function printSummary(write) {
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const failedStr = failed > 0 ? red(`${failed} failed`) : `${failed} failed`;
  console.log(`\n${bold('Results:')} ${green(`${passed} passed`)}, ${failedStr}`);
  if (!write) console.log(dim('  Run with --write to also test write operations.'));
  return failed;
}
