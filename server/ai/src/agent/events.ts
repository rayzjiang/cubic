import type { ToolUse } from '../llm/types.js';

// ─── Agent turn events ─────────────────────────────────────────────────────────
// Streamed to the panel as a turn runs (narrate-as-you-work, like Claude Code).
// Per-iteration granularity: assistant narration is pushed whole after each model
// call; tool activity is pushed as a start/end pair around each execution. Upgrading
// to token-level streaming later swaps chat()→stream() inside the loop without
// changing this event shape.

export type AgentEvent =
  | { type: 'turn_start' }
  | { type: 'snapshot'; ok: boolean; path?: string; reason?: string }
  | { type: 'text'; text: string }
  | { type: 'tool_start'; id: string; name: string; label: string }
  | { type: 'tool_end'; id: string; ok: boolean; errorCode?: string; retried?: boolean }
  | { type: 'steer'; id: string; text: string }
  | { type: 'cancelled' }
  // History compaction: older turns summarized to stay under the context window. 'done' also
  // covers a /clear (reason: 'cleared'). 'failed' is a soft notice — the turn still proceeds.
  | { type: 'compaction'; status: 'start' | 'done' | 'failed'; reason?: string }
  // Hard ceiling: compaction can't free enough room, so the turn is paused. A call-to-action
  // (start a new conversation), NOT an error — the panel renders it differently.
  | { type: 'context_full'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done'; stopReason: string };

export type EmitFn = (event: AgentEvent) => void;

type Params = Record<string, unknown>;

/** File basename from an abs path (handles / and \). */
function baseName(p: unknown): string {
  const s = String(p ?? '');
  const parts = s.split(/[/\\]/);
  return parts[parts.length - 1] || s;
}

/** "N layer(s)" from a layerIndices array. */
function nLayers(p: unknown): string {
  const n = Array.isArray(p) ? p.length : 1;
  return `${n} layer${n === 1 ? '' : 's'}`;
}

/** camelCase command name → readable sentence, e.g. "setTimeRemapEnabled" → "Set time remap enabled". */
function readableDefault(script: string): string {
  const spaced = script.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Friendly, plain-English labels for the common `runScript` commands — these are what a
 * non-technical video editor sees in the per-action rows (live + history). Past-tense so they
 * read naturally beside a completion check; the brief running moment shows a spinner alongside.
 * The long tail falls through to `readableDefault` (de-camelCased), never raw JSON.
 */
const SCRIPT_LABELS: Record<string, (p: Params) => string> = {
  // Layers — create / structure
  createLayer: (p) => `Added ${String(p.type ?? '')} layer${p.name ? ` "${p.name}"` : ''}`.replace('  ', ' '),
  duplicateLayer: () => 'Duplicated a layer',
  deleteLayer: () => 'Deleted a layer',
  setLayerProperties: () => 'Adjusted a layer',
  setLayerProperty: () => 'Adjusted a layer',
  batchSetLayerProperties: () => 'Adjusted layers',
  setLayerParent: () => 'Parented a layer',
  moveLayer: () => 'Reordered a layer',
  alignLayers: () => 'Aligned layers',
  sequenceLayers: () => 'Sequenced layers',
  setAnchorPoint: () => 'Set the anchor point',
  centerAnchorPoint: () => 'Centered the anchor point',
  splitLayer: () => 'Split a layer',
  trimLayer: () => 'Trimmed a layer',
  precompose: () => 'Pre-composed layers',
  decomposeLayer: () => 'Un-nested a pre-comp',
  setTrackMatte: () => 'Set a track matte',
  // Compositions
  createComposition: (p) => (p.name ? `Created composition "${p.name}"` : 'Created a composition'),
  setCompositionProperties: () => 'Adjusted the composition',
  deleteComposition: () => 'Deleted a composition',
  duplicateComposition: () => 'Duplicated a composition',
  setCurrentTime: () => 'Moved the playhead',
  // Keyframes / expressions / motion
  setLayerKeyframe: () => 'Set a keyframe',
  setKeyframeEasing: () => 'Eased keyframes',
  setKeyframeSpatial: () => 'Adjusted the motion path',
  removePropertyKeyframes: () => 'Cleared keyframes',
  copyKeyframeEasing: () => 'Copied easing',
  setLayerExpression: (p) => (p.preset ? `Added ${String(p.preset)} expression` : 'Set an expression'),
  applyMotionRecipe: (p) => `Applied ${String(p.recipe ?? 'motion')} to ${nLayers(p.layerIndices)}`,
  distributeLayers3D: () => 'Arranged layers in 3D',
  // Effects
  applyEffect: (p) => `Applied ${String(p.effectName ?? p.effectMatchName ?? 'an effect')}`,
  applyEffectTemplate: (p) => `Applied ${String(p.templateName ?? 'an effect')}`,
  setEffectProperty: () => 'Adjusted an effect',
  deleteEffect: () => 'Removed an effect',
  // Text / shapes
  addTextAnimator: () => 'Added a text animator',
  setTextAnimatorProperty: () => 'Adjusted a text animator',
  explodeTextLayer: () => 'Split text into layers',
  addShapeOperator: () => 'Added a shape operator',
  setShapeOperatorProperty: () => 'Adjusted a shape',
  convertToShape: () => 'Converted to shapes',
  // Masks
  setLayerMask: () => 'Set a mask',
  deleteLayerMask: () => 'Deleted a mask',
  // Footage / project
  importFootage: (p) => `Imported ${baseName(p.filePath)}`,
  importAssetToComp: (p) => `Imported ${baseName(p.filePath)}`,
  addFootageToComp: () => 'Added footage to the comp',
  deleteProjectItem: () => 'Deleted a project item',
  addMarker: () => 'Added a marker',
  saveProject: () => 'Saved the project',
  restoreProject: () => 'Restored a backup',
};

/**
 * Human-readable label for a tool call, shown in the chat's per-action row
 * (e.g. "Added solid layer \"BG\"", "Applied Glow", "Created composition \"Intro\"").
 * Never exposes raw tool JSON.
 */
export function describeToolCall(name: string, input: unknown): string {
  const obj = (input ?? {}) as Params;
  switch (name) {
    case 'runScript': {
      const script = String(obj.script ?? '');
      const fn = SCRIPT_LABELS[script];
      return fn ? fn((obj.parameters ?? {}) as Params) : (script ? readableDefault(script) : 'Ran a command');
    }
    case 'batch': {
      const n = Array.isArray(obj.commands) ? obj.commands.length : 0;
      return obj.groupLabel ? String(obj.groupLabel) : `Made ${n} change${n === 1 ? '' : 's'}`;
    }
    case 'createComposition':
      return obj.name ? `Created composition "${String(obj.name)}"` : 'Created a composition';
    default:
      return readableDefault(name);
  }
}

export type { ToolUse };
