import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ─── Constants ────────────────────────────────────────────────────────────────

export const BRIDGE_DIR   = path.join(os.homedir(), '.ae-mcp-bridge');
export const COMMAND_FILE = path.join(BRIDGE_DIR, 'ae_command.json');
export const RESULT_FILE  = path.join(BRIDGE_DIR, 'ae_mcp_result.json');
export const POLL_MS      = 300;
export const TIMEOUT_MS   = 10_000;
// Each suite creates its own __MCP_TEST_<suite>__ comp for visual isolation.

// ─── ANSI ─────────────────────────────────────────────────────────────────────

export const green  = s => `\x1b[32m${s}\x1b[0m`;
export const red    = s => `\x1b[31m${s}\x1b[0m`;
export const yellow = s => `\x1b[33m${s}\x1b[0m`;
export const bold   = s => `\x1b[1m${s}\x1b[0m`;
export const dim    = s => `\x1b[2m${s}\x1b[0m`;

// ─── Bridge I/O ───────────────────────────────────────────────────────────────

// Strictly newer-than-last so two consecutive same-named commands don't collide.
let lastResultTime = Date.now();

export function resetResultTime() {
  lastResultTime = Date.now();
}

export async function send(command, args = {}) {
  const sentAt = Date.now();
  fs.writeFileSync(COMMAND_FILE, JSON.stringify(
    { command, args, status: 'pending', timestamp: new Date().toISOString() },
    null, 2
  ));

  const deadline = sentAt + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (fs.existsSync(RESULT_FILE)) {
      try {
        const stat = fs.statSync(RESULT_FILE);
        if (stat.mtimeMs > lastResultTime) {
          const parsed = JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8'));
          if (parsed._commandExecuted === command) {
            lastResultTime = stat.mtimeMs;
            return parsed;
          }
        }
      } catch { /* file not ready */ }
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  throw new Error(`Timed out after ${TIMEOUT_MS}ms waiting for "${command}"`);
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

// Throws if response has any error shape.
export function assertNoError(r) {
  if (r.error)           throw new Error(`bridge returned error: ${r.error}`);
  if (r.status === 'error') throw new Error(`bridge error: ${r.message}`);
  if (r.success === false)  throw new Error(`bridge returned success=false: ${r.message ?? r.error}`);
}

// Throws if field is missing or (optionally) the wrong JS type.
export function assertField(r, field, type) {
  if (!(field in r)) throw new Error(`response missing field "${field}"`);
  if (type !== undefined && typeof r[field] !== type) {
    throw new Error(`"${field}" expected ${type}, got ${typeof r[field]} (value: ${JSON.stringify(r[field])})`);
  }
}

// Throws if field is missing or not an array.
export function assertArray(r, field) {
  if (!(field in r)) throw new Error(`response missing field "${field}"`);
  if (!Array.isArray(r[field])) throw new Error(`"${field}" expected array, got ${typeof r[field]}`);
}

// Throws if field value !== expected (strict equality).
export function assertValue(r, field, expected) {
  assertField(r, field);
  if (r[field] !== expected) {
    throw new Error(`"${field}" expected ${JSON.stringify(expected)}, got ${JSON.stringify(r[field])}`);
  }
}

// Throws if field array does not include every member of expected.
export function assertIncludes(r, field, ...members) {
  assertArray(r, field);
  for (const m of members) {
    if (!r[field].includes(m)) {
      throw new Error(`"${field}" array does not include "${m}" — got: ${JSON.stringify(r[field])}`);
    }
  }
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
