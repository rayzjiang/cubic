import type { ToolDefinition, SystemPrompt } from '../llm/types.js';

/**
 * PROD STUB for the `@secrets` chokepoint (the crown jewels live in proxy/src/secrets).
 *
 * - tsconfig `paths` always resolves `@secrets` HERE, so the editor/type-checker see
 *   these (type-correct, empty) signatures and never reach into the proxy package.
 * - esbuild aliases `@secrets` to the REAL proxy secrets for direct-local dev, and back
 *   to THIS stub for the prod packaging build — so the prompt/tool catalog physically
 *   cannot enter the shipped binary.
 * - Vitest aliases `@secrets` to the real proxy secrets so unit tests exercise real tools.
 *
 * Reaching this code at runtime means proxy mode (CUBIC_ENV=prod): the loop never calls
 * these — the Worker injects the system prompt + tools server-side.
 */

export const STATIC_RULES = '';
export function renderCommandCatalog(): string { return ''; }
export function buildSystemPrompt(): SystemPrompt { return { cached: '' }; }
export const AE_TOOLS: ToolDefinition[] = [];
