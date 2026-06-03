import { describe, it, expect, vi } from 'vitest';
import { runAgentTurn, type AgentDeps } from './loop.js';
import { Session } from './session.js';
import type { ChatResponse, LLMProvider, ToolUse, Message } from '../llm/types.js';
import type { AgentEvent } from './events.js';
import type { ToolExecution } from './executeTool.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const nullState = {
  project: null, activeComp: null, playhead: null, frame: null, selectedLayers: [],
};

function textResponse(text: string): ChatResponse {
  return { content: text, stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 }, toolUses: [] };
}

function toolResponse(toolUses: ToolUse[], text = ''): ChatResponse {
  return { content: text, stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 }, toolUses };
}

const runScriptCall = (id: string, script: string): ToolUse => ({ id, name: 'runScript', input: { script } });

/** A mock provider that replays a scripted sequence of responses and records inputs. */
function mockLLM(responses: ChatResponse[]) {
  const seen: Message[][] = [];
  let i = 0;
  const provider: LLMProvider = {
    chat: async (messages) => {
      seen.push(structuredClone(messages));
      return responses[Math.min(i++, responses.length - 1)];
    },
    // eslint-disable-next-line require-yield
    stream: async function* () { yield { type: 'done' as const }; },
    contextWindow: () => 200_000,
  };
  return { provider, seen, calls: () => i };
}

function okExec(tool: ToolUse): ToolExecution {
  return { block: { type: 'tool_result', tool_use_id: tool.id, content: '{"status":"success"}' }, ok: true, retried: false };
}

/** Base deps that need no network/AE; individual tests override pieces. */
function baseDeps(llm: LLMProvider, over: Partial<AgentDeps> = {}): Partial<AgentDeps> {
  return {
    llm,
    executeTool: async (t) => okExec(t),
    buildContext: async () => nullState,
    buildSystemPrompt: () => 'system',
    takeSnapshot: false,
    ...over,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('runAgentTurn', () => {
  it('executes tool calls, feeds tool_result back, and stops on a non-tool_use turn', async () => {
    const { provider, seen } = mockLLM([
      toolResponse([runScriptCall('t1', 'createLayer')], 'Adding a layer.'),
      textResponse('Done — added the layer.'),
    ]);
    const execute = vi.fn(async (t: ToolUse) => okExec(t));
    const events: AgentEvent[] = [];
    const session = new Session();

    await runAgentTurn(session, 'add a layer', (e) => events.push(e), baseDeps(provider, { executeTool: execute }));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].id).toBe('t1');

    // History: user → assistant(tool_use) → user(tool_result) → assistant(text)
    expect(session.messages).toHaveLength(4);
    expect(session.messages[0]).toEqual({ role: 'user', content: 'add a layer' });
    expect(Array.isArray(session.messages[1].content)).toBe(true);
    const toolResultMsg = session.messages[2].content as Array<{ type: string; tool_use_id?: string }>;
    expect(toolResultMsg[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
    expect(session.messages[3]).toEqual({ role: 'assistant', content: 'Done — added the layer.' });

    // The second chat() call saw the tool_result in its input.
    expect(seen[1][2].content).toEqual(toolResultMsg);

    const kinds = events.map((e) => e.type);
    expect(kinds).toEqual(['turn_start', 'text', 'tool_start', 'tool_end', 'text', 'done']);
    expect(session.running).toBe(false);
  });

  it('stops at the iteration budget and emits an error', async () => {
    // Model never stops asking for tools.
    const { provider } = mockLLM([toolResponse([runScriptCall('t', 'getProjectInfo')])]);
    const execute = vi.fn(async (t: ToolUse) => okExec(t));
    const events: AgentEvent[] = [];

    await runAgentTurn(new Session(), 'loop forever', (e) => events.push(e),
      baseDeps(provider, { executeTool: execute, maxIterations: 3 }));

    expect(execute).toHaveBeenCalledTimes(3);
    const last = events[events.length - 1];
    expect(last).toMatchObject({ type: 'error' });
    expect((last as { message: string }).message).toContain('3 iterations');
  });

  it('cancels at the next iteration boundary without corrupting history', async () => {
    const { provider } = mockLLM([toolResponse([runScriptCall('t', 'createLayer')])]);
    const session = new Session();
    // Simulate a cancel request arriving during the first tool execution.
    const execute = vi.fn(async (t: ToolUse) => { session.cancelRequested = true; return okExec(t); });
    const events: AgentEvent[] = [];

    await runAgentTurn(session, 'go', (e) => events.push(e), baseDeps(provider, { executeTool: execute }));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.type)).toContain('cancelled');
    // History ends on a user(tool_result) message — valid to resume from.
    expect(session.messages[session.messages.length - 1].role).toBe('user');
    expect(session.running).toBe(false);
  });

  it('injects a queued steering message into the next user turn', async () => {
    const { provider, seen } = mockLLM([
      toolResponse([runScriptCall('t1', 'createLayer')]),
      textResponse('ok, faster now'),
    ]);
    const session = new Session();
    const execute = vi.fn(async (t: ToolUse) => { session.pendingMessage = 'make it faster'; return okExec(t); });
    const events: AgentEvent[] = [];

    await runAgentTurn(session, 'animate it', (e) => events.push(e), baseDeps(provider, { executeTool: execute }));

    expect(events.map((e) => e.type)).toContain('steer');
    expect(session.pendingMessage).toBeNull();
    // The steering text was appended as a text block after the tool_result.
    const userTurn = seen[1][2].content as Array<{ type: string; text?: string }>;
    expect(userTurn.some((b) => b.type === 'text' && b.text === 'make it faster')).toBe(true);
  });

  it('refuses to start a second concurrent turn', async () => {
    const { provider } = mockLLM([textResponse('hi')]);
    const session = new Session();
    session.running = true;
    const events: AgentEvent[] = [];

    await runAgentTurn(session, 'x', (e) => events.push(e), baseDeps(provider));

    expect(events).toEqual([{ type: 'error', message: 'A turn is already running for this session.' }]);
  });

  it('emits a snapshot event before running and warns (not throws) on snapshot failure', async () => {
    const { provider } = mockLLM([textResponse('nothing to do')]);
    const events: AgentEvent[] = [];

    await runAgentTurn(new Session(), 'hi', (e) => events.push(e),
      baseDeps(provider, { takeSnapshot: true, snapshot: async () => ({ ok: false, reason: 'project never saved' }) }));

    const snap = events.find((e) => e.type === 'snapshot');
    expect(snap).toMatchObject({ type: 'snapshot', ok: false, reason: 'project never saved' });
    // The turn still completes despite the failed snapshot.
    expect(events.map((e) => e.type)).toContain('done');
  });
});

// ─── History compaction (turn-boundary) ──────────────────────────────────────────

/** A plain conversation of alternating string user / assistant turns (compaction-safe boundaries). */
function chatHistory(turns: number): Message[] {
  const msgs: Message[] = [];
  for (let i = 0; i < turns; i++) {
    msgs.push({ role: 'user', content: `q${i}` });
    msgs.push({ role: 'assistant', content: `a${i}` });
  }
  return msgs;
}

describe('runAgentTurn — context-window management', () => {
  it('stores the true prefill size (input + cache creation + cache read) after each chat', async () => {
    const provider = mockLLM([
      { content: 'done', stopReason: 'end_turn', toolUses: [],
        usage: { inputTokens: 100, outputTokens: 5, cacheCreationInputTokens: 50, cacheReadInputTokens: 1000 } },
    ]).provider;
    const session = new Session();

    await runAgentTurn(session, 'hi', () => {}, baseDeps(provider));

    expect(session.lastContextTokens).toBe(1150);
  });

  it('auto-compacts at the threshold before running the turn, preserving recent turns', async () => {
    const { provider, seen } = mockLLM([
      textResponse('## Goal\nMake a bouncy logo.'), // consumed by the summary call
      textResponse('on it'),                         // the actual turn
    ]);
    const session = new Session();
    session.messages = chatHistory(4);          // q0..q3 — 4 safe boundaries, so a cut exists
    session.lastContextTokens = 200_000 * 0.95; // over 90% → compaction fires

    const events: AgentEvent[] = [];
    await runAgentTurn(session, 'next', (e) => events.push(e), baseDeps(provider));

    // Compaction ran (and finished) before the turn proper started.
    const kinds = events.map((e) => e.type);
    expect(kinds.slice(0, 3)).toEqual(['compaction', 'compaction', 'turn_start']);
    expect(events[0]).toMatchObject({ type: 'compaction', status: 'start' });
    expect(events[1]).toMatchObject({ type: 'compaction', status: 'done' });

    // History collapsed to [summary, ...keptRecent, newUser, assistant]; summary is XML-wrapped.
    expect(session.messages[0].content).toContain('<conversation_summary>');
    expect(session.messages[0].content).toContain('Make a bouncy logo.');
    // The summary call only saw the older messages (the prefix before the kept turns).
    expect(seen[0].length).toBeLessThan(session.messages.length);
  });

  it('pauses with context_full at the hard ceiling without starting the turn', async () => {
    const m = mockLLM([textResponse('should never run')]);
    const session = new Session();
    session.lastContextTokens = 200_000 * 0.98; // over the 97% hard ceiling

    const events: AgentEvent[] = [];
    await runAgentTurn(session, 'next', (e) => events.push(e), baseDeps(m.provider));

    expect(events).toEqual([{ type: 'context_full', message: expect.stringContaining('start a new one') }]);
    expect(m.calls()).toBe(0);          // no model call, no spend
    expect(session.messages).toHaveLength(0); // user message was never pushed
    expect(session.running).toBe(false);
  });

  it('respects a lowered compactThreshold override (cheap to trigger in tests)', async () => {
    const { provider } = mockLLM([textResponse('summary'), textResponse('ok')]);
    const session = new Session();
    session.messages = chatHistory(4);
    session.lastContextTokens = 100; // tiny — only fires because of the override

    const events: AgentEvent[] = [];
    await runAgentTurn(session, 'next', (e) => events.push(e),
      baseDeps(provider, { compactThreshold: 0.0001, contextWindowOverride: 1000 }));

    expect(events.some((e) => e.type === 'compaction' && e.status === 'start')).toBe(true);
  });
});
