/**
 * SECRETS BARREL — the crown jewels, owned by the proxy/ Worker package and the
 * single source of truth for the system prompt + tool catalog.
 *
 * Two consumers:
 *   1. The Worker (`src/inject.ts`) — injects these into every proxied request so
 *      they live server-side and never ship in the desktop binary.
 *   2. `server/ai` in DIRECT-LOCAL dev only — esbuild aliases `@secrets` here so the
 *      default `npm run dev` flow can call Anthropic directly. The prod packaging
 *      build aliases `@secrets` to a stub instead, so these never enter the binary.
 *
 * Names are NOT secret (they leak as tool_use names anyway) — the client keeps a
 * codegen'd names-only allow-list (`server/ai/src/tools/command-names.generated.ts`)
 * for its dispatch guard; everything in THIS module is the part that must stay server-side.
 */
export { STATIC_RULES } from './rules.js';
export { renderCommandCatalog } from './renderCatalog.js';
export { buildSystemPrompt, type SystemPrompt } from './buildSystemPrompt.js';
export { AE_TOOLS, type ToolDefinition } from './definitions.js';
export { COMMAND_PARAMS, COMMAND_NAMES, type CommandName, type CommandSpec } from './command-params.js';
