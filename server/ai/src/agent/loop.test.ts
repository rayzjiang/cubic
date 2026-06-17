import { describe, it, expect, vi } from 'vitest';
import { runAgentTurn, type AgentDeps } from './loop.js';
import { Session } from './session.js';
import { INTERRUPTED_MARKER } from './events.js';
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
    // The stop is recorded as an assistant-role interruption marker (keeps alternation valid for
    // resume); the tool_result user turn it follows is intact just before it.
    const msgs = session.messages;
    expect(msgs[msgs.length - 1]).toEqual({ role: 'assistant', content: INTERRUPTED_MARKER });
    expect(msgs[msgs.length - 2].role).toBe('user');
    expect(session.running).toBe(false);
  });

  it('discards the turn (as if never sent) when stopped before any output — abort on the first model call', async () => {
    const session = new Session();
    // Stop pressed mid-request before anything rendered: cancel set + the SDK rejects with an abort.
    const provider: LLMProvider = {
      chat: async () => { session.cancelRequested = true; throw new Error('Request was aborted.'); },
      // eslint-disable-next-line require-yield
      stream: async function* () { yield { type: 'done' as const }; },
      contextWindow: () => 200_000,
    };
    const events: AgentEvent[] = [];

    await runAgentTurn(session, 'go', (e) => events.push(e), baseDeps(provider));

    expect(events.map((e) => e.type)).not.toContain('error');
    const cancelled = events.find((e) => e.type === 'cancelled') as { type: 'cancelled'; discarded?: boolean };
    expect(cancelled.discarded).toBe(true);
    // The user prompt was rolled back → history untouched, nothing to persist (as if never sent).
    expect(session.messages).toHaveLength(0);
    expect(session.running).toBe(false);
  });

  it('keeps a partial turn + marker (not discarded) when the stop lands after output was shown', async () => {
    const session = new Session();
    let call = 0;
    // First call yields a tool (output rendered); the cancel aborts the SECOND model call.
    const provider: LLMProvider = {
      chat: async () => {
        call += 1;
        if (call === 1) return toolResponse([runScriptCall('t1', 'createLayer')]);
        session.cancelRequested = true;
        throw new Error('Request was aborted.');
      },
      // eslint-disable-next-line require-yield
      stream: async function* () { yield { type: 'done' as const }; },
      contextWindow: () => 200_000,
    };
    const events: AgentEvent[] = [];

    await runAgentTurn(session, 'go', (e) => events.push(e), baseDeps(provider));

    const cancelled = events.find((e) => e.type === 'cancelled') as { type: 'cancelled'; discarded?: boolean };
    expect(cancelled.discarded).toBeFalsy(); // output was shown → keep the turn
    expect(session.messages[session.messages.length - 1]).toEqual({ role: 'assistant', content: INTERRUPTED_MARKER });
    expect(session.running).toBe(false);
  });

  it('synthesizes interrupted tool_results for the rest of a batch when cancelled mid-batch', async () => {
    // One assistant turn requests two tools; the cancel arrives while the first is executing.
    const { provider } = mockLLM([toolResponse([runScriptCall('t1', 'createLayer'), runScriptCall('t2', 'createLayer')])]);
    const session = new Session();
    const execute = vi.fn(async (t: ToolUse) => { session.cancelRequested = true; return okExec(t); });
    const events: AgentEvent[] = [];

    await runAgentTurn(session, 'go', (e) => events.push(e), baseDeps(provider, { executeTool: execute }));

    // Only the first tool actually ran; the second was never started.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.type)).toContain('cancelled');
    // History ends on the interruption marker; the tool_result turn is just before it, and every
    // tool_use still has a matching tool_result (t1 real, t2 synthetic-interrupted) → valid history.
    const msgs = session.messages;
    expect(msgs[msgs.length - 1]).toEqual({ role: 'assistant', content: INTERRUPTED_MARKER });
    const toolMsg = msgs[msgs.length - 2].content as Array<{ type: string; tool_use_id?: string; is_error?: boolean; content?: string }>;
    expect(toolMsg).toHaveLength(2);
    expect(toolMsg[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
    expect(toolMsg[1]).toMatchObject({ type: 'tool_result', tool_use_id: 't2', is_error: true });
    expect(toolMsg[1].content).toContain('interrupted');
  });

  it('defers a queued steer to the next no-tool boundary (its own turn, after the task completes)', async () => {
    const { provider, seen } = mockLLM([
      toolResponse([runScriptCall('t1', 'createLayer')]),
      textResponse('done — created the layer'), // finishes + reports the ORIGINAL task first
      textResponse('ok, faster now'), // then addresses the steer
    ]);
    const session = new Session();
    const execute = vi.fn(async (t: ToolUse) => {
      session.pendingMessages.push({ id: 'q1', text: 'make it faster' });
      return okExec(t);
    });
    const events: AgentEvent[] = [];

    await runAgentTurn(session, 'animate it', (e) => events.push(e), baseDeps(provider, { executeTool: execute }));

    // The steer fired (with its id), and only after the original task reached a no-tool boundary.
    const steer = events.find((e) => e.type === 'steer') as { type: 'steer'; id: string; text: string } | undefined;
    expect(steer).toMatchObject({ type: 'steer', id: 'q1', text: 'make it faster' });
    expect(session.pendingMessages).toHaveLength(0);
    // The tool_result user turn (chat #2's input) did NOT carry the steer — the task wasn't hijacked.
    const toolResultTurn = seen[1][2].content as Array<{ type: string; text?: string }>;
    expect(toolResultTurn.some((b) => b.type === 'text' && b.text === 'make it faster')).toBe(false);
    // The steer landed as its OWN user turn after the assistant's task report (seen by chat #3).
    const steerTurn = seen[2][seen[2].length - 1].content as Array<{ type: string; text?: string }>;
    expect(steerTurn.some((b) => b.type === 'text' && b.text === 'make it faster')).toBe(true);
  });

  it('drains ALL queued steers in order at the no-tool boundary (regression: no silent drop)', async () => {
    // Two messages queued during tool execution. Both must drain in order at the next no-tool
    // boundary (never just the last → no silent drop), as one steer user turn.
    const { provider, seen } = mockLLM([
      toolResponse([runScriptCall('t1', 'createLayer')]),
      textResponse('done the layer'),
      textResponse('ok both'),
    ]);
    const session = new Session();
    const execute = vi.fn(async (t: ToolUse) => {
      session.pendingMessages.push({ id: 'q1', text: 'first steer' });
      session.pendingMessages.push({ id: 'q2', text: 'second steer' });
      return okExec(t);
    });
    const events: AgentEvent[] = [];

    await runAgentTurn(session, 'animate it', (e) => events.push(e), baseDeps(provider, { executeTool: execute }));

    // Both fired, in order, each as its own steer event with the right id.
    const steers = events.filter((e) => e.type === 'steer') as Array<{ type: 'steer'; id: string; text: string }>;
    expect(steers.map((s) => s.text)).toEqual(['first steer', 'second steer']);
    expect(steers.map((s) => s.id)).toEqual(['q1', 'q2']);
    expect(session.pendingMessages).toHaveLength(0);

    // Both landed as text blocks in one steer user turn (after the task report), in order.
    const steerTurn = seen[2][seen[2].length - 1].content as Array<{ type: string; text?: string }>;
    const texts = steerTurn.filter((b) => b.type === 'text').map((b) => b.text);
    expect(texts).toEqual(['first steer', 'second steer']);
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

// ─── onCommit persistence hook ────────────────────────────────────────────────────

describe('runAgentTurn — onCommit persistence hook', () => {
  it('fires once per real message, in push order, matching the committed history', async () => {
    const { provider } = mockLLM([
      toolResponse([runScriptCall('t1', 'createLayer')], 'Adding a layer.'),
      textResponse('Done.'),
    ]);
    const session = new Session();
    const committed: Message[] = [];

    await runAgentTurn(session, 'add a layer', () => {},
      baseDeps(provider, { onCommit: (m) => committed.push(m) }));

    // user → assistant(tool_use) → user(tool_result) → assistant(text)
    expect(committed).toHaveLength(4);
    expect(committed).toEqual(session.messages); // exactly the real messages, same order
  });

  it('does NOT fire for the compaction summary — only the turn\'s real messages', async () => {
    const { provider } = mockLLM([
      textResponse('## Goal\nbouncy logo'), // consumed by the summary call
      textResponse('on it'),                // the actual turn
    ]);
    const session = new Session();
    session.messages = chatHistory(4);          // gives compaction something to collapse
    session.lastContextTokens = 200_000 * 0.95; // over 90% → compaction fires at turn start
    const committed: Message[] = [];

    await runAgentTurn(session, 'next', () => {},
      baseDeps(provider, { onCommit: (m) => committed.push(m) }));

    // Only this turn's two real messages were handed to onCommit…
    expect(committed).toHaveLength(2);
    expect(committed[0]).toEqual({ role: 'user', content: 'next' });
    expect(committed[1]).toEqual({ role: 'assistant', content: 'on it' });
    // …the synthetic <conversation_summary> message (a session.messages rewrite, not a push) never was.
    expect(committed.some((m) => typeof m.content === 'string' && m.content.includes('<conversation_summary>'))).toBe(false);
  });
});
