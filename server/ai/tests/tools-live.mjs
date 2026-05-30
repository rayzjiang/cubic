/**
 * Tool-use round-trip smoke test.
 * Verifies that Claude emits a structured tool call (not prose) when given a
 * creation prompt + the AE_TOOLS definitions. No tool is actually *executed*
 * against AE — that's item 4 (agent loop).
 *
 * Requires: ANTHROPIC_API_KEY in .env (uses Haiku 4.5, ~sub-cent/run).
 * Does NOT require AE or the MCP Bridge panel to be connected.
 *
 * Run: node tests/tools-live.mjs
 */

import 'dotenv/config';
import { getLLM, buildSystemPrompt, AE_TOOLS } from '../build/index.js';

const bold  = s => `\x1b[1m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;
const red   = s => `\x1b[31m${s}\x1b[0m`;
const dim   = s => `\x1b[2m${s}\x1b[0m`;
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

const llm = getLLM();

// Minimal offline state for a system prompt — bridge not required for tool-use test.
const offlineState = {
  project: null,
  activeComp: null,
  playhead: null,
  frame: null,
  selectedLayers: [],
};
const systemPrompt = buildSystemPrompt(offlineState);

function printResponse(response) {
  if (response.content) {
    console.log(dim('  │ text: ') + response.content.trim());
  }
  for (const tu of response.toolUses) {
    console.log(dim(`  │ tool_use: ${tu.name}`));
    console.log(dim('  │ input: ') + JSON.stringify(tu.input, null, 2).replace(/\n/g, '\n  │        '));
  }
  console.log('');
}

console.log(bold('\nTool-use round-trip (no AE required, uses Haiku)\n'));

// ─── Test 1: model emits a tool_use for a creation request ───────────────────
let createResponse;
await test('creation prompt → stopReason tool_use', async () => {
  console.log(dim('  │ prompt: Create a 1920×1080 composition called "Intro" at 24fps.\n'));
  createResponse = await llm.chat(
    [{ role: 'user', content: 'Create a 1920×1080 composition called "Intro" at 24fps.' }],
    { systemPrompt, model: HAIKU, tools: AE_TOOLS }
  );
  printResponse(createResponse);
  assert(
    createResponse.stopReason === 'tool_use',
    `expected stopReason 'tool_use', got '${createResponse.stopReason}'`
  );
  assert(createResponse.toolUses.length > 0, 'toolUses array is empty');
  return `stopReason=${createResponse.stopReason}, toolUses=${createResponse.toolUses.length}`;
});

await test('emitted tool is createComposition or runScript', async () => {
  if (!createResponse) return 'skipped (prior test failed)';
  const name = createResponse.toolUses[0]?.name;
  assert(
    name === 'createComposition' || name === 'runScript',
    `unexpected tool name: ${name}`
  );
  return `tool=${name}`;
});

await test('createComposition input has name, width, height', async () => {
  if (!createResponse) return 'skipped';
  const tu = createResponse.toolUses.find(t => t.name === 'createComposition');
  if (!tu) return 'skipped (model used runScript instead — both are valid)';
  const input = tu.input;
  assert(typeof input === 'object' && input !== null, 'input is not an object');
  assert('name' in input, 'missing name');
  assert('width' in input, 'missing width');
  assert('height' in input, 'missing height');
  return `name=${input.name}, ${input.width}×${input.height}`;
});

// ─── Test 2: model narrates (text response) when no action is needed ─────────
await test('open-ended question → stopReason end_turn, no tool_use', async () => {
  console.log(dim('  │ prompt: What is a composition in After Effects?\n'));
  const response = await llm.chat(
    [{ role: 'user', content: 'What is a composition in After Effects?' }],
    { systemPrompt, model: HAIKU, tools: AE_TOOLS }
  );
  printResponse(response);
  assert(
    response.stopReason === 'end_turn',
    `expected end_turn, got ${response.stopReason}`
  );
  assert(response.toolUses.length === 0, 'unexpectedly emitted tool_use');
  assert(response.content.length > 0, 'content is empty');
  return `stopReason=${response.stopReason}, chars=${response.content.length}`;
});

// ─── Test 3: chat() with no tools still works (regression guard) ─────────────
await test('chat() without tools still returns content string', async () => {
  console.log(dim('  │ prompt: Say "hello".\n'));
  const response = await llm.chat(
    [{ role: 'user', content: 'Say "hello".' }],
    { systemPrompt, model: HAIKU }
  );
  printResponse(response);
  assert(response.content.length > 0, 'content is empty');
  assert(Array.isArray(response.toolUses), 'toolUses is not an array');
  assert(response.toolUses.length === 0, 'unexpected toolUses when no tools provided');
  return `chars=${response.content.length}`;
});

// ─── Results ─────────────────────────────────────────────────────────────────
const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
console.log(`\n${bold('Results:')} ${green(`${passed} passed`)}, ${failed > 0 ? red(`${failed} failed`) : `${failed} failed`}`);
if (failed > 0) process.exit(1);
