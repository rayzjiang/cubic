/**
 * Drift guard — verifies that server/ai's COMMAND_NAMES mirror matches the
 * server/mcp canonical list (returned by the `listCommands` bridge intercept).
 *
 * Requires: AE + MCP Bridge panel connected.
 * No Anthropic API calls made — zero cost.
 *
 * Run: node tests/drift-guard.mjs
 */

import 'dotenv/config';
import { mcpClient, COMMAND_NAMES } from '../build/index.js';

const bold  = s => `\x1b[1m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;
const red   = s => `\x1b[31m${s}\x1b[0m`;
const dim   = s => `\x1b[2m${s}\x1b[0m`;

console.log(bold('\nDrift Guard — COMMAND_NAMES vs. server/mcp listCommands\n'));

let bridgeList;
try {
  // callRunScript already JSON-parses the result — raw is already an array
  bridgeList = await mcpClient.callRunScript('listCommands');
  if (!Array.isArray(bridgeList)) throw new Error(`expected array, got ${typeof bridgeList}`);
} catch (err) {
  console.error(red(`✗ Could not call listCommands: ${err.message}`));
  console.error(dim('  Make sure the MCP server is running and the AE panel is connected.'));
  process.exit(1);
}

const aiSet     = new Set(COMMAND_NAMES);
const bridgeSet = new Set(bridgeList);

const onlyInAi     = [...aiSet].filter(c => !bridgeSet.has(c));
const onlyInBridge = [...bridgeSet].filter(c => !aiSet.has(c));

let passed = true;

if (onlyInAi.length) {
  console.log(red(`✗ In server/ai COMMAND_NAMES but NOT in server/mcp:`));
  onlyInAi.forEach(c => console.log(`    ${c}`));
  passed = false;
}

if (onlyInBridge.length) {
  console.log(red(`✗ In server/mcp but NOT in server/ai COMMAND_NAMES:`));
  onlyInBridge.forEach(c => console.log(`    ${c}`));
  console.log(dim('  → Add these to server/ai/src/tools/definitions.ts COMMAND_NAMES'));
  passed = false;
}

if (passed) {
  console.log(green(`✓ In sync — ${aiSet.size} commands match`));
} else {
  console.log(red(`\nDrift detected — update server/ai/src/tools/definitions.ts COMMAND_NAMES`));
  process.exit(1);
}

await mcpClient.disconnect?.();
