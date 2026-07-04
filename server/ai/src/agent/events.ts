import type { ToolUse } from '../llm/types.js';

// ─── Agent turn events ─────────────────────────────────────────────────────────
// Streamed to the panel as a turn runs (narrate-as-you-work, like Claude Code).
// Per-iteration granularity: assistant narration is pushed whole after each model
// call; tool activity is pushed as a start/end pair around each execution. Upgrading
// to token-level streaming later swaps chat()→stream() inside the loop without
// changing this event shape.

export type AgentEvent =
  | { type: 'turn_start' }
  // `turnId` (ms timestamp) keys this turn's pre-turn backup + its persisted history line, so the UI
  // can restore to before this exact request.
  | { type: 'snapshot'; ok: boolean; path?: string; turnId?: string; reason?: string }
  | { type: 'text'; text: string }
  | { type: 'tool_start'; id: string; name: string; label: string }
  // `noop` = the call succeeded but changed nothing (handler returned status:"noop", e.g. "undo that"
  // with nothing left to undo). The row renders as a neutral outcome (not a success check); `label`
  // carries the finalized, outcome-accurate label that replaces the optimistic tool_start one.
  | { type: 'tool_end'; id: string; ok: boolean; errorCode?: string; retried?: boolean; noop?: boolean; label?: string }
  | { type: 'steer'; id: string; text: string }
  // `discarded` = the stop landed before any output was produced → the turn is thrown away entirely
  // (prompt returns to the composer, nothing persisted, no "Stopped" marker). Otherwise a partial turn
  // was kept and a marker is shown.
  | { type: 'cancelled'; discarded?: boolean }
  // History compaction: older turns summarized to stay under the context window. 'done' also
  // covers a /clear (reason: 'cleared'). 'failed' is a soft notice — the turn still proceeds.
  // `summary` carries the AI's recap text on a real 'done' (absent for no-op/clear/failed) so the
  // panel can render a collapsible "View summary" row. `keptTurns` (present alongside `summary` on a
  // real 'done') is how many recent turns stayed verbatim — the host uses it to place the persisted
  // compaction marker at the cut boundary, and the renderer uses it to insert the live divider there.
  | { type: 'compaction'; status: 'start' | 'done' | 'failed'; reason?: string; summary?: string; keptTurns?: number }
  // Hard ceiling: compaction can't free enough room, so the turn is paused. A call-to-action
  // (start a new conversation), NOT an error — the panel renders it differently.
  | { type: 'context_full'; message: string }
  // `status` (when present) is the HTTP status the proxy returned (401 signed-out / 402 not-paid-or-over-cap
  // / 429 rate-limited); `reason` is the machine-readable 402 sub-state ('no_plan' | 'over_cap') the client
  // + §D paywall route on. Surfaced so the renderer can map to a specific message (WT-PROXY-GATING §C-6).
  | { type: 'error'; message: string; status?: number; reason?: string }
  | { type: 'done'; stopReason: string };

export type EmitFn = (event: AgentEvent) => void;

/**
 * Sentinel committed (as an assistant turn) when the user stops a turn, so the interruption is part
 * of the saved history: it survives reload, tells the model the turn was cut short, and is rendered
 * as a muted "Stopped" marker (not a normal assistant bubble) by the display-item transform. Assistant
 * role keeps user/assistant alternation valid no matter where the stop lands. Claude Code's convention.
 */
export const INTERRUPTED_MARKER = '[Request interrupted by user]';

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
  createFolder: (p) => (p.name ? `Created folder "${String(p.name)}"` : 'Created a folder'),
  updateProjectItem: (p) => {
    const moving = p.parentFolderId != null || p.parentFolderName != null;
    if (p.newName && moving) return `Renamed & moved "${String(p.newName)}"`;
    if (p.newName) return `Renamed to "${String(p.newName)}"`;
    if (moving) return 'Moved a project item';
    return 'Updated a project item';
  },
  addMarker: () => 'Added a marker',
  saveProject: () => 'Saved the project',
  restoreProject: () => 'Restored a backup',
};

/** Friendly label for a single command (used standalone and inside a batch). */
function describeCommand(script: string, params: Params): string {
  const fn = SCRIPT_LABELS[script];
  return fn ? fn(params) : (script ? readableDefault(script) : 'a command');
}

/**
 * Friendly label for a batch turn. Prefers the model's groupLabel (its own intent
 * summary); otherwise synthesizes from the sub-commands ("Added text layer + 2 more")
 * so the label is always descriptive and never exposes "batch"/raw command names.
 */
function describeBatch(params: Params): string {
  if (params.groupLabel) return String(params.groupLabel);
  const cmds = Array.isArray(params.commands) ? params.commands : [];
  if (cmds.length === 0) return 'Made a change';
  const first = (cmds[0] ?? {}) as Params;
  const firstLabel = describeCommand(
    String(first.command ?? first.script ?? ''),
    ((first.args ?? first.parameters) ?? {}) as Params,
  );
  const rest = cmds.length - 1;
  return rest > 0 ? `${firstLabel} + ${rest} more` : firstLabel;
}

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
      const params = (obj.parameters ?? {}) as Params;
      // batch is usually invoked via runScript({script:"batch"}) per the prompt — route it
      // through the same batch labeller so the chat row + undo entry stay descriptive.
      if (script === 'batch') return describeBatch(params);
      return describeCommand(script, params);
    }
    case 'batch':
      return describeBatch(obj);
    case 'createComposition':
      return obj.name ? `Created composition "${String(obj.name)}"` : 'Created a composition';
    default:
      return readableDefault(name);
  }
}

/**
 * Per-command "nothing changed" phrases, shown on the muted noop row when a handler returned
 * status:"noop" (the end-state already held, or there was nothing to remove). Honest, plain-English,
 * sized for a non-technical editor. A few branch on the request (parent vs unparent, enable vs
 * disable, set vs remove) — those are functions of the parameters, never of resolved AE state.
 * The long tail (and any future noop) falls through to the generic "No change".
 */
const NOOP_SCRIPT_LABELS: Record<string, string | ((p: Params) => string)> = {
  // Idempotent — value already what was asked for
  setLayerProperty: 'Already set to that value',
  setEffectProperty: 'Already set to that value',
  setShapeOperatorProperty: 'Already set to that value',
  setTextAnimatorProperty: 'Already set to that value',
  setTextAnimatorRangeSelector: 'Already set to those values',
  setCompositionProperties: 'Already set to those values',
  setLayerProperties: 'Already set to those values',
  batchSetLayerProperties: 'Already set to those values',
  setLayerMask: 'Already set to those values',
  updateMarker: 'Already set to those values',
  setCurrentTime: 'Playhead already there',
  setSelectedLayers: 'Already selected',
  moveLayer: 'Already in that position',
  setLayerParent: (p) => (p.parentIndex != null || p.parentName != null ? 'Already has that parent' : 'Already has no parent'),
  setAnchorPoint: 'Anchor already there',
  centerAnchorPoint: 'Anchor already centered',
  trimLayer: 'Already trimmed to that range',
  alignLayers: 'Already aligned',
  sequenceLayers: 'Already sequenced',
  setTimeRemapEnabled: (p) => (p.enabled ? 'Already enabled' : 'Already disabled'),
  setTrackMatte: 'Already set as that matte',
  updateProjectItem: 'Already named that and in that folder',
  setLayerKeyframe: 'Keyframe already set there',
  setLayerExpression: (p) => (p.expressionString === '' && !p.preset ? 'No expression to remove' : 'Expression already set'),
  // Nothing to remove / undo
  removePropertyKeyframes: 'No keyframes to remove',
  removeMarker: 'No markers to remove',
  deleteUnusedSolids: 'No unused solids to remove',
  saveProject: 'Already saved',
  restoreProject: 'Nothing to undo',
  batch: 'No changes needed',
};

/** Resolve a NOOP_SCRIPT_LABELS entry (string or param-branching fn) to its phrase. */
function noopLabelFor(script: string, params: Params): string | undefined {
  const entry = NOOP_SCRIPT_LABELS[script];
  return typeof entry === 'function' ? entry(params) : entry;
}

/**
 * Finalized label for a tool call that changed nothing (handler returned status:"noop"). Mirrors
 * describeToolCall's runScript/batch unwrapping; falls back to a generic "No change" so ANY future
 * command that returns a noop reads honestly without per-tool wiring.
 */
export function describeToolNoop(name: string, input: unknown): string {
  const obj = (input ?? {}) as Params;
  if (name === 'runScript') {
    const script = String(obj.script ?? '');
    return noopLabelFor(script, (obj.parameters ?? {}) as Params) ?? 'No change';
  }
  if (name === 'batch') return noopLabelFor('batch', obj) ?? 'No change';
  return 'No change';
}

// ─── Result-based labels (the specific ones) ───────────────────────────────────
// Every mutating handler echoes the RESOLVED name/value in its success payload (e.g. deleteLayer →
// { deleted: { name } }, setLayerProperty → { property: { name, value } }) — even when the model
// targeted by index. Reading those makes rows specific ("Deleted layer \"BG\"", "Set Opacity to 50%")
// instead of generic. describeToolResult() is the source of truth for a SUCCEEDED call's final label;
// describeToolCall (input-based) stays the instant/running label and the fallback.

/** Walk a nested path on an unknown object; returns undefined if any hop is missing. */
function pick(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Non-empty string or undefined (treats null/empty as absent). */
function s(v: unknown): string | undefined {
  if (v == null) return undefined;
  const t = String(v);
  return t.length ? t : undefined;
}

/** Element count of an array-ish value. */
function len(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

const q = (v: unknown): string => `"${String(v)}"`;

/** Compact number: integers as-is, else rounded to 2 dp. */
function num(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/** Unit suffix inferred from an AE property's display name (Opacity → %, Rotation → °). */
function unitFor(prop: string): string {
  const p = prop.toLowerCase();
  if (p.includes('opacity')) return '%';
  if (p.includes('rotation') || p.includes('skew') || p.includes('angle')) return '°';
  return '';
}

/**
 * Friendly trailing clause for a property value — " to 50%", " on"/" off" — but ONLY for values that
 * read cleanly for a non-technical editor. Vectors/colors/objects/long strings return '' so the label
 * stays name-only ("Set Position", not "Set Position to [960,540,0]").
 */
function formatValue(prop: string, value: unknown): string {
  if (typeof value === 'number') return ` to ${num(value)}${unitFor(prop)}`;
  if (typeof value === 'boolean') return value ? ' on' : ' off';
  if (typeof value === 'string' && value.length > 0 && value.length <= 30) return ` to ${value}`;
  return '';
}

/** "Set <prop>[ to X]" from a result's { property: { name, value } }. */
function setPropLabel(r: Params, prefix = 'Set'): string | undefined {
  const prop = s(pick(r, 'property', 'name'));
  if (!prop) return undefined;
  return `${prefix} ${prop}${formatValue(prop, pick(r, 'property', 'value'))}`;
}

const RESULT_LABELS: Record<string, (r: Params) => string | undefined> = {
  // Layers
  createLayer: (r) => {
    const nm = s(pick(r, 'layer', 'name'));
    if (!nm) return undefined;
    const type = s(pick(r, 'layer', 'type'));
    return `Added ${type ? `${type} ` : ''}layer ${q(nm)}`;
  },
  deleteLayer: (r) => { const nm = s(pick(r, 'deleted', 'name')); return nm ? `Deleted layer ${q(nm)}` : undefined; },
  duplicateLayer: (r) => { const nm = s(pick(r, 'duplicate', 'name')); return nm ? `Duplicated layer ${q(nm)}` : undefined; },
  setLayerProperties: (r) => { const nm = s(pick(r, 'layer', 'name')); return nm ? `Adjusted layer ${q(nm)}` : undefined; },
  setLayerProperty: (r) => setPropLabel(r),
  batchSetLayerProperties: (r) => { const n = len(r.results); return n ? `Adjusted ${n} layer${n === 1 ? '' : 's'}` : undefined; },
  setLayerParent: (r) => {
    const nm = s(pick(r, 'layer', 'name'));
    if (!nm) return undefined;
    const parent = s(pick(r, 'layer', 'parent', 'name'));
    return parent ? `Parented ${q(nm)} to ${q(parent)}` : `Un-parented ${q(nm)}`;
  },
  moveLayer: (r) => { const nm = s(pick(r, 'layer', 'name')); return nm ? `Reordered ${q(nm)}` : undefined; },
  alignLayers: (r) => { const n = len(r.modifiedLayers); return n ? `Aligned ${n} layer${n === 1 ? '' : 's'}` : undefined; },
  sequenceLayers: (r) => { const n = len(r.modifiedLayers); return n ? `Sequenced ${n} layer${n === 1 ? '' : 's'}` : undefined; },
  setAnchorPoint: (r) => { const nm = s(pick(r, 'layer', 'name')); return nm ? `Set anchor point on ${q(nm)}` : undefined; },
  centerAnchorPoint: (r) => { const nm = s(pick(r, 'layer', 'name')); return nm ? `Centered anchor point on ${q(nm)}` : undefined; },
  splitLayer: (r) => { const nm = s(pick(r, 'original', 'name')); return nm ? `Split ${q(nm)}` : undefined; },
  mergeLayer: (r) => { const nm = s(pick(r, 'layer', 'name')); return nm ? `Merged ${q(nm)}` : undefined; },
  trimLayer: (r) => { const nm = s(pick(r, 'layer', 'name')); return nm ? `Trimmed ${q(nm)}` : undefined; },
  setTimeRemapEnabled: (r) => {
    const nm = s(pick(r, 'layer', 'name'));
    if (!nm) return undefined;
    return `${pick(r, 'timeRemapEnabled') ? 'Enabled' : 'Disabled'} time remap on ${q(nm)}`;
  },
  precompose: (r) => { const nm = s(pick(r, 'newComp', 'name')); return nm ? `Pre-composed into ${q(nm)}` : undefined; },
  decomposeLayer: (r) => { const nm = s(pick(r, 'removedPrecomp', 'name')); return nm ? `Un-nested ${q(nm)}` : undefined; },
  setTrackMatte: (r) => { const nm = s(pick(r, 'layer', 'name')); return nm ? `Set track matte on ${q(nm)}` : undefined; },
  setSelectedLayers: (r) => {
    const n = len(r.selectedLayers);
    return n ? `Selected ${n} layer${n === 1 ? '' : 's'}` : undefined;
  },
  distributeLayers3D: (r) => { const n = len(r.positionedLayers); return n ? `Arranged ${n} layers in 3D` : undefined; },
  // Compositions
  createComposition: (r) => { const nm = s(pick(r, 'composition', 'name')); return nm ? `Created composition ${q(nm)}` : undefined; },
  setCompositionProperties: (r) => { const nm = s(pick(r, 'composition', 'name')); return nm ? `Adjusted composition ${q(nm)}` : undefined; },
  deleteComposition: (r) => { const nm = s(pick(r, 'deleted', 'name')); return nm ? `Deleted composition ${q(nm)}` : undefined; },
  duplicateComposition: (r) => {
    const nm = s(pick(r, 'duplicate', 'name')) ?? s(pick(r, 'rootDuplicate', 'name'));
    return nm ? `Duplicated composition ${q(nm)}` : undefined;
  },
  setCurrentTime: (r) => {
    const t = pick(r, 'timeInSeconds');
    return typeof t === 'number' ? `Moved playhead to ${num(t)}s` : undefined;
  },
  // Keyframes / expressions
  setLayerKeyframe: (r) => { const p = s(pick(r, 'property', 'name')); return p ? `Keyframed ${p}` : undefined; },
  setKeyframeEasing: (r) => { const p = s(pick(r, 'property', 'name')); return p ? `Eased ${p} keyframes` : undefined; },
  setKeyframeSpatial: (r) => { const p = s(pick(r, 'property', 'name')); return p ? `Adjusted ${p} motion path` : undefined; },
  removePropertyKeyframes: (r) => { const p = s(pick(r, 'property', 'name')); return p ? `Cleared ${p} keyframes` : undefined; },
  setLayerExpression: (r) => {
    const preset = s(pick(r, 'preset'));
    if (preset) return `Added ${preset.toLowerCase()} expression`;
    const p = s(pick(r, 'property', 'name'));
    return p ? `Set ${p} expression` : undefined;
  },
  // Masks
  setLayerMask: (r) => { const nm = s(pick(r, 'layer', 'name')); return nm ? `Set mask on ${q(nm)}` : undefined; },
  deleteLayerMask: (r) => { const nm = s(pick(r, 'layer', 'name')); return nm ? `Deleted mask from ${q(nm)}` : undefined; },
  // Effects
  applyEffect: (r) => {
    const eff = s(pick(r, 'effect', 'name'));
    if (!eff) return undefined;
    const nm = s(pick(r, 'layer', 'name'));
    return nm ? `Applied ${eff} to ${q(nm)}` : `Applied ${eff}`;
  },
  applyEffectTemplate: (r) => {
    const eff = s(pick(r, 'appliedEffects', '0', 'name'));
    if (!eff) return undefined;
    const nm = s(pick(r, 'layer', 'name'));
    return nm ? `Applied ${eff} to ${q(nm)}` : `Applied ${eff}`;
  },
  setEffectProperty: (r) => {
    const eff = s(pick(r, 'effect', 'name'));
    const prop = s(pick(r, 'property', 'name'));
    if (!prop) return undefined;
    return `Set ${eff ? `${eff} ` : ''}${prop}${formatValue(prop, pick(r, 'property', 'value'))}`;
  },
  deleteEffect: (r) => {
    const eff = s(pick(r, 'deleted', 'name'));
    if (!eff) return undefined;
    const nm = s(pick(r, 'layer', 'name'));
    return nm ? `Removed ${eff} from ${q(nm)}` : `Removed ${eff}`;
  },
  // Text
  addTextAnimator: (r) => { const nm = s(pick(r, 'animator', 'name')); return nm ? `Added text animator ${q(nm)}` : undefined; },
  setTextAnimatorProperty: (r) => setPropLabel(r),
  setTextAnimatorRangeSelector: (r) => { const nm = s(pick(r, 'animator', 'name')); return nm ? `Adjusted range selector on ${q(nm)}` : undefined; },
  explodeTextLayer: (r) => { const n = len(r.createdLayers); return n ? `Split text into ${n} layers` : undefined; },
  // Shapes
  addShapeOperator: (r) => { const nm = s(pick(r, 'operator', 'name')) ?? s(pick(r, 'operator', 'type')); return nm ? `Added ${nm} to shape` : undefined; },
  setShapeOperatorProperty: (r) => setPropLabel(r),
  convertToShape: (r) => { const nm = s(pick(r, 'shapeLayer', 'name')); return nm ? `Converted ${q(nm)} to shapes` : undefined; },
  // Markers
  addMarker: (r) => { const c = s(pick(r, 'marker', 'comment')); return c ? `Added marker ${q(c)}` : 'Added a marker'; },
  updateMarker: () => 'Updated a marker',
  removeMarker: () => 'Removed a marker',
  // Footage / project
  importFootage: (r) => { const nm = s(pick(r, 'item', 'name')); return nm ? `Imported ${nm}` : undefined; },
  addFootageToComp: (r) => { const nm = s(pick(r, 'layer', 'name')); return nm ? `Added ${q(nm)} to the comp` : undefined; },
  importAssetToComp: (r) => { const nm = s(pick(r, 'item', 'name')); return nm ? `Imported ${nm}` : undefined; },
  deleteProjectItem: (r) => { const nm = s(pick(r, 'deleted', 'name')); return nm ? `Deleted ${q(nm)}` : undefined; },
  deleteUnusedSolids: (r) => { const n = pick(r, 'count'); return typeof n === 'number' ? `Removed ${n} unused solid${n === 1 ? '' : 's'}` : undefined; },
  createFolder: (r) => { const nm = s(pick(r, 'folder', 'name')); return nm ? `Created folder ${q(nm)}` : undefined; },
  updateProjectItem: (r) => {
    const nm = s(pick(r, 'item', 'name'));
    if (!nm) return undefined;
    const moved = pick(r, 'moved') === true;
    const renamed = pick(r, 'renamed') === true;
    if (renamed && moved) return `Renamed & moved to ${q(nm)}`;
    if (renamed) return `Renamed to ${q(nm)}`;
    if (moved) return `Moved ${q(nm)}`;
    return `Updated ${q(nm)}`;
  },
};

/**
 * Finalized label for a SUCCEEDED tool call, built from the handler's result payload. Specific where
 * the result carries a resolved name/value; otherwise falls back to describeToolCall (input-based) —
 * so failures, batch (groupLabel), and the vague long tail still read cleanly and never show raw JSON.
 */
export function describeToolResult(name: string, input: unknown, result: unknown): string {
  const r = (result ?? {}) as Params;
  // createComposition/batch are typed tools (name is the command); everything else is a runScript.
  const script = name === 'runScript' ? String((input as Params)?.script ?? '') : name;
  return RESULT_LABELS[script]?.(r) || describeToolCall(name, input);
}

export type { ToolUse };
