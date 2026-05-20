#!/usr/bin/env node
// After Effects MCP — AI Module Integration Tests
//
// Usage:
//   node test-integration.mjs           # logic tests only (no AE required)
//   node test-integration.mjs --live    # all tests, including live AE pipeline
//   node test-integration.mjs --suite=context-logic
//   node test-integration.mjs --live --suite=context-live
//
// Available suites: context-logic, context-live
//
// --live requires: After Effects open + MCP Bridge CEP panel active

import * as contextLogicSuite from './tests/context-logic.mjs';
import * as contextLiveSuite  from './tests/context-live.mjs';

import { results, printSummary, bold, yellow, dim } from './tests/helpers.mjs';

// ─── Args ─────────────────────────────────────────────────────────────────────

const live     = process.argv.includes('--live');
const suiteArg = (process.argv.find(a => a.startsWith('--suite=')) ?? '').replace('--suite=', '') || null;

// ─── Suite registry ───────────────────────────────────────────────────────────

const suites = [
  { name: 'context-logic', mod: contextLogicSuite, requiresLive: false },
  { name: 'context-live',  mod: contextLiveSuite,  requiresLive: true  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(bold('Cubic AI — Integration Tests'));
  if (live)     console.log(yellow('Mode: live (requires After Effects open + MCP Bridge panel active)'));
  if (suiteArg) console.log(`Suite filter: ${suiteArg}`);

  if (suiteArg && !suites.find(s => s.name === suiteArg)) {
    console.error(`\nUnknown suite "${suiteArg}". Available: ${suites.map(s => s.name).join(', ')}`);
    process.exit(1);
  }

  const ctx = {};

  for (const { name, mod, requiresLive } of suites) {
    if (suiteArg && suiteArg !== name) continue;
    if (requiresLive && !live) {
      console.log(`\n  ${name} ${dim('(skipped — run with --live to include)')}`);
      continue;
    }
    await mod.run(ctx, {});
  }

  if (!live) {
    console.log(dim('\n  Run with --live to also test the full AE pipeline (requires After Effects open + panel connected).'));
  }

  const failed = printSummary();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
