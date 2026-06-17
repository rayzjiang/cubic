/**
 * Unified drift guard — keeps the command-params registry honest against the two
 * real sources of truth, with NO bridge / AE / Claude Code dependency (pure static
 * file reads, runs in CI):
 *
 *   1. NAMES  — registry keys (COMMAND_PARAMS) must equal the canonical command
 *               list in server/ae-bridge/src/commands.ts.
 *   2. PARAMS — every non-targeting param in the registry must match the real
 *               `args.X` reads in the .jsx handlers (and vice versa), so the
 *               always-present command catalog can never silently misdescribe a
 *               command and make the model guess.
 *
 * Targeting params (compName/layerIndex/propertyPath/markerIndex/time/…) are read
 * by shared resolver helpers; they're documented once in the catalog preamble and
 * are EXEMPT here (computed dynamically from those helpers' bodies).
 *
 * Run: node tests/drift-guard.mjs   (requires `npm run build` first)
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COMMAND_PARAMS, COMMAND_NAMES } from '../build/index.js';

const bold  = s => `\x1b[1m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;
const red   = s => `\x1b[31m${s}\x1b[0m`;
const dim   = s => `\x1b[2m${s}\x1b[0m`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..', '..');
const AE_BRIDGE_SRC = join(REPO, 'server', 'ae-bridge', 'src');
const SCRIPTS_DIR = join(AE_BRIDGE_SRC, 'scripts');

// Shared resolver helpers — params they read are targeting/global, exempt below.
const HELPER_FNS = ['_resolveComp', '_resolveCompAndLayer', '_resolveAnimProp', '_resolveMarkerProp', '_findMarkerKey', '_sessionBackupDir'];
// Server-injected meta fields — set by the agent (executeTool), not model-facing params,
// so they're absent from the registry/catalog by design. The bridge reads them for plumbing
// (e.g. __undoLabel → the Edit > Undo entry name) but the model never supplies them.
// `prune` (restoreProject) is set only by the UI "restore to before this request" path, never the
// model — so it's server-injected too, kept out of the model-facing catalog.
const INJECTED_META = ['__undoLabel', 'prune'];
// createLayer dispatches by args.type to these sub-handlers; their reads count as createLayer's.
const SCAN_TARGETS = {
  createLayer: ['createLayer', 'createSolidLayer', 'createTextLayer', 'createShapeLayer', 'createCamera', 'createLightLayer', 'createNullLayer'],
};

console.log(bold('\nDrift Guard — command-params registry vs. server/ae-bridge (names + params)\n'));

// ── Load handler sources, split into top-level functions ──────────────────────
const fnBody = {}; // functionName -> source slice (decl → next top-level function)
for (const file of readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.jsx'))) {
  const src = readFileSync(join(SCRIPTS_DIR, file), 'utf8');
  const decls = [...src.matchAll(/^function\s+(\w+)\s*\(/gm)];
  for (let i = 0; i < decls.length; i++) {
    const name = decls[i][1];
    const end = i + 1 < decls.length ? decls[i + 1].index : src.length;
    fnBody[name] = src.slice(decls[i].index, end);
  }
}

// Strip block + line comments so `args.X` mentioned in prose doesn't count as a read.
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const argsIn = body => {
  const set = new Set();
  if (!body) return set;
  // Match `args.X` reads, but NOT method calls like `args.hasOwnProperty(...)`.
  // The (?![\w(]) tail forces a full-identifier match (no backtracking) and
  // excludes a trailing "(" (a method call rather than a property read).
  for (const m of stripComments(body).matchAll(/\bargs\.([A-Za-z_]\w*)(?![\w(])/g)) set.add(m[1]);
  return set;
};

// EXEMPT = every arg read by a shared resolver helper, plus server-injected meta fields.
const EXEMPT = new Set(INJECTED_META);
for (const h of HELPER_FNS) for (const p of argsIn(fnBody[h])) EXEMPT.add(p);

// ── Axis 1: NAMES (registry keys vs commands.ts) ──────────────────────────────
const commandsSrc = readFileSync(join(AE_BRIDGE_SRC, 'commands.ts'), 'utf8');
const canonical = new Set([...commandsSrc.matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)].map(m => m[1]));
const registryNames = new Set(COMMAND_NAMES);

let passed = true;

const nameOnlyInRegistry = [...registryNames].filter(c => !canonical.has(c));
const nameOnlyInCanonical = [...canonical].filter(c => !registryNames.has(c));
if (nameOnlyInRegistry.length || nameOnlyInCanonical.length) {
  passed = false;
  console.log(red('✗ NAMES drift (registry keys vs server/ae-bridge/commands.ts):'));
  nameOnlyInRegistry.forEach(c => console.log(red(`    + only in registry: ${c}`)));
  nameOnlyInCanonical.forEach(c => console.log(red(`    - missing from registry: ${c}`)));
} else {
  console.log(green(`✓ NAMES in sync — ${registryNames.size} commands match commands.ts`));
}

// ── Axis 2: PARAMS (registry params vs .jsx args.X reads) ──────────────────────
const strip = set => new Set([...set].filter(p => !EXEMPT.has(p)));
let paramFailures = 0;

for (const cmd of COMMAND_NAMES) {
  const targets = SCAN_TARGETS[cmd] ?? [cmd];
  if (!targets.every(t => fnBody[t])) {
    passed = false; paramFailures++;
    console.log(red(`✗ ${cmd}: handler function not found in .jsx (looked for ${targets.join(', ')})`));
    continue;
  }
  const scanned = new Set();
  for (const t of targets) for (const p of argsIn(fnBody[t])) scanned.add(p);

  const handlerParams = strip(scanned);
  const registryParams = strip(new Set(Object.keys(COMMAND_PARAMS[cmd].params)));

  const undocumented = [...handlerParams].filter(p => !registryParams.has(p)); // handler reads it, registry omits → model would guess
  const phantom = [...registryParams].filter(p => !handlerParams.has(p));      // registry documents it, no handler read → misleading

  if (undocumented.length || phantom.length) {
    passed = false; paramFailures++;
    console.log(red(`✗ ${cmd}:`));
    undocumented.forEach(p => console.log(red(`    + handler reads args.${p} — add to registry`)));
    phantom.forEach(p => console.log(red(`    - registry lists "${p}" — no handler reads it`)));
  }
}

if (paramFailures === 0) {
  console.log(green(`✓ PARAMS in sync — all ${COMMAND_NAMES.length} commands match their .jsx handlers`));
  console.log(dim(`  (exempt targeting params: ${[...EXEMPT].sort().join(', ')})`));
}

if (passed) {
  console.log(green('\n✓ Registry is in sync with server/ae-bridge.\n'));
} else {
  console.log(red('\nDrift detected — update server/ai/src/tools/command-params.ts to match server/ae-bridge.\n'));
  process.exit(1);
}
