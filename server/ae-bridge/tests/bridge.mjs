// bridge.mjs — WS bridge transport (happy path) + allowlist drift guard
//
// Two scopes:
//   1. Happy-path WS round-trips for read-only allowlisted commands
//      (getProjectInfo, listCompositions). Verifies the Node ↔ CEP ↔ AE chain.
//   2. Static-file diff between the `COMMANDS` allowlist (src/commands.ts —
//      the single source `src/index.ts` derives its allowlist from) and the
//      `_dispatchSwitch` cases (src/scripts/mcp-bridge.jsx). Catches new
//      handlers added without an allowlist entry, and stale allowlist
//      entries that no longer match a dispatch case.
//
// Known gap: the typed MCP tool surface (runScript, getHelp, runBridgeTest,
// typed createComposition, testAnimation, getResults) is not reachable via
// the WS bridge used by send(). Covering it would require an MCP-SDK client
// harness — deferred.
//
// All tests are read-only (no --write needed).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  test, send,
  assertNoError, assertField, assertArray,
  bold
} from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Internal-only handlers — present in _dispatchSwitch but deliberately
// absent from allowedScripts because their work is exposed via the
// consolidated createLayer({type:...}) dispatcher (server/ae-bridge/CLAUDE.md
// "broad parameterized tools" rule).
const EXPECTED_INTERNAL_ONLY = [
  'createCamera',
  'createLightLayer',
  'createNullLayer',
  'createShapeLayer',
  'createSolidLayer',
  'createTextLayer'
];

function _extractAllowedScripts(src) {
  // The allowlist is the COMMANDS array in src/commands.ts (the single source of
  // truth that src/index.ts enforces via `COMMANDS.includes(script)`).
  const m = src.match(/COMMANDS[^=]*=\s*\[([\s\S]*?)\]/);
  if (!m) throw new Error('Could not locate the `COMMANDS = [...]` array in src/commands.ts');
  const out = [];
  const re = /["']([A-Za-z_][A-Za-z0-9_]*)["']/g;
  let hit;
  while ((hit = re.exec(m[1])) !== null) out.push(hit[1]);
  return out;
}

function _extractDispatchCases(src) {
  const m = src.match(/function _dispatchSwitch\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  if (!m) throw new Error('Could not locate `_dispatchSwitch` in src/scripts/mcp-bridge.jsx');
  const out = [];
  const re = /case\s+"([^"]+)"\s*:/g;
  let hit;
  while ((hit = re.exec(m[1])) !== null) out.push(hit[1]);
  return out;
}

export async function run(ctx, opts) {
  console.log(bold('\nBridge / MCP surface'));

  // ── WS round-trip happy paths ─────────────────────────────────────────────

  await test('runScript — getProjectInfo via WS bridge returns project fields', async () => {
    const r = await send('getProjectInfo', {});
    assertNoError(r);
    const hasAny = ('name' in r) || ('file' in r) || ('items' in r) || ('projectFile' in r) || ('numItems' in r);
    if (!hasAny) throw new Error(`getProjectInfo response missing expected fields: ${JSON.stringify(r)}`);
    return `project fields: ${Object.keys(r).join(', ')}`;
  });

  await test('listCompositions — allowlisted read returns compositions array', async () => {
    const r = await send('listCompositions', {});
    assertNoError(r);
    assertArray(r, 'compositions');
    assertField(r, 'count', 'number');
    return `${r.count} composition(s) in project`;
  });

  // ── Allowlist drift guard (static-file diff, no AE round trip) ────────────

  await test('drift — allowedScripts and _dispatchSwitch agree (minus internal-only)', async () => {
    const commandsTs = await readFile(path.resolve(__dirname, '../src/commands.ts'), 'utf8');
    const bridgeJsx  = await readFile(path.resolve(__dirname, '../src/scripts/mcp-bridge.jsx'), 'utf8');

    const allowed    = _extractAllowedScripts(commandsTs);
    const dispatched = _extractDispatchCases(bridgeJsx);

    const allowedSet    = new Set(allowed);
    const dispatchedSet = new Set(dispatched);

    const missingFromAllowed = dispatched.filter(c => !allowedSet.has(c)).sort();
    const staleInAllowed     = allowed.filter(c => !dispatchedSet.has(c)).sort();

    const expected = [...EXPECTED_INTERNAL_ONLY].sort();
    const missingJSON  = JSON.stringify(missingFromAllowed);
    const expectedJSON = JSON.stringify(expected);

    if (missingJSON !== expectedJSON) {
      throw new Error(
        `Allowlist drift: dispatched-but-not-allowed differs from EXPECTED_INTERNAL_ONLY.\n` +
        `  got:      ${missingJSON}\n` +
        `  expected: ${expectedJSON}\n` +
        `Either add the new command to allowedScripts in src/index.ts, or add it to ` +
        `EXPECTED_INTERNAL_ONLY here if it's a deliberate internal-only handler.`
      );
    }

    if (staleInAllowed.length > 0) {
      throw new Error(
        `Allowlist drift: stale entries in allowedScripts not present in _dispatchSwitch: ` +
        JSON.stringify(staleInAllowed)
      );
    }

    return `${allowed.length} allowed / ${dispatched.length} dispatched / ${expected.length} internal-only`;
  });
}
