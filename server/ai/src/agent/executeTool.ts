import { bridgeClient } from '../bridge/client.js';
import { sessionCache } from '../context/cache.js';
import { describeToolCall } from './events.js';
import { COMMAND_PARAMS, type CommandSpec } from '../tools/command-params.js';
import type { ToolUse, ToolResultBlock } from '../llm/types.js';

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
  'getSelectedLayers', 'getSelectionDetails', 'listProjectItems', 'getLayerProperty',
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
  const spec = (COMMAND_PARAMS as Record<string, CommandSpec>)[command];
  if (!spec) return `Unknown command "${command}". Call only commands listed in the command catalog.`;
  if (spec.internal) return `"${command}" is not a callable command. Call only commands listed in the command catalog.`;
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
 * RTK-style proxy trim of a tool result before it enters history. Create/mutate handlers return a
 * `configurableProperties` array per layer/effect ({n:name, p:path, k:keyframeable, v:value, nk:numKeys})
 * — often 100+ entries, 10K+ chars, and re-billed every loop iteration. We keep ONLY {n,p,k}: the model
 * needs the path (`p`) so it never guesses how to address a property, plus the name and keyframeable flag
 * to route setLayerKeyframe vs setLayerProperty. The current value (`v`) and keyframe count (`nk`) are
 * dropped — the model reads those on demand (getLayerProperty/getLayerKeyframes) when it actually needs
 * them. The `{truncated:true}` sentinel is preserved so the model still knows to introspect for more.
 *
 * Only `configurableProperties` arrays are touched (at any nesting depth — top-level, batch sub-results,
 * applyEffect); every other field passes through verbatim, since other large results (getLayerKeyframes,
 * listFonts) are large because their values ARE the signal the model asked for.
 */
const CONFIG_PROP_KEEP = new Set(['n', 'p', 'k', 'truncated']);

function trimConfigEntry(entry: unknown): unknown {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const src = entry as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src)) if (CONFIG_PROP_KEEP.has(key)) out[key] = src[key];
  return out;
}

function deepTrim(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(deepTrim);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = k === 'configurableProperties' && Array.isArray(v) ? v.map(trimConfigEntry) : deepTrim(v);
    }
    return out;
  }
  return node;
}

export function trimConfigurableProperties(content: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return content; } // not JSON (raw string result) — leave as-is
  if (parsed === null || typeof parsed !== 'object') return content;
  return JSON.stringify(deepTrim(parsed));
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
      block: { type: 'tool_result', tool_use_id: tool.id, content: trimConfigurableProperties(outcome.content), is_error: !outcome.ok },
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
