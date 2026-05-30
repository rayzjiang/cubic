import { z } from 'zod';
import type { ToolDefinition } from '../llm/types.js';

/**
 * Curated mirror of the canonical command list in `server/mcp/src/commands.ts`.
 *
 * KEEP IN SYNC: When a new ExtendScript command is added to server/mcp, add its
 * name here too. The drift-guard test (`tests/drift-guard.mjs`) calls `listCommands`
 * over the bridge and fails if this array diverges — CI will catch it.
 *
 * Source of truth: `server/mcp/src/commands.ts` (returned via `listCommands` bridge call).
 */
export const COMMAND_NAMES = [
  // Compositions / project info
  "listCompositions",
  "getProjectInfo",
  "getCompositionInfo",
  "createComposition",
  "setCompositionProperties",
  "deleteComposition",
  "duplicateComposition",
  // Playhead
  "getCurrentTime",
  "setCurrentTime",
  // Layers — selection & info
  "getLayerInfo",
  "getSelectedLayers",
  "getSelectionDetails",
  "setSelectedLayers",
  // Layers — create / duplicate / delete
  "createLayer",
  "duplicateLayer",
  "deleteLayer",
  // Layers — properties
  "setLayerProperties",
  "batchSetLayerProperties",
  "getLayerProperty",
  "setLayerProperty",
  // Layers — hierarchy & transform
  "setLayerParent",
  "moveLayer",
  "setAnchorPoint",
  "centerAnchorPoint",
  "alignLayers",
  "sequenceLayers",
  // Layers — time ops
  "splitLayer",
  "mergeLayer",
  "trimLayer",
  "setTimeRemapEnabled",
  // Layers — nesting / mattes
  "precompose",
  "decomposeLayer",
  "setTrackMatte",
  // Keyframes
  "getLayerKeyframes",
  "setLayerKeyframe",
  "setKeyframeEasing",
  "setKeyframeSpatial",
  "copyKeyframeEasing",
  "removePropertyKeyframes",
  // Expressions
  "getLayerExpressions",
  "setLayerExpression",
  // Masks
  "getLayerMasks",
  "setLayerMask",
  "deleteLayerMask",
  // Effects
  "getLayerEffects",
  "applyEffect",
  "applyEffectTemplate",
  "setEffectProperty",
  "deleteEffect",
  // Text
  "addTextAnimator",
  "setTextAnimatorProperty",
  "setTextAnimatorRangeSelector",
  "explodeTextLayer",
  // Shapes
  "addShapeOperator",
  "setShapeOperatorProperty",
  "convertToShape",
  // Markers
  "addMarker",
  "listMarkers",
  "updateMarker",
  "removeMarker",
  // Footage / project panel
  "listProjectItems",
  "importFootage",
  "addFootageToComp",
  "importAssetToComp",
  "deleteProjectItem",
  "deleteUnusedSolids",
  // Project
  "getProjectPath",
  "saveProject",
  "saveFrameToPng",
  // Motion recipes & 3D
  "applyMotionRecipe",
  "distributeLayers3D",
  // Multi-command
  "batch",
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

// ─── Shared sub-schemas ───────────────────────────────────────────────────────

const CommandCallSchema = z.object({
  script: z.enum(COMMAND_NAMES).describe("Name of the ExtendScript command to run"),
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
 * getHelp — pull the full command catalog + parameter docs + effect match names.
 * The model should call this when it needs specific parameter details for an
 * unfamiliar command rather than guessing.
 */
const getHelpTool: ToolDefinition = {
  name: 'getHelp',
  description:
    'Get the full command catalog with parameter docs, effect templates, and common match names. ' +
    'Call this when you need the exact parameters for an unfamiliar command.',
  schema: z.object({}),
};

/** All four tools exposed to the Claude API. */
export const AE_TOOLS: ToolDefinition[] = [
  runScriptTool,
  batchTool,
  createCompositionTool,
  getHelpTool,
];
