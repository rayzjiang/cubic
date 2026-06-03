// agent-live.mjs — end-to-end smoke test for the agent loop (Phase 2 item 4).
//
// Drives runAgentTurn() in-process against REAL After Effects: snapshot → context →
// chat → execute tools → feed tool_result back → loop, narrating events as it goes.
//
// Requires: ANTHROPIC_API_KEY + After Effects open + MCP Bridge panel connected.
// Run: npm run test:agent
//
// ⚠️  THIS MUTATES YOUR AE PROJECT — it asks the agent to create a "__CUBIC_AGENT_TEST"
//     comp + a layer. Delete that comp afterwards (or undo). Uses Haiku to stay cheap.

import 'dotenv/config';
import { runAgentTurn, Session, mcpClient, sessionCache } from '../build/index.js';
import { green, red, dim, bold, cyan, enableLlmIO, printCostTotal } from './lib/format.mjs';

// Real Haiku calls below (incl. the agent loop's internal ones) — show every request/response/cost.
enableLlmIO();
const HAIKU = 'claude-haiku-4-5';
// Cap loop length so a runaway multi-tool turn can't quietly rack up cost during a smoke test.
const MAX_ITERATIONS = 5;

const results = [];
async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    const note = await fn();
    console.log(green('PASS') + (note ? dim(` (${note})`) : ''));
    results.push({ ok: true });
  } catch (e) {
    console.log(red('FAIL') + ` — ${e.message}`);
    results.push({ ok: false });
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// Renders a live agent event to the console (what the panel will show).
function printEvent(e) {
  switch (e.type) {
    case 'turn_start': console.log(dim('    · turn started')); break;
    case 'snapshot':   console.log(dim(`    · snapshot ${e.ok ? 'saved → ' + e.path : 'skipped (' + e.reason + ')'}`)); break;
    case 'text':       console.log(cyan(`    ✦ ${e.text}`)); break;
    case 'tool_start': console.log(dim(`    → ${e.label}`)); break;
    case 'tool_end':   console.log(dim(`    ← ${e.ok ? 'ok' : 'ERROR ' + e.errorCode}${e.retried ? ' (retried)' : ''}`)); break;
    case 'steer':      console.log(dim(`    ⤷ steer: ${e.text}`)); break;
    case 'cancelled':  console.log(red('    ✕ cancelled')); break;
    case 'error':      console.log(red(`    ✕ error: ${e.message}`)); break;
    case 'done':       console.log(dim(`    · done (${e.stopReason})`)); break;
  }
}

console.log(bold('\nAgent Live — full loop against AE (requires ANTHROPIC_API_KEY + AE + MCP panel)\n'));

// Preflight: fail loudly if there is no panel-connected bridge (see chat-live.mjs).
await test('AE bridge is connected (panel attached)', async () => {
  let info;
  try { info = await mcpClient.callRunScript('getProjectInfo'); }
  catch (e) { throw new Error(`cannot reach a panel-connected AE bridge: ${e.message}`); }
  assert(info && typeof info.projectName === 'string', 'bridge replied but without a project — panel not attached');
  return `project "${info.projectName}"`;
});
if (!results[results.length - 1].ok) {
  console.log(red('\nBridge preflight failed — skipping agent loop test.\n'));
  await mcpClient.disconnect();
  process.exit(1);
}

const session = new Session();
const events = [];
const emit = e => { events.push(e); printEvent(e); };

console.log(bold('\n  Running a multi-step turn:\n'));
await test('runAgentTurn completes a multi-step task', async () => {
  await runAgentTurn(
    session,
    'Create a composition named "__CUBIC_AGENT_TEST" (1920x1080, 5s, 30fps), then add a red solid layer to it that fades in over the first second. Keep it brief.',
    emit,
    { model: HAIKU, maxIterations: MAX_ITERATIONS },
  );
  const kinds = events.map(e => e.type);
  assert(kinds.includes('turn_start'), 'no turn_start event');
  assert(kinds.includes('snapshot'), 'no snapshot event');
  assert(kinds.includes('tool_start'), 'model never called a tool');
  assert(kinds.includes('done') || kinds.includes('error'), 'turn never terminated');
  const tools = events.filter(e => e.type === 'tool_end');
  const okTools = tools.filter(e => e.ok).length;
  return `${events.length} events, ${okTools}/${tools.length} tool calls ok`;
});

await test('conversation history accumulated (multi-turn ready)', async () => {
  // user + at least one assistant; tool turns add more.
  assert(session.messages.length >= 2, `expected ≥2 messages, got ${session.messages.length}`);
  assert(session.messages[0].role === 'user', 'first message should be the user prompt');
  assert(!session.running, 'session.running should be false after the turn');
  return `${session.messages.length} messages in history`;
});

await test('follow-up turn reuses the same session', async () => {
  const before = session.messages.length;
  await runAgentTurn(session, 'What did you just create? One sentence.', emit, { model: HAIKU, takeSnapshot: false, maxIterations: MAX_ITERATIONS });
  assert(session.messages.length > before, 'follow-up turn did not extend history');
  const lastText = [...events].reverse().find(e => e.type === 'text');
  return lastText ? `"${lastText.text.slice(0, 60)}…"` : 'completed';
});

const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
console.log(`\n${bold('Results:')} ${green(`${passed} passed`)}, ${failed > 0 ? red(`${failed} failed`) : `${failed} failed`}`);
printCostTotal();
console.log(dim('\n  Remember to delete the "__CUBIC_AGENT_TEST" comp from your project.\n'));
await mcpClient.disconnect();
process.exit(failed > 0 ? 1 : 0);
