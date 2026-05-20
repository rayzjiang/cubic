// ─── ANSI ─────────────────────────────────────────────────────────────────────

export const green  = s => `\x1b[32m${s}\x1b[0m`;
export const red    = s => `\x1b[31m${s}\x1b[0m`;
export const yellow = s => `\x1b[33m${s}\x1b[0m`;
export const bold   = s => `\x1b[1m${s}\x1b[0m`;
export const dim    = s => `\x1b[2m${s}\x1b[0m`;

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

export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function assertEqual(actual, expected, label = '') {
  if (actual !== expected) {
    throw new Error(`${label ? label + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertContains(str, substr, label = '') {
  if (!str.includes(substr)) {
    throw new Error(`${label ? label + ': ' : ''}expected string to contain "${substr}"\nGot: ${str.slice(0, 300)}`);
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export function printSummary() {
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const failedStr = failed > 0 ? red(`${failed} failed`) : `${failed} failed`;
  console.log(`\n${bold('Results:')} ${green(`${passed} passed`)}, ${failedStr}`);
  return failed;
}
