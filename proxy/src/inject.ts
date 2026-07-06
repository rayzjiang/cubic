import { zodToJsonSchema } from 'zod-to-json-schema';
import { AE_TOOLS, buildSystemPrompt } from './secrets/index.js';

/**
 * Server-side injection of the crown jewels. The Worker accepts a bare messages
 * request (no system, no tools) and adds these back before forwarding to Anthropic,
 * so the prompt + tool catalog live server-side and never ship in the desktop binary.
 *
 * This mirrors what `server/ai/src/llm/anthropic.ts` does in direct-local mode
 * (`toSystemParam` + the tools mapping) — but here it runs in the Worker.
 */

// Computed once at module load — byte-stable and identical across every caller,
// so all users share one Anthropic prompt-cache entry for the prefix.
const SYSTEM_TEXT = buildSystemPrompt().cached;

const TOOLS = AE_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: zodToJsonSchema(t.schema) as Record<string, unknown>,
}));

/**
 * The injected `system` param: the static rules+catalog prefix carrying a
 * `cache_control: ephemeral` breakpoint at the 1-hour tier (§A-9). The Worker owns
 * this prefix breakpoint; the client keeps the rolling conversation breakpoint on the
 * messages it still sends (also normalized to 1h server-side — see normalizeCacheControlTo1h).
 * 1h tier: editors pause 5–60 min between asks, so one 2× write beats re-writing this
 * prefix at the 5-min rate every turn; metering.ts prices cache writes at the matching 2×.
 */
export function injectedSystem(): Array<{ type: 'text'; text: string; cache_control: { type: 'ephemeral'; ttl: '1h' } }> {
  return [{ type: 'text', text: SYSTEM_TEXT, cache_control: { type: 'ephemeral', ttl: '1h' } }];
}

/** The injected tool catalog (name + description + JSON-Schema), from the secret zod defs. */
export function injectedTools(): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  return TOOLS;
}
