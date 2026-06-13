/**
 * Matchname guard — keeps every hardcoded AE matchName in the .jsx handlers honest against AE
 * itself, with NO bridge / AE / Claude Code dependency at run time (pure static file reads, CI):
 *
 *   • Effect matchNames (EFFECT_DICT) are checked against tests/fixtures/ae-matchnames.json, which
 *     is generated FROM REAL AE by `node scripts/introspect-matchnames.mjs`. A matchName AE rejects
 *     (e.g. the old "ADBE Glow") is recorded valid:false and FAILS here — the exact gap that let the
 *     glow bug ship. A brand-new effect matchName not in the fixture also fails until introspected.
 *   • Non-effect matchNames (ADBE Text *, ADBE Vector *) live in other property groups and can't be
 *     probed via Effects.addProperty; they're a reviewed baseline (reviewedNonEffect) that the LIVE
 *     text/shape integration tests exercise for real. A new/changed one fails here until reviewed.
 *
 * So: green means every hardcoded matchName is either AE-verified (effects) or an explicitly
 * reviewed, live-tested string — the model can never silently ship a matchName AE rejects.
 *
 * Run: node tests/matchname-guard.mjs   (no build needed)
 * Regenerate the effect fixture when the AE version changes: cd server/ae-bridge && node scripts/introspect-matchnames.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const bold  = s => `\x1b[1m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;
const red   = s => `\x1b[31m${s}\x1b[0m`;
const dim   = s => `\x1b[2m${s}\x1b[0m`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = join(REPO, 'server', 'ae-bridge', 'src', 'scripts');
const FIXTURE = join(REPO, 'server', 'ae-bridge', 'tests', 'fixtures', 'ae-matchnames.json');

console.log(bold('\nMatchname Guard — hardcoded AE matchNames vs. real AE (fixture)\n'));

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const validEffects = new Set(Object.keys(fixture.effects).filter(k => fixture.effects[k].valid));
const invalidEffects = new Set(Object.keys(fixture.effects).filter(k => !fixture.effects[k].valid));
const reviewed = new Set(fixture.reviewedNonEffect ?? []);
const accounted = new Set([...validEffects, ...reviewed]);

// Strip comments so a matchName mentioned in prose (e.g. an "ADBE Glow" example) isn't scanned.
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

// Collect every hardcoded "ADBE ..." matchName actually used in handler CODE, with its file.
const used = new Map(); // matchName -> Set(files)
for (const file of readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.jsx'))) {
  const src = stripComments(readFileSync(join(SCRIPTS_DIR, file), 'utf8'));
  for (const m of src.matchAll(/"(ADBE [^"]+)"/g)) {
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(file);
  }
}

let passed = true;
const rejected = []; // in code AND known-invalid in AE
const unaccounted = []; // in code but neither AE-verified nor reviewed

for (const [mn, files] of used) {
  const where = [...files].join(', ');
  if (invalidEffects.has(mn)) { rejected.push(`${mn}  (${where}) — AE: ${fixture.effects[mn].error || 'rejected'}`); passed = false; }
  else if (!accounted.has(mn)) { unaccounted.push(`${mn}  (${where})`); passed = false; }
}

if (rejected.length) {
  console.log(red('✗ matchNames AE REJECTS are hardcoded in handler code:'));
  rejected.forEach(r => console.log(red(`    ${r}`)));
  console.log(red('    Fix the matchName to the real one (see the fixture / introspect output).'));
}
if (unaccounted.length) {
  console.log(red('✗ unverified matchNames (not in the AE fixture nor the reviewed baseline):'));
  unaccounted.forEach(u => console.log(red(`    ${u}`)));
  console.log(red('    Effect? regenerate the fixture (scripts/introspect-matchnames.mjs). Text/shape? add to reviewedNonEffect after verifying in AE.'));
}

// Hygiene (non-failing): fixture entries no longer referenced anywhere in code.
const staleReviewed = [...reviewed].filter(m => !used.has(m));
const staleEffects = [...validEffects].filter(m => !used.has(m));
if (staleReviewed.length || staleEffects.length) {
  console.log(dim(`  note: ${staleReviewed.length + staleEffects.length} fixture matchName(s) no longer used in code (safe to prune): ${[...staleEffects, ...staleReviewed].join(', ')}`));
}

if (passed) {
  console.log(green(`✓ All ${used.size} hardcoded matchNames are accounted for`));
  console.log(green(`  (${validEffects.size} AE-verified effects, ${reviewed.size} reviewed/live-tested text+shape)\n`));
} else {
  console.log(red('\nMatchname drift detected — a hardcoded AE matchName is wrong or unverified.\n'));
  process.exit(1);
}
