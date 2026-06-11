import { getLLM } from '../llm/index.js';
import { AE_TOOLS } from '../tools/definitions.js';
import { buildContext as defaultBuildContext } from '../context/buildContext.js';
import { buildSystemPrompt as defaultBuildSystemPrompt } from '../prompt/buildSystemPrompt.js';
import { executeTool as defaultExecuteTool, type ToolExecution } from './executeTool.js';
import { snapshotProject as defaultSnapshot, type SnapshotResult } from './snapshot.js';
import { describeToolCall, type EmitFn } from './events.js';
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
  executeTool: (tool: ToolUse) => Promise<ToolExecution>;
  snapshot: (turnId: string) => Promise<SnapshotResult>;
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
      const snap = await snapshot(String(Date.now()));
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

      const response = await llm.chat(session.messages, { systemPrompt, tools: AE_TOOLS, model });
      session.lastContextTokens = contextTokensOf(response.usage);

      // The model itself reports the prompt was too large to process — pause honestly.
      if (response.stopReason === 'model_context_window_exceeded') {
        emit({ type: 'context_full', message: 'This conversation is too long to continue. Please start a new one.' });
        return;
      }

      commit({ role: 'assistant', content: assistantContent(response.content, response.toolUses) });

      if (response.content) emit({ type: 'text', text: response.content });

      if (response.toolUses.length === 0) {
        emit({ type: 'done', stopReason: response.stopReason });
        return;
      }

      const toolResults: ContentBlock[] = [];
      for (const tool of response.toolUses) {
        emit({ type: 'tool_start', id: tool.id, name: tool.name, label: describeToolCall(tool.name, tool.input) });
        const exec = await execute(tool);
        emit({ type: 'tool_end', id: tool.id, ok: exec.ok, errorCode: exec.errorCode, retried: exec.retried });
        toolResults.push(exec.block);
      }

      // Queued steering messages ride along in the SAME user turn as the tool results
      // (the API requires tool_result blocks to immediately follow their tool_use). Drain
      // the WHOLE queue in order — never just the last — so no steer is silently dropped.
      const userContent: ContentBlock[] = [...toolResults];
      if (session.pendingMessages.length) {
        for (const m of session.pendingMessages) {
          emit({ type: 'steer', id: m.id, text: m.text });
          userContent.push({ type: 'text', text: m.text });
        }
        session.pendingMessages = [];
      }
      commit({ role: 'user', content: userContent });
      iter++;
    }

    emit({ type: 'error', message: `Stopped after ${maxIterations} iterations without completing.` });
  } catch (e) {
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
  }
}
