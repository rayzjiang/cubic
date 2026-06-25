/**
 * Unified drift guard — keeps the SECRET command-params registry (now owned by the
 * proxy/ Worker package) honest against its two real sources of truth, with NO
 * bridge / AE / Claude Code dependency (pure static file reads, runs in CI):
 *
 *   1. NAMES  — registry keys (COMMAND_PARAMS) must equal the canonical command
 *               list in server/ae-bridge/src/commands.ts.
 *   2. PARAMS — every non-targeting param in the registry must match the real
 *               `args.X` reads in the .jsx handlers (and vice versa), so the
 *               always-present command catalog can never silently misdescribe a
 *               command and make the model guess.
 *   3. NAMES MIRROR — the client's codegen'd names-only allow-list
 *               (server/ai/src/tools/command-names.generated.ts) must be in sync
 *               with this registry (it backs the dispatch guard in the binary).
 *
 * Targeting params (compName/layerIndex/propertyPath/markerIndex/time/…) are read
 * by shared resolver helpers; they're documented once in the catalog preamble and
 * are EXEMPT here (computed dynamically from those helpers' bodies).
 *
 * Moved here from server/ai/tests/drift-guard.mjs when the registry moved server-side.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { COMMAND_PARAMS, COMMAND_NAMES } from '../src/secrets/command-params.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..');
const AE_BRIDGE_SRC = join(REPO, 'server', 'ae-bridge', 'src');
const SCRIPTS_DIR = join(AE_BRIDGE_SRC, 'scripts');

// Shared resolver helpers — params they read are targeting/global, exempt below.
const HELPER_FNS = ['_resolveComp', '_resolveCompAndLayer', '_resolveAnimProp', '_resolveMarkerProp', '_findMarkerKey', '_sessionBackupDir'];
// Server-injected meta fields — set by the agent (executeTool), not model-facing params.
const INJECTED_META = ['__undoLabel', 'prune'];
// createLayer dispatches by args.type to these sub-handlers; their reads count as createLayer's.
const SCAN_TARGETS: Record<string, string[]> = {
  createLayer: ['createLayer', 'createSolidLayer', 'createTextLayer', 'createShapeLayer', 'createCamera', 'createLightLayer', 'createNullLayer'],
};

// ── Load handler sources, split into top-level functions ──────────────────────
const fnBody: Record<string, string> = {};
for (const file of readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith('.jsx'))) {
  const src = readFileSync(join(SCRIPTS_DIR, file), 'utf8');
  const decls = [...src.matchAll(/^function\s+(\w+)\s*\(/gm)];
  for (let i = 0; i < decls.length; i++) {
    const name = decls[i][1];
    const end = i + 1 < decls.length ? decls[i + 1].index! : src.length;
    fnBody[name] = src.slice(decls[i].index!, end);
  }
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const argsIn = (body: string | undefined): Set<string> => {
  const set = new Set<string>();
  if (!body) return set;
  for (const m of stripComments(body).matchAll(/\bargs\.([A-Za-z_]\w*)(?![\w(])/g)) set.add(m[1]);
  return set;
};

const EXEMPT = new Set<string>(INJECTED_META);
for (const h of HELPER_FNS) for (const p of argsIn(fnBody[h])) EXEMPT.add(p);
const strip = (set: Set<string>) => new Set([...set].filter((p) => !EXEMPT.has(p)));

describe('command-params registry drift (proxy/src/secrets vs server/ae-bridge)', () => {
  it('NAMES — registry keys match server/ae-bridge/commands.ts', () => {
    const commandsSrc = readFileSync(join(AE_BRIDGE_SRC, 'commands.ts'), 'utf8');
    const canonical = new Set([...commandsSrc.matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)].map((m) => m[1]));
    const registryNames = new Set<string>(COMMAND_NAMES);
    const onlyInRegistry = [...registryNames].filter((c) => !canonical.has(c));
    const onlyInCanonical = [...canonical].filter((c) => !registryNames.has(c));
    expect(onlyInRegistry, `commands only in registry: ${onlyInRegistry.join(', ')}`).toEqual([]);
    expect(onlyInCanonical, `commands missing from registry: ${onlyInCanonical.join(', ')}`).toEqual([]);
  });

  it('PARAMS — registry params match the .jsx handler args.X reads', () => {
    const failures: string[] = [];
    for (const cmd of COMMAND_NAMES) {
      const targets = SCAN_TARGETS[cmd] ?? [cmd];
      if (!targets.every((t) => fnBody[t])) {
        failures.push(`${cmd}: handler not found (looked for ${targets.join(', ')})`);
        continue;
      }
      const scanned = new Set<string>();
      for (const t of targets) for (const p of argsIn(fnBody[t])) scanned.add(p);
      const handlerParams = strip(scanned);
      const registryParams = strip(new Set(Object.keys(COMMAND_PARAMS[cmd].params)));
      const undocumented = [...handlerParams].filter((p) => !registryParams.has(p));
      const phantom = [...registryParams].filter((p) => !handlerParams.has(p));
      undocumented.forEach((p) => failures.push(`${cmd}: handler reads args.${p} — add to registry`));
      phantom.forEach((p) => failures.push(`${cmd}: registry lists "${p}" — no handler reads it`));
    }
    expect(failures, `\n${failures.join('\n')}`).toEqual([]);
  });

  it('NAMES MIRROR — client command-names.generated.ts is in sync with the registry', () => {
    // Re-runs the codegen in --check mode; throws (failing the test) if the committed file is stale.
    expect(() =>
      execFileSync('node', ['scripts/gen-command-names.mjs', '--check'], { cwd: join(__dirname, '..') }),
    ).not.toThrow();
  });
});
