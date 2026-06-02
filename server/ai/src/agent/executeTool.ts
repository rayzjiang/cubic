import { mcpClient } from '../mcp/client.js';
import { sessionCache } from '../context/cache.js';
import type { ToolUse, ToolResultBlock } from '../llm/types.js';

/**
 * Commands that only READ AE state — running one does not require a sessionCache
 * invalidation. Mirrors READ_ONLY_COMMANDS in server/mcp/src/scripts/mcp-bridge.jsx.
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

export interface ToolExecution {
  /** The tool_result block appended to history for the model to read. */
  block: ToolResultBlock;
  ok: boolean;
  errorCode?: string;
  /** True if the call was retried (transient error). */
  retried: boolean;
}

/** Maps a model tool call to the (command, args) pair the bridge understands. */
function toCommandCall(tool: ToolUse): { command: string; args: Record<string, unknown> } {
  const input = (tool.input ?? {}) as Record<string, unknown>;
  switch (tool.name) {
    case 'runScript':
      return { command: String(input.script ?? ''), args: (input.parameters as Record<string, unknown>) ?? {} };
    case 'batch': {
      // Batch sub-commands use the model-facing { script, parameters } shape (same as
      // runScript); the bridge's batch handler reads { command, args }. Translate each
      // entry here — the single model→bridge naming boundary — so the model keeps one
      // uniform command shape everywhere.
      const rawCommands = Array.isArray(input.commands) ? input.commands : [];
      const commands = rawCommands.map((c) => {
        const entry = (c ?? {}) as Record<string, unknown>;
        return { command: String(entry.script ?? ''), args: (entry.parameters as Record<string, unknown>) ?? {} };
      });
      return { command: 'batch', args: { ...input, commands } };
    }
    case 'createComposition':
      return { command: 'createComposition', args: input };
    default:
      // Unknown tool name — pass through so AE returns a structured UNKNOWN_COMMAND
      // the model can read and self-correct from.
      return { command: String(tool.name), args: input };
  }
}

interface RawOutcome {
  ok: boolean;
  errorCode?: string;
  content: string;
}

async function runOnce(command: string, args: Record<string, unknown>): Promise<RawOutcome> {
  try {
    const result = await mcpClient.callRunScript(command, args);
    // Handler-level errors come back as a successful bridge response whose JSON has
    // status:"error" — surface them as an error tool_result, not a thrown turn.
    if (result && typeof result === 'object' && (result as { status?: string }).status === 'error') {
      const r = result as { errorCode?: string };
      return { ok: false, errorCode: r.errorCode, content: JSON.stringify(result) };
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
export async function executeTool(tool: ToolUse): Promise<ToolExecution> {
  const { command, args } = toCommandCall(tool);

  let outcome = await runOnce(command, args);
  let retried = false;
  if (!outcome.ok && outcome.errorCode && RETRYABLE.has(outcome.errorCode)) {
    retried = true;
    outcome = await runOnce(command, args);
  }

  if (outcome.ok && !READ_ONLY_COMMANDS.has(command)) {
    sessionCache.invalidate();
  }

  return {
    block: { type: 'tool_result', tool_use_id: tool.id, content: outcome.content, is_error: !outcome.ok },
    ok: outcome.ok,
    errorCode: outcome.errorCode,
    retried,
  };
}
