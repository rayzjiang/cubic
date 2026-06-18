/**
 * Compaction summary — real-API regression test for the "empty summary" bug.
 *
 * The bug: compactSession used to forward the to-summarize turns RAW. A turn-boundary cut's prefix
 * always ends on an ASSISTANT message, so the API treated it as a prefill-to-continue and Claude
 * returned an EMPTY summary — which then silently replaced (destroyed) the older history. The fix
 * flattens those turns into a single USER-role transcript so the request ends on a user turn.
 *
 * This drives the REAL model (Haiku) against the exact bug shape (a prefix ending on an assistant
 * turn, incl. a tool_use/tool_result pair) and asserts the summary comes back non-empty + structured.
 *
 * Requires: ANTHROPIC_API_KEY in ../../.env (uses Haiku 4.5 — ONE small summary call, ~sub-cent/run).
 * Does NOT require AE or the bridge panel.
 *
 * Run: npm run test:compaction   (rebuild first: imports from ../build)
 */

import './lib/loadEnv.mjs';
import { compactSession, Session } from '../build/index.js';
import { bold, green, red, dim, cyan, enableLlmIO, printCostTotal } from './lib/format.mjs';

enableLlmIO(); // print the real request/response/tokens/cost (no flag to remember)
const HAIKU = 'claude-haiku-4-5';

const results = [];
async function test(name, fn) {
  try {
    const detail = await fn();
    results.push({ ok: true, name });
    console.log(green(`  ✓ ${name}`) + (detail ? dim(` — ${detail}`) : ''));
  } catch (err) {
    results.push({ ok: false, name, err });
    console.log(red(`  ✗ ${name}: ${err.message}`));
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// A realistic short history that reproduces the bug shape: the older prefix (everything before the
// last user prompt) ends on an ASSISTANT turn and contains a tool_use/tool_result pair.
function buildSession() {
  const s = new Session();
  s.messages = [
    { role: 'user', content: 'Whats in my project?' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'g1', name: 'runScript', input: { script: 'getProjectInfo' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'g1', content: JSON.stringify({ project: 'Demo', comps: [{ name: 'Intro', width: 1920, height: 1080, fps: 24, layers: 4 }] }) }] },
    { role: 'assistant', content: "You've got one comp \"Intro\" (1920×1080, 24fps) with 4 layers." },
    { role: 'user', content: 'Make the title bounce in over 12 frames.' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'k1', name: 'runScript', input: { script: 'setLayerKeyframe', parameters: { layerIndex: 1, propertyName: 'Scale' } } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'k1', content: JSON.stringify({ status: 'success' }) }] },
    { role: 'assistant', content: 'Done — the title now bounces in over 12 frames with an overshoot.' },
    { role: 'user', content: 'whats the 2nd layer called?' }, // kept verbatim (keepRecentTurns: 1)
    { role: 'assistant', content: 'Layer 2 is a text layer called "Hello World".' },
  ];
  return s;
}

console.log(bold('\nCompaction summary (real Haiku call — the empty-summary regression)\n'));

let session, res;
await test('compactSession returns a NON-EMPTY summary (bug = empty)', async () => {
  session = buildSession();
  res = await compactSession(session, { model: HAIKU, keepRecentTurns: 1 });
  assert(res.ok === true, `expected ok, got ${res.ok} (reason: ${res.reason})`);
  assert(typeof res.summary === 'string' && res.summary.trim().length > 30,
    `summary is empty/too short — the bug is back (got ${JSON.stringify(res.summary)})`);
  return `${res.summary.length} chars`;
});

await test('summary is structured (followed the summarization prompt)', async () => {
  if (!res?.summary) return 'skipped (prior test failed)';
  assert(/##\s*(Goal|Project state|Next steps)/i.test(res.summary),
    'summary has no expected section headings — model likely returned junk');
  return 'has section headings';
});

await test('history was rewritten: summary first, recent turn kept verbatim', async () => {
  if (!session) return 'skipped';
  assert(typeof session.messages[0].content === 'string' &&
    session.messages[0].content.includes('<conversation_summary>'), 'first message is not the summary');
  assert(session.messages.length === 3, `expected [summary, kept user, kept assistant], got ${session.messages.length}`);
  assert(session.messages[1].content === 'whats the 2nd layer called?', 'recent user turn not kept verbatim');
  return `${session.messages.length} messages`;
});

// Show the actual summary so you can eyeball its quality (this is what the "View summary" row renders).
if (res?.summary) {
  console.log(bold('\nGenerated summary:'));
  console.log(cyan(res.summary.split('\n').map((l) => `  │ ${l}`).join('\n')));
}

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${bold('Results:')} ${green(`${passed} passed`)}, ${failed > 0 ? red(`${failed} failed`) : `${failed} failed`}`);
printCostTotal();
if (failed > 0) process.exit(1);
