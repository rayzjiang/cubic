// chat-live.mjs — manual smoke test for the full LLM round-trip (asks what is the current state of the AE project)
//
// Requires: ANTHROPIC_API_KEY set + After Effects open + MCP Bridge panel connected
// Run: npm run test:chat
//
// Costs a fraction of a cent per run (two Haiku 4.5 API calls).
//
// SELECTION DETAIL SANITY CHECKLIST (run multiple times with different AE states):
//   1. Nothing selected in AE    → "getSelectionDetails layers" test shows count: 0
//   2. Layer selected, no props  → same: count: 0 (layer row selected but no property highlighted)
//   3. Click a property (Scale)  → test shows propertyPath: ["Transform","Scale"] + value
//   4. Expression on Scale       → test shows expression field
//   5. Click a keyframe diamond  → test shows selectedKeys array

import './lib/loadEnv.mjs';
import { buildContext, buildSystemPrompt, formatStateForPrompt, getLLM, bridgeClient, getSelectionDetails } from '../build/index.js';
import { green, red, dim, bold, enableLlmIO, printCostTotal } from './lib/format.mjs';

// Real Haiku calls below — show every request/response/token/cost (no flag to remember).
enableLlmIO();
const llm = getLLM();
const HAIKU = 'claude-haiku-4-5';

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

// Preflight: assert we're actually talking to a panel-connected bridge BEFORE any
// API calls. buildContext() swallows bridge errors into null (graceful degradation
// for production), which silently turns "not connected" into an empty AE state and
// makes the chat tests "pass" against a blank project. Here we call the raw client
// directly so a disconnected/panel-less bridge fails loudly instead.
await test('AE bridge is connected (panel attached)', async () => {
  let info;
  try {
    info = await bridgeClient.callRunScript('getProjectInfo');
  } catch (e) {
    throw new Error(
      `cannot reach a panel-connected AE bridge: ${e.message}\n` +
      `    → check 'lsof -nP -iTCP:17923-17927' for stray bridges and that ` +
      `~/.ae-mcp-bridge/port points at the bridge the MCP Bridge panel is connected to`
    );
  }
  assert(info && typeof info.projectName === 'string',
    'bridge replied but without a project — panel likely not attached');
  return `project "${info.projectName}", ${info.numItems} items`;
});

// Everything below is meaningless without a live bridge — bail loudly if preflight failed.
if (!results[results.length - 1].ok) {
  console.log(red('\nBridge preflight failed — skipping LLM round-trip tests.\n'));
  await bridgeClient.disconnect();
  process.exit(1);
}

await test('buildContext() + buildSystemPrompt() produces a system prompt', async () => {
  state = await buildContext();
  systemPrompt = buildSystemPrompt(state);
  assert(systemPrompt.volatile.includes('<live_ae_state>'), 'missing <live_ae_state> block');
  assert(systemPrompt.cached.includes('<command_catalog>'), 'missing <command_catalog> in cached prefix');
  const total = systemPrompt.cached.length + systemPrompt.volatile.length;
  assert(total > 20, 'system prompt too short');
  return `${systemPrompt.cached.length} cached + ${systemPrompt.volatile.length} volatile chars`;
});

await test('llm.chat() returns a non-empty response', async () => {
  const response = await llm.chat(
    [{ role: 'user', content: 'In one sentence, describe what I currently have open in After Effects based on the provided state.' }],
    { systemPrompt, model: HAIKU }
  );
  assert(typeof response.content === 'string' && response.content.length > 0, 'empty response');
  assert(typeof response.usage.inputTokens === 'number', 'missing usage.inputTokens');
  assert(typeof response.usage.outputTokens === 'number', 'missing usage.outputTokens');
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

// ─── Selection Detail Tests ──────────────────────────────────────────────────
console.log(bold('\nSelection Detail (no API cost — change AE selection state and re-run)\n'));

let selectionRaw;
await test('getSelectionDetails() returns valid shape', async () => {
  selectionRaw = await getSelectionDetails();
  assert(selectionRaw.status === 'success', `status not success: ${selectionRaw.status}`);
  assert(Array.isArray(selectionRaw.layers), 'layers is not an array');
  assert(typeof selectionRaw.count === 'number', 'count missing');
  // Structural check on each layer entry
  for (const layer of selectionRaw.layers) {
    assert(typeof layer.layerIndex === 'number', 'layerIndex missing');
    assert(Array.isArray(layer.selectedProperties), 'selectedProperties not an array');
    for (const prop of layer.selectedProperties) {
      assert(Array.isArray(prop.propertyPath), 'propertyPath not an array');
      assert(prop.propertyPath.every(s => typeof s === 'string'), 'propertyPath contains non-string');
    }
  }
  return `count: ${selectionRaw.count}, layers: ${selectionRaw.layers.length}`;
});

await test('getSelectionDetails() — pretty print current selection', async () => {
  if (selectionRaw.layers.length === 0) {
    console.log(dim('\n    (no properties highlighted — highlight a property in AE and re-run)\n'));
    return 'no selection';
  }
  for (const layer of selectionRaw.layers) {
    console.log(dim(`\n    Layer ${layer.layerIndex}:`));
    for (const prop of layer.selectedProperties) {
      const path = prop.propertyPath.join(' > ');
      const val  = prop.value !== undefined ? dim(` value=${JSON.stringify(prop.value)}`) : '';
      const expr = prop.expression ? dim(` expr="${prop.expression.slice(0, 60).replace(/\n/g, '↵')}…"`) : '';
      const keys = prop.selectedKeys?.length ? dim(` selectedKeys=[${prop.selectedKeys.map(k => k.keyIndex).join(',')}]`) : '';
      console.log(`      ${path}${val}${expr}${keys}`);
    }
    if (layer._truncated) console.log(dim(`    _truncated: ${JSON.stringify(layer._truncated)}`));
  }
  console.log('');
  return `${selectionRaw.layers.reduce((n, l) => n + l.selectedProperties.length, 0)} props across ${selectionRaw.layers.length} layer(s)`;
});

await test('buildContext() merges selectedProperties into selectedLayers', async () => {
  const ctx = await buildContext();
  // Every layer that getSelectionDetails reported props for must have them in ctx.selectedLayers
  for (const dl of selectionRaw.layers) {
    if (dl.selectedProperties.length === 0) continue;
    const ctxLayer = ctx.selectedLayers.find(l => l.index === dl.layerIndex);
    assert(ctxLayer, `layer ${dl.layerIndex} missing from buildContext selectedLayers`);
    assert(Array.isArray(ctxLayer.selectedProperties) && ctxLayer.selectedProperties.length > 0,
      `selectedProperties not merged into layer ${dl.layerIndex}`);
  }
  return `${ctx.selectedLayers.length} selected layer(s)`;
});

await test('formatStateForPrompt() never emits empty selectedProperties array', async () => {
  const ctx = await buildContext();
  const prompt = formatStateForPrompt(ctx);
  const json = prompt.replace(/<live_ae_state>\n/, '').replace(/\n<\/live_ae_state>/, '');
  const parsed = JSON.parse(json);
  for (const layer of (parsed.selectedLayers ?? [])) {
    if ('selectedProperties' in layer) {
      assert(layer.selectedProperties.length > 0, 'found empty selectedProperties array — should be omitted');
    }
  }
  const hasProps = parsed.selectedLayers?.some(l => l.selectedProperties?.length > 0);
  console.log(dim(`\n    selectedProperties present in prompt: ${hasProps ? 'yes' : 'no (none highlighted)'}\n`));
  return hasProps ? 'selection injected into prompt' : 'no selection — key correctly absent';
});

const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
console.log(`\n${bold('Results:')} ${green(`${passed} passed`)}, ${failed > 0 ? red(`${failed} failed`) : `${failed} failed`}`);
printCostTotal();
process.exit(failed > 0 ? 1 : 0);
