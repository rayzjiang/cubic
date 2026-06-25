import { bridgeClient } from '../bridge/client.js';
import { sessionCache } from '../context/cache.js';
import { describeToolCall } from './events.js';
import { COMMAND_NAMES, INTERNAL_COMMANDS } from '../tools/command-names.generated.js';
import type { ToolUse, ToolResultBlock } from '../llm/types.js';

/** Names-only allow-list for the dispatch guard, codegen'd from the secret registry
 *  (proxy/src/secrets/command-params.ts). Names aren't secret, so this ships in the
 *  binary; the catalog summaries/schemas stay server-side in the Worker. */
const COMMAND_NAME_SET: ReadonlySet<string> = new Set(COMMAND_NAMES);

/**
 * Commands that only READ AE state — running one does not require a sessionCache
 * invalidation. Mirrors READ_ONLY_COMMANDS in server/ae-bridge/src/scripts/bridge.jsx.
 * Drift here is harmless by design: a missing entry only costs one redundant refetch
 * next turn; a stale entry only serves stale project/comp counts for a single turn
 * (self-heals on the next mutation).
 */
const READ_ONLY_COMMANDS = new Set([
  'getProjectInfo', 'listCompositions', 'getCompositionInfo', 'getLayerInfo',
  'getLayerKeyframes', 'getLayerExpressions', 'getLayerMasks', 'getLayerEffects',
  'getSelectedLayers', 'getSelectionDetails', 'listProjectItems', 'getLayerProperty', 'getLayerProperties',
  'listMarkers', 'getCurrentTime', 'getProjectPath',
]);

/** Error codes worth one automatic retry — transient races, not logic errors. */
const RETRYABLE = new Set(['RENDER_FAILED']);

/**
 * Why the model may NOT call a command: it's absent from the catalog the model was given, or it's an
 * internal-only command (`internal: true`) deliberately hidden from that catalog (e.g. saveFrameToPng,
 * introspectMatchNames). Returns the reason to surface, or null when the command is legitimately
 * model-facing. This is the single guard that stops the model from reaching a hidden command even if
 * it guesses the raw name — the bridge allowlist still contains such commands for internal/test callers.
 */
function modelCallBlockedReason(command: string): string | null {
  if (!COMMAND_NAME_SET.has(command)) return `Unknown command "${command}". Call only commands listed in the command catalog.`;
  if (INTERNAL_COMMANDS.has(command)) return `"${command}" is not a callable command. Call only commands listed in the command catalog.`;
  return null;
}

export interface ToolExecution {
  /** The tool_result block appended to history for the model to read. */
  block: ToolResultBlock;
  ok: boolean;
  errorCode?: string;
  /** True if the call was retried (transient error). */
  retried: boolean;
  /** True if the call succeeded but changed nothing (handler returned status:"noop"). */
  noop?: boolean;
}

/**
 * Coerce a model-supplied argument bag to a real object. Some models (especially smaller ones like
 * Haiku) emit `parameters` — or the whole tool input — as a JSON-encoded STRING instead of a nested
 * object. Left as a string, a downstream `args.__undoLabel = …` throws ("Cannot create property on
 * string"), which escapes executeTool and orphans the assistant tool_use (permanently 400s the chat).
 * Parsing it here makes every entry path hand the bridge — and the meta-field assignment — a real object.
 */
function coerceArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* not JSON — fall through to empty */ }
    return {};
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

/**
 * Normalize batch sub-commands to the bridge's { command, args } shape.
 * Idempotent — accepts the model-facing { script, parameters } OR already-{ command, args },
 * so it's correct no matter how batch was invoked (the dedicated batch tool OR
 * runScript{script:'batch'}).
 */
function normalizeBatchCommands(raw: unknown): Array<{ command: string; args: Record<string, unknown> }> {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => {
    const entry = coerceArgs(c);
    return {
      command: String(entry.command ?? entry.script ?? ''),
      args: coerceArgs(entry.args ?? entry.parameters),
    };
  });
}

/** Maps a model tool call to the (command, args) pair the bridge understands. */
function toCommandCall(tool: ToolUse): { command: string; args: Record<string, unknown> } {
  const input = coerceArgs(tool.input);
  let command: string;
  let args: Record<string, unknown>;
  switch (tool.name) {
    case 'runScript':
      command = String(input.script ?? '');
      args = coerceArgs(input.parameters);
      break;
    case 'batch':
      command = 'batch';
      args = input;
      break;
    case 'createComposition':
      command = 'createComposition';
      args = input;
      break;
    default:
      // Unknown tool name — pass through so AE returns a structured UNKNOWN_COMMAND
      // the model can read and self-correct from.
      command = String(tool.name);
      args = input;
      break;
  }
  // Single choke point: whenever the resolved command is batch — via the dedicated batch
  // tool OR runScript{script:'batch'} — normalize its sub-commands to { command, args }.
  // No entry path can bypass this, so the model's uniform { script, parameters } shape
  // always reaches the bridge correctly.
  if (command === 'batch') {
    args = { ...args, commands: normalizeBatchCommands(args.commands) };
  }
  return { command, args };
}

interface RawOutcome {
  ok: boolean;
  errorCode?: string;
  content: string;
  noop?: boolean;
}

/**
 * RTK-style proxy diet of a tool result before it enters history. One principle: drop anything the model
 * can trivially derive (from another field, its own call, or the tool_result `is_error` flag); keep only
 * genuine signal. Less noise = fewer tokens AND fewer hallucinations. The bridge handlers are untouched —
 * we only reshape the model-facing content here.
 *  - CATALOG: `configurableProperties` is dropped from create/mutate results (the model pulls paths on
 *    demand via getLayerProperties, the ONE command whose catalog is kept via `keepCatalog`).
 *  - STATUS: the `status` key is eliminated — `is_error` on the block already conveys success/error.
 *    success → drop status + boilerplate message; error → drop status, keep errorCode+message; noop → drop
 *    status, add `noop:true` (is_error is false for a noop), keep message; warning → drop status, keep warning.
 *  - HISTORICAL ECHOES: any `previous*`/`prev*`/`old*` key (before-snapshots) — never read by code.
 *  - BATCH/RECEIPTS: the batch envelope's derivable counts + per-sub bookkeeping are dropped and sub-results
 *    inlined; setLayerProperties echoes collapse to identity + changed props' final values.
 *  - READS: getLayerProperty drops its echoed/derivable fields; other reads pass through (their values ARE
 *    the signal).
 */
const FINAL_VALUE_KEYS = new Set([
  'position', 'scale', 'rotation', 'opacity', 'anchorPoint', 'inPoint', 'outPoint',
  'stretch', 'threeDLayer', 'text', 'fontFamily', 'fontSize', 'fillColor',
]);

// Before-snapshot keys (previousValues/previousPositions/prevPos/older/…). Verified: no server/ai code
// reads any; `modifiedLayers` (read by align/sequence labels) does NOT match this, so it survives.
const HISTORICAL_ECHO = /^(previous|prev|old)/;

// Batch ENVELOPE bookkeeping the model never needs — counts derivable from `results`; is_error + each
// surviving sub-result's errorCode carry partial-failure info. (NOT `errorCode` — that's real signal on
// error results; the envelope-level BATCH_FAILED marker is dropped in collapseBatchEnvelope instead.)
const BATCH_ENVELOPE_DROP = new Set(['total', 'executed', 'succeeded', 'failed', 'noopCount', 'stoppedEarly']);

/** Eliminate the `status` key in place (is_error conveys success/error; noop needs an explicit flag). */
function applyStatusSweep(out: Record<string, unknown>): void {
  const st = out.status;
  if (st === undefined) return;
  delete out.status;
  if (st === 'success') { if (out.message !== undefined) delete out.message; } // boilerplate "… successfully"
  else if (st === 'noop') { out.noop = true; }                                 // keep message (the why)
  // 'error' keeps errorCode + message; 'warning' keeps the warning field + payload; unknown → just drop label
}

function deepTrim(node: unknown, keepCatalog: boolean): unknown {
  if (Array.isArray(node)) return node.map((n) => deepTrim(n, keepCatalog));
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (HISTORICAL_ECHO.test(k)) continue;                         // before-snapshots — never read
      if (k === 'configurableProperties' && !keepCatalog) continue;  // pulled on demand via getLayerProperties
      if (BATCH_ENVELOPE_DROP.has(k)) continue;                      // derivable batch counts
      out[k] = deepTrim(v, keepCatalog);
    }
    applyStatusSweep(out);
    return out;
  }
  return node;
}

/** Collapse a write echo to identity + changedProperties + the changed props' final values. */
function collapseLayerReceipt(layer: Record<string, unknown>): Record<string, unknown> {
  const changed = Array.isArray(layer.changedProperties) ? (layer.changedProperties as string[]) : [];
  const out: Record<string, unknown> = {};
  // Identity only — status is already gone (deepTrim ran first). Single echo nests `index`; batch subs `layerIndex`.
  for (const k of ['name', 'index', 'layerIndex']) if (k in layer) out[k] = layer[k];
  out.changedProperties = changed;
  for (const k of changed) if (FINAL_VALUE_KEYS.has(k) && k in layer) out[k] = layer[k];
  return out;
}

function collapseWriteReceipt(node: unknown, command: string): unknown {
  const r = node as Record<string, unknown>;
  if (!r || typeof r !== 'object') return node;
  if (command === 'setLayerProperties' && r.layer && typeof r.layer === 'object') {
    return { ...r, layer: collapseLayerReceipt(r.layer as Record<string, unknown>) };
  }
  if (command === 'batchSetLayerProperties' && Array.isArray(r.results)) {
    // status was stripped by deepTrim, so an error sub is identified by a surviving `errorCode`.
    return {
      ...r,
      results: (r.results as Array<Record<string, unknown>>).map((res) =>
        res && 'errorCode' in res ? res : collapseLayerReceipt(res)),
    };
  }
  return node;
}

/** Collapse the generic `batch` TOOL envelope: inline each sub-result's payload, keep only failure info. */
function collapseBatchEnvelope(node: unknown): unknown {
  const r = node as Record<string, unknown>;
  if (!r || typeof r !== 'object' || !Array.isArray(r.results)) return node;
  const results = (r.results as Array<Record<string, unknown>>).map((sub) => {
    if (!sub || typeof sub !== 'object') return sub;
    const inner = (sub.result && typeof sub.result === 'object') ? (sub.result as Record<string, unknown>) : sub;
    if ('errorCode' in inner) {
      // partial-failure: keep WHICH (command) + WHY (errorCode/message); drop index/success bookkeeping.
      return { command: sub.command, errorCode: inner.errorCode, message: inner.message };
    }
    return inner; // success: inline the handler payload (drop index/command/success + the `result` nesting)
  });
  const out: Record<string, unknown> = { ...r, results };
  delete out.errorCode; // envelope-level BATCH_FAILED marker — is_error conveys it
  return out;
}

/** getLayerProperty read: drop echoed/derivable fields (name=path[-1], echoed path, isTimeVarying). */
function trimReadProperty(node: unknown): unknown {
  const r = node as Record<string, unknown>;
  if (!r || typeof r !== 'object' || !r.property || typeof r.property !== 'object') return node;
  const p = { ...(r.property as Record<string, unknown>) };
  delete p.name;          // === path[-1] (model passed the path)
  delete p.path;          // echoed input
  delete p.isTimeVarying; // = numKeys>0 || hasExpression (derivable)
  return { ...r, property: p };
}

export function trimConfigurableProperties(content: string, command?: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return content; } // not JSON (raw string result) — leave as-is
  if (parsed === null || typeof parsed !== 'object') return content;
  let trimmed = deepTrim(parsed, command === 'getLayerProperties');
  if (command === 'setLayerProperties' || command === 'batchSetLayerProperties') {
    trimmed = collapseWriteReceipt(trimmed, command);
  } else if (command === 'batch') {
    trimmed = collapseBatchEnvelope(trimmed);
  } else if (command === 'getLayerProperty') {
    trimmed = trimReadProperty(trimmed);
  }
  return JSON.stringify(trimmed);
}

async function runOnce(command: string, args: Record<string, unknown>): Promise<RawOutcome> {
  try {
    const result = await bridgeClient.callRunScript(command, args);
    if (result && typeof result === 'object') {
      const status = (result as { status?: string }).status;
      // Handler-level errors come back as a successful bridge response whose JSON has
      // status:"error" — surface them as an error tool_result, not a thrown turn.
      if (status === 'error') {
        const r = result as { errorCode?: string };
        return { ok: false, errorCode: r.errorCode, content: JSON.stringify(result) };
      }
      // status:"noop" — the call succeeded but changed nothing. Still an ok tool_result (the model
      // reads the message), just flagged so the UI row finalizes to a neutral outcome.
      if (status === 'noop') return { ok: true, noop: true, content: JSON.stringify(result) };
    }
    return { ok: true, content: typeof result === 'string' ? result : JSON.stringify(result) };
  } catch (e) {
    // Transport-level failure (timeout / AE disconnected). Return it as a readable
    // error result so the model can react instead of the whole turn throwing.
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      errorCode: 'BRIDGE_ERROR',
      content: JSON.stringify({ status: 'error', errorCode: 'BRIDGE_ERROR', message }),
    };
  }
}

/**
 * Executes one model tool call against AE and returns a tool_result block plus UI
 * metadata. Retries once on a transient error code (e.g. RENDER_FAILED). Invalidates
 * the session cache after any mutating command so the next turn re-reads live state.
 */
export async function executeTool(tool: ToolUse, sessionId?: string): Promise<ToolExecution> {
  // HARD CONTRACT: executeTool must NEVER throw. The agent loop commits the assistant tool_use, then
  // relies on this returning a tool_result to commit right after it. A throw here skips that commit and
  // orphans the tool_use (no tool_result follows) — which the API rejects forever, permanently bricking
  // the conversation. So any unexpected internal failure is converted to a readable error tool_result.
  try {
    const { command, args } = toCommandCall(tool);

    // Guard: refuse any command the model shouldn't reach — not in the catalog, or internal-only —
    // before it can hit the bridge, even a guessed hidden name. Covers the top-level command AND
    // every batch sub-command (so a hidden command can't ride in inside a batch).
    let blocked = modelCallBlockedReason(command);
    if (!blocked && command === 'batch') {
      const subs = (args.commands as Array<{ command?: string }> | undefined) ?? [];
      for (const sub of subs) {
        const reason = modelCallBlockedReason(String(sub?.command ?? ''));
        if (reason) { blocked = `Blocked batch sub-command — ${reason}`; break; }
      }
    }
    if (blocked) {
      return {
        block: { type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify({ status: 'error', errorCode: 'UNKNOWN_COMMAND', message: blocked }), is_error: true },
        ok: false,
        errorCode: 'UNKNOWN_COMMAND',
        retried: false,
      };
    }

    // restoreProject ("undo that") must be scoped to the current chat's backup folder. The model
    // can't know the session id, so the server injects it here — overriding any value the model
    // guessed (it has no business choosing the session).
    if (command === 'restoreProject' && sessionId) args.sessionId = sessionId;

    // Thread the same friendly label the chat row shows down to AE's undo group, so Edit > Undo
    // reads "Cubic: Added text layer" instead of the raw command name. `__undoLabel` is a
    // server-injected meta field (not a model-facing param) — the bridge reads it for the undo
    // group name only; handlers ignore it. Read-only commands skip the undo wrapper, so it's inert there.
    args.__undoLabel = describeToolCall(tool.name, tool.input);

    let outcome = await runOnce(command, args);
    let retried = false;
    if (!outcome.ok && outcome.errorCode && RETRYABLE.has(outcome.errorCode)) {
      retried = true;
      outcome = await runOnce(command, args);
    }

    // A noop changed nothing, so the cached state is still valid — don't invalidate.
    if (outcome.ok && !outcome.noop && !READ_ONLY_COMMANDS.has(command)) {
      sessionCache.invalidate();
    }

    return {
      block: { type: 'tool_result', tool_use_id: tool.id, content: trimConfigurableProperties(outcome.content, command), is_error: !outcome.ok },
      ok: outcome.ok,
      errorCode: outcome.errorCode,
      retried,
      noop: outcome.noop,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      block: {
        type: 'tool_result',
        tool_use_id: tool.id,
        content: JSON.stringify({ status: 'error', errorCode: 'INTERNAL_ERROR', message }),
        is_error: true,
      },
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      retried: false,
    };
  }
}
