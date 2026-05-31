import { getLLM } from '../llm/index.js';
import { AE_TOOLS } from '../tools/definitions.js';
import { buildContext as defaultBuildContext } from '../context/buildContext.js';
import { buildSystemPrompt as defaultBuildSystemPrompt } from '../prompt/buildSystemPrompt.js';
import { executeTool as defaultExecuteTool, type ToolExecution } from './executeTool.js';
import { snapshotProject as defaultSnapshot, type SnapshotResult } from './snapshot.js';
import { describeToolCall, type EmitFn } from './events.js';
import type { Session } from './session.js';
import type { LLMProvider, ContentBlock, ToolUse, SystemPromptInput } from '../llm/types.js';
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

  session.running = true;
  session.cancelRequested = false;

  try {
    emit({ type: 'turn_start' });
    session.messages.push({ role: 'user', content: userText });

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
      session.messages.push({ role: 'assistant', content: assistantContent(response.content, response.toolUses) });

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

      // A queued steering message rides along in the SAME user turn as the tool results
      // (the API requires tool_result blocks to immediately follow their tool_use).
      const userContent: ContentBlock[] = [...toolResults];
      if (session.pendingMessage) {
        emit({ type: 'steer', text: session.pendingMessage });
        userContent.push({ type: 'text', text: session.pendingMessage });
        session.pendingMessage = null;
      }
      session.messages.push({ role: 'user', content: userContent });
      iter++;
    }

    emit({ type: 'error', message: `Stopped after ${maxIterations} iterations without completing.` });
  } catch (e) {
    emit({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    session.running = false;
    session.cancelRequested = false;
  }
}
