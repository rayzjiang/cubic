// chat-live.mjs — manual smoke test for the full LLM round-trip
//
// Requires: ANTHROPIC_API_KEY set + After Effects open + MCP Bridge panel connected
// Run: npm run test:chat
//
// Costs a fraction of a cent per run (two Haiku 4.5 API calls).

import 'dotenv/config';
import { buildContext, buildSystemPrompt, getLLM } from '../build/index.js';

const llm = getLLM();
const HAIKU = 'claude-haiku-4-5';

const green  = s => `\x1b[32m${s}\x1b[0m`;
const red    = s => `\x1b[31m${s}\x1b[0m`;
const dim    = s => `\x1b[2m${s}\x1b[0m`;
const bold   = s => `\x1b[1m${s}\x1b[0m`;

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

console.log(bold('\nChat Live (requires ANTHROPIC_API_KEY + AE + MCP panel)\n'));

let systemPrompt;
let state;

await test('buildContext() + buildSystemPrompt() produces a system prompt', async () => {
  state = await buildContext();
  systemPrompt = buildSystemPrompt(state);
  assert(systemPrompt.includes('<live_ae_state>'), 'missing <live_ae_state> block');
  assert(systemPrompt.length > 20, 'system prompt too short');
  return `${systemPrompt.length} chars`;
});

await test('llm.chat() returns a non-empty response', async () => {
  const response = await llm.chat(
    [{ role: 'user', content: 'In one sentence, describe what I currently have open in After Effects based on the provided state.' }],
    { systemPrompt, model: HAIKU }
  );
  assert(typeof response.content === 'string' && response.content.length > 0, 'empty response');
  assert(typeof response.usage.inputTokens === 'number', 'missing usage.inputTokens');
  assert(typeof response.usage.outputTokens === 'number', 'missing usage.outputTokens');
  console.log(dim(`\n\n    Claude: ${response.content}\n`));
  return `${response.usage.inputTokens} in / ${response.usage.outputTokens} out tokens`;
});

await test('llm.stream() yields text chunks then done', async () => {
  const chunks = [];
  for await (const chunk of llm.stream(
    [{ role: 'user', content: 'Say "stream test ok" and nothing else.' }],
    { systemPrompt, model: HAIKU, maxTokens: 20 }
  )) {
    chunks.push(chunk);
  }
  const last = chunks[chunks.length - 1];
  assert(last?.type === 'done', 'last chunk must be type "done"');
  const textChunks = chunks.filter(c => c.type === 'text');
  assert(textChunks.length > 0, 'no text chunks received');
  return `${textChunks.length} text chunks`;
});

const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
console.log(`\n${bold('Results:')} ${green(`${passed} passed`)}, ${failed > 0 ? red(`${failed} failed`) : `${failed} failed`}`);
process.exit(failed > 0 ? 1 : 0);
