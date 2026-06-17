import { getLLM } from '../llm/index.js';
import { AE_TOOLS } from '../tools/definitions.js';
import { buildContext as defaultBuildContext } from '../context/buildContext.js';
import { buildSystemPrompt as defaultBuildSystemPrompt } from '../prompt/buildSystemPrompt.js';
import { executeTool as defaultExecuteTool, type ToolExecution } from './executeTool.js';
import { snapshotProject as defaultSnapshot, type SnapshotResult } from './snapshot.js';
import { describeToolCall, describeToolNoop, describeToolResult, type EmitFn } from './events.js';
import { compactSession, contextTokensOf, COMPACT_THRESHOLD, HARD_CEILING } from './compaction.js';
import type { Session } from './session.js';
import type { LLMProvider, ContentBlock, ToolUse, SystemPromptInput, Message } from '../llm/types.js';
import type { LiveAEState } from '../context/buildContext.js';

const DEFAULT_MAX_ITERATIONS = 15;

/**
 * Injectable collaborators — production uses the real implementations; tests override
 * them to exercise the loop with no network / no AE.
 */
export interface AgentDeps {
  llm: LLMProvider;
  executeTool: (tool: ToolUse, sessionId: string) => Promise<ToolExecution>;
  snapshot: (sessionId: string, turnId: string) => Promise<SnapshotResult>;
  buildContext: () => Promise<LiveAEState>;
  buildSystemPrompt: (state: LiveAEState) => SystemPromptInput;
  /** Model override (default: provider default). */
  model?: string;
  maxIterations?: number;
  /** Set false to skip the pre-turn snapshot (tests / read-only contexts). */
  takeSnapshot?: boolean;
  /** Override the auto-compact trigger fraction (default COMPACT_THRESHOLD). Lets tests force
   *  compaction after a couple of short turns instead of inflating history to ~180K real tokens. */
  compactThreshold?: number;
  /** Override the model's context window (tokens). Same purpose as compactThreshold for tests. */
  contextWindowOverride?: number;
  /** Called once per REAL message committed to history (user prompt, assistant reply, tool-result
   *  user message) — in push order, as it happens. The host uses this to persist the canonical
   *  conversation append-only. Deliberately NOT fired by compaction (which rewrites `messages` in
   *  place for the model context only) so persisted/display history keeps the full conversation. */
  onCommit?: (msg: Message) => void;
}

/** Parse a tool_result's JSON content into the handler's return object (for result-based labeling);
 *  undefined if it isn't JSON. */
function parseResult(content: string): unknown {
  try { return JSON.parse(content); } catch { return undefined; }
}

/** Reconstructs the assistant message (narration text + tool_use blocks) for history. */
function assistantContent(text: string, toolUses: ToolUse[]): string | ContentBlock[] {
  if (toolUses.length === 0) return text;
  const blocks: ContentBlock[] = [];
  if (text) blocks.push({ type: 'text', text });
  for (const tu of toolUses) blocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
  return blocks;
}

/**
 * Runs ONE agent turn: appends the user message, snapshots the project, then loops
 * chat → execute tools → feed tool_result blocks back until the model stops emitting
 * tool calls (`stop_reason !== 'tool_use'`) or the iteration budget is hit. Narration
 * and tool activity are pushed to `emit` as they happen. Self-heals by returning error
 * tool_results for the model to react to (bounded by the iteration budget). Honors
 * cancel + queued-steer at each iteration boundary.
 *
 * Mutates `session.messages` in place so follow-up turns keep the conversation.
 */
export async function runAgentTurn(
  session: Session,
  userText: string,
  emit: EmitFn,
  deps: Partial<AgentDeps> = {},
): Promise<void> {
  if (session.running) {
    emit({ type: 'error', message: 'A turn is already running for this session.' });
    return;
  }

  // `??` short-circuits so getLLM() (which needs an API key) is never called when a
  // test injects deps.llm.
  const llm = deps.llm ?? getLLM();
  const execute = deps.executeTool ?? defaultExecuteTool;
  const snapshot = deps.snapshot ?? defaultSnapshot;
  const buildContext = deps.buildContext ?? defaultBuildContext;
  const buildSystemPrompt = deps.buildSystemPrompt ?? defaultBuildSystemPrompt;
  const maxIterations = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const takeSnapshot = deps.takeSnapshot ?? true;
  const model = deps.model;
  const compactThreshold = deps.compactThreshold ?? COMPACT_THRESHOLD;
  const window = deps.contextWindowOverride ?? llm.contextWindow(model);
  const onCommit = deps.onCommit;

  /** Push a real message to history and notify the host's persistence hook in the same step. */
  const commit = (msg: Message): void => {
    session.messages.push(msg);
    onCommit?.(msg);
  };

  session.running = true;
  session.cancelRequested = false;
  // Per-turn abort handle: a cancel/Stop aborts the in-flight model request immediately instead of
  // waiting for the next iteration boundary (Claude Code-style interrupt).
  const abort = new AbortController();
  session.abortController = abort;

  try {
    // Context-window management at the turn boundary (history always ends on a complete turn here,
    // so compaction never splits a tool_use/tool_result pair).
    if (session.lastContextTokens >= window * HARD_CEILING) {
      // Compaction can't free enough room — pause honestly instead of crashing on overflow.
      emit({ type: 'context_full', message: 'This conversation is too long to continue. Please start a new one.' });
      return;
    }
    if (session.lastContextTokens >= window * compactThreshold) {
      emit({ type: 'compaction', status: 'start' });
      const res = await compactSession(session, { llm, model });
      emit({ type: 'compaction', status: res.ok ? 'done' : 'failed', reason: res.reason });
      // No throw on failure: ~10% headroom remains at the 90% trigger, so we proceed and retry
      // compaction at the next turn boundary. Only the hard ceiling above pauses the turn.
    }

    emit({ type: 'turn_start' });
    commit({ role: 'user', content: userText });

    // Pre-turn revert point. A failed snapshot warns but never blocks the turn —
    // the user still has per-command ⌘Z.
    if (takeSnapshot) {
      const snap = await snapshot(session.id, String(Date.now()));
      emit({ type: 'snapshot', ok: snap.ok, path: snap.path, reason: snap.reason });
    }

    const state = await buildContext();
    const systemPrompt = buildSystemPrompt(state);

    let iter = 0;
    while (iter < maxIterations) {
      // Cancel is honored at iteration boundaries — the history always ends on a valid
      // user/tool_result message here, so a later turn can resume cleanly.
      if (session.cancelRequested) {
        emit({ type: 'cancelled' });
        return;
      }

      const response = await llm.chat(session.messages, { systemPrompt, tools: AE_TOOLS, model, signal: abort.signal });
      session.lastContextTokens = contextTokensOf(response.usage);

      // The model itself reports the prompt was too large to process — pause honestly.
      if (response.stopReason === 'model_context_window_exceeded') {
        emit({ type: 'context_full', message: 'This conversation is too long to continue. Please start a new one.' });
        return;
      }

      // Cancel landed while the response was already in flight (abort didn't beat it): drop the
      // response before committing, so history ends cleanly on the prior user/tool_result message.
      if (session.cancelRequested) {
        emit({ type: 'cancelled' });
        return;
      }

      commit({ role: 'assistant', content: assistantContent(response.content, response.toolUses) });

      if (response.content) emit({ type: 'text', text: response.content });

      if (response.toolUses.length === 0) {
        // The model reached a natural stopping point for its current objective (its report was just
        // emitted above). If the user interjected while it was working, fold the queued message in
        // NOW — as its own user turn, AFTER the current task's output — and continue the same turn,
        // so the original task is always finished and reported before the new message is addressed
        // (never cut off / hijacked). Drain the WHOLE queue in order. Otherwise the turn is done.
        if (session.pendingMessages.length) {
          const steerContent: ContentBlock[] = [];
          for (const m of session.pendingMessages) {
            emit({ type: 'steer', id: m.id, text: m.text });
            steerContent.push({ type: 'text', text: m.text });
          }
          session.pendingMessages = [];
          commit({ role: 'user', content: steerContent });
          iter++;
          continue;
        }
        emit({ type: 'done', stopReason: response.stopReason });
        return;
      }

      // Tool calls — execute and feed the results straight back (the API requires tool_result blocks
      // to immediately follow their tool_use). Queued steers are NOT injected here; they wait for the
      // next no-tool boundary (above), so an in-progress task can't be hijacked by a mid-flight message.
      const toolResults: ContentBlock[] = [];
      for (const tool of response.toolUses) {
        // Cancelled mid-batch: don't start further tools. Satisfy each remaining tool_use with a
        // synthetic interrupted result so the committed assistant message stays valid for resume
        // (every tool_use must have a matching tool_result) — Claude Code's interrupt convention.
        if (session.cancelRequested) {
          toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: '[Request interrupted by user for tool use]', is_error: true });
          continue;
        }
        emit({ type: 'tool_start', id: tool.id, name: tool.name, label: describeToolCall(tool.name, tool.input) });
        const exec = await execute(tool, session.id);
        emit({
          type: 'tool_end', id: tool.id, ok: exec.ok, errorCode: exec.errorCode, retried: exec.retried,
          noop: exec.noop,
          // Swap the optimistic tool_start label for the outcome-accurate one: "Nothing to undo" on a
          // noop; the specific, result-derived label on success ("Deleted layer \"BG\""). On failure,
          // leave it undefined so the input-based tool_start label stands.
          label: exec.noop
            ? describeToolNoop(tool.name, tool.input)
            : exec.ok
              ? describeToolResult(tool.name, tool.input, parseResult(exec.block.content))
              : undefined,
        });
        toolResults.push(exec.block);
      }
      commit({ role: 'user', content: toolResults });
      // Tools committed with valid results (real or synthetic) → history is consistent. If the user
      // cancelled during the batch, stop now rather than looping into another model call.
      if (session.cancelRequested) {
        emit({ type: 'cancelled' });
        return;
      }
      iter++;
    }

    emit({ type: 'error', message: `Stopped after ${maxIterations} iterations without completing.` });
  } catch (e) {
    // A cancel/Stop aborts the in-flight model request → the SDK rejects. Any throw while a cancel is
    // pending is a clean interruption, not an error: stop quietly (history was untouched by the call).
    if (session.cancelRequested) {
      emit({ type: 'cancelled' });
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    // A real context-length error from the API is the same situation as the hard ceiling — pause
    // and ask for a fresh conversation rather than surfacing it as a generic failure.
    if (/context|too long|prompt is too long/i.test(message)) {
      emit({ type: 'context_full', message: 'This conversation is too long to continue. Please start a new one.' });
    } else {
      emit({ type: 'error', message });
    }
  } finally {
    session.running = false;
    session.cancelRequested = false;
    session.abortController = undefined;
  }
}
