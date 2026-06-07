import { z } from 'zod';
import type { ToolDefinition } from '../llm/types.js';
import { COMMAND_NAMES, type CommandName } from './command-params.js';

/**
 * Command names + per-command parameter docs both come from the single registry
 * in `command-params.ts` (whose keys are kept matching `server/ae-bridge/src/commands.ts`
 * and whose params are kept matching the `.jsx` handlers by `tests/drift-guard.mjs`).
 * Re-exported here so existing importers keep working.
 */
export { COMMAND_NAMES };
export type { CommandName };

// ─── Shared sub-schemas ───────────────────────────────────────────────────────

/**
 * Commands the model may invoke as a single op — every registry command EXCEPT `batch`.
 * `batch` is excluded so it's reachable ONLY through the dedicated `batch` tool (which
 * carries the typed `commands[]` schema), never via `runScript{script:'batch'}` or nested
 * inside another batch. That removes the ambiguous path whose sub-commands could reach AE
 * untranslated. `COMMAND_NAMES` itself is left intact (catalog + drift guard unaffected).
 */
const RUNSCRIPT_COMMANDS = COMMAND_NAMES.filter((n) => n !== 'batch') as [CommandName, ...CommandName[]];

const CommandCallSchema = z.object({
  script: z.enum(RUNSCRIPT_COMMANDS).describe("Name of the ExtendScript command to run"),
  parameters: z.record(z.string(), z.unknown()).optional().describe("Arguments for the command"),
});

// ─── Tool definitions ─────────────────────────────────────────────────────────

/**
 * runScript — primary tool for all single ExtendScript operations.
 * The `script` field is constrained to the known command enum to prevent
 * the model from hallucinating non-existent command names.
 */
const runScriptTool: ToolDefinition = {
  name: 'runScript',
  description:
    'Run a single ExtendScript command in After Effects. ' +
    'Use `batch` instead when you need multiple commands in one turn ' +
    '(batch wraps them in one undo group). ' +
    'Results are returned synchronously.',
  schema: CommandCallSchema,
};

/**
 * batch — run multiple commands in one turn inside a single undo group.
 * The `groupLabel` becomes the single Edit > Undo entry the user sees in AE
 * (e.g. "apply cinematic look to logo") — one ⌘Z reverts the whole turn.
 * Always prefer batch over multiple runScript calls in a single agent turn.
 */
const batchTool: ToolDefinition = {
  name: 'batch',
  description:
    'Run multiple ExtendScript commands in one call, inside a single undo group. ' +
    'Strongly preferred over multiple runScript calls — the user sees one ⌘Z entry. ' +
    'Provide a human-readable `groupLabel` summarising the turn (e.g. "add title layer with fade in").',
  schema: z.object({
    commands: z.array(CommandCallSchema).min(1).describe("Commands to run in order"),
    groupLabel: z.string().optional().describe(
      "Human-readable label for the undo group shown in Edit > Undo (e.g. \"apply cinematic look\")"
    ),
  }),
};

/**
 * createComposition — typed happy-path tool for creating a new comp.
 * Kept as a fully-typed tool (vs. going through runScript) for two reasons:
 * better model guidance and local validation before the call hits AE.
 */
const createCompositionTool: ToolDefinition = {
  name: 'createComposition',
  description: 'Create a new composition in After Effects.',
  schema: z.object({
    name: z.string().describe("Name of the composition"),
    width: z.number().int().positive().describe("Width in pixels"),
    height: z.number().int().positive().describe("Height in pixels"),
    pixelAspect: z.number().positive().optional().describe("Pixel aspect ratio (default: 1.0)"),
    duration: z.number().positive().optional().describe("Duration in seconds (default: 10.0)"),
    frameRate: z.number().positive().optional().describe("Frame rate (default: 30.0)"),
    backgroundColor: z.object({
      r: z.number().int().min(0).max(255),
      g: z.number().int().min(0).max(255),
      b: z.number().int().min(0).max(255),
    }).optional().describe("Background color (RGB 0–255)"),
  }),
};

/**
 * Tools exposed to the Claude API. Per-command parameters are always present in
 * the system prompt's `<command_catalog>` (generated from `command-params.ts`),
 * so there is no `getHelp` lookup tool — the model never needs to fetch docs.
 */
export const AE_TOOLS: ToolDefinition[] = [
  runScriptTool,
  batchTool,
  createCompositionTool,
];
