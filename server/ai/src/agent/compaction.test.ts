import { describe, it, expect, vi } from 'vitest';
import {
  contextTokensOf,
  findCompactionCut,
  buildSummaryMessage,
  compactSession,
} from './compaction.js';
import { Session } from './session.js';
import type { LLMProvider, Message, ChatResponse, ContentBlock } from '../llm/types.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────────

function textResponse(text: string): ChatResponse {
  return { content: text, stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 }, toolUses: [] };
}

/** Minimal provider with a custom chat impl. */
function provider(chat: LLMProvider['chat']): LLMProvider {
  return {
    chat,
    // eslint-disable-next-line require-yield
    stream: async function* () { yield { type: 'done' as const }; },
    contextWindow: () => 200_000,
  };
}

const userStr = (t: string): Message => ({ role: 'user', content: t });
const asstStr = (t: string): Message => ({ role: 'assistant', content: t });
const asstTool = (id: string): Message => ({ role: 'assistant', content: [{ type: 'tool_use', id, name: 'runScript', input: {} }] });
const userResult = (id: string): Message => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] });

function plainHistory(turns: number): Message[] {
  const m: Message[] = [];
  for (let i = 0; i < turns; i++) { m.push(userStr(`q${i}`)); m.push(asstStr(`a${i}`)); }
  return m;
}

/** Asserts every tool_use in `msgs` has its matching tool_result within `msgs` (no orphan). */
function pairsIntact(msgs: Message[]): boolean {
  const uses = new Set<string>();
  const results = new Set<string>();
  for (const m of msgs) {
    if (Array.isArray(m.content)) {
      for (const b of m.content as ContentBlock[]) {
        if (b.type === 'tool_use') uses.add(b.id);
        if (b.type === 'tool_result') results.add(b.tool_use_id);
      }
    }
  }
  for (const id of uses) if (!results.has(id)) return false;
  return true;
}

// ─── contextTokensOf ─────────────────────────────────────────────────────────────

describe('contextTokensOf', () => {
  it('sums input + cache-creation + cache-read', () => {
    expect(contextTokensOf({ inputTokens: 100, outputTokens: 9, cacheCreationInputTokens: 50, cacheReadInputTokens: 1000 })).toBe(1150);
  });
  it('treats missing cache fields as 0', () => {
    expect(contextTokensOf({ inputTokens: 42, outputTokens: 9 })).toBe(42);
  });
});

// ─── findCompactionCut ───────────────────────────────────────────────────────────

describe('findCompactionCut', () => {
  it('cuts at the Nth-from-last string-user boundary and keeps a string-user first', () => {
    const cut = findCompactionCut(plainHistory(4), 2); // q0 a0 q1 a1 q2 a2 q3 a3
    expect(cut).not.toBeNull();
    expect(cut!.cutIndex).toBe(4);                 // keep q2.. ; summarize q0 a0 q1 a1
    expect(cut!.toKeep[0]).toEqual(userStr('q2'));
    expect(typeof cut!.toKeep[0].content).toBe('string');
    expect(cut!.toSummarize).toHaveLength(4);
  });

  it('returns null when there are too few user prompts to keep', () => {
    expect(findCompactionCut(plainHistory(2), 3)).toBeNull();
  });

  it('returns null when the only boundary is at index 0 (nothing older to summarize)', () => {
    // One real prompt, then a tool round-trip — no earlier prompt to compact.
    const msgs = [userStr('q0'), asstTool('t1'), userResult('t1'), asstStr('a0')];
    expect(findCompactionCut(msgs, 1)).toBeNull();
  });

  it('never splits a tool_use/tool_result pair across the cut', () => {
    const msgs = [
      userStr('q0'), asstTool('t1'), userResult('t1'), asstStr('a0'),   // 0-3
      userStr('q1'), asstTool('t2'), userResult('t2'), asstStr('a1'),   // 4-7
      userStr('q2'), asstStr('a2'),                                     // 8-9
    ];
    const cut = findCompactionCut(msgs, 1)!;
    expect(cut.cutIndex).toBe(8);
    expect(cut.toKeep[0]).toEqual(userStr('q2'));
    // Both pairs live entirely in the summarized prefix — none orphaned.
    expect(pairsIntact(cut.toSummarize)).toBe(true);
    expect(Array.isArray(cut.toKeep[0].content)).toBe(false); // kept slice never starts on a tool_result
  });
});

// ─── compactSession ──────────────────────────────────────────────────────────────

describe('compactSession', () => {
  it('replaces the older prefix with one XML-wrapped summary and keeps recent turns', async () => {
    const seen: Message[][] = [];
    const llm = provider(async (messages) => { seen.push(messages); return textResponse('## Goal\nbouncy logo'); });
    const session = new Session();
    session.messages = plainHistory(4);
    session.lastContextTokens = 190_000;

    const res = await compactSession(session, { llm, keepRecentTurns: 2 });

    expect(res.ok).toBe(true);
    expect(session.messages[0]).toEqual(buildSummaryMessage('## Goal\nbouncy logo'));
    expect(session.messages[0].content).toContain('<conversation_summary>');
    expect(session.messages).toHaveLength(1 + 4); // summary + kept (q2 a2 q3 a3)
    expect(session.lastContextTokens).toBe(0);    // reset; next real chat re-measures
    // The summary call only saw the older messages, with the summarization system prompt.
    expect(seen[0]).toHaveLength(4);
  });

  it('retries the summary call once, then succeeds', async () => {
    let calls = 0;
    const llm = provider(async () => { if (calls++ === 0) throw new Error('rate limit'); return textResponse('summary'); });
    const session = new Session();
    session.messages = plainHistory(4);

    const res = await compactSession(session, { llm, keepRecentTurns: 2 });

    expect(calls).toBe(2);
    expect(res.ok).toBe(true);
    expect(session.messages[0].content).toContain('<conversation_summary>');
  });

  it('leaves history untouched when the summary call fails twice', async () => {
    const llm = provider(async () => { throw new Error('down'); });
    const session = new Session();
    session.messages = plainHistory(4);
    const before = structuredClone(session.messages);

    const res = await compactSession(session, { llm, keepRecentTurns: 2 });

    expect(res.ok).toBe(false);
    expect(res.reason).toContain('down');
    expect(session.messages).toEqual(before); // no partial mutation
  });

  it('is a no-op success when there is nothing to compact', async () => {
    const chat = vi.fn();
    const llm = provider(chat);
    const session = new Session();
    session.messages = plainHistory(1); // too short to cut

    const res = await compactSession(session, { llm });

    expect(res.ok).toBe(true);
    expect(chat).not.toHaveBeenCalled();
  });
});
