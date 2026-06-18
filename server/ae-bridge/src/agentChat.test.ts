import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Orchestration tests for agentChat: attach reply + manual delete (incl. refuse-mid-turn). The
 * pieces it composes are unit-tested elsewhere (persist.ts, reattach.ts); here we mock the bridge,
 * the persistence store, and the agent loop so we can drive the chat handler directly with fake
 * messages and assert the wiring.
 */

// vi.mock factories are hoisted above imports, so shared spies must live in vi.hoisted().
const h = vi.hoisted(() => ({
  handler: { fn: null as null | ((ws: unknown, msg: unknown) => Promise<void>) },
  closeFn: { fn: null as null | ((ws: unknown) => void) },
  appendTurn: vi.fn(),
  loadSession: vi.fn(() => null),
  getConversation: vi.fn(() => null),
  deleteConversation: vi.fn(),
  deleteSessionBackups: vi.fn(),
  rekey: vi.fn(),
  runAgentTurn: vi.fn(async (..._args: any[]) => {}),
}));

vi.mock('./bridge/wsBridge.js', () => ({
  bridge: {
    onChat: (fn: (ws: unknown, msg: unknown) => Promise<void>) => { h.handler.fn = fn; },
    onChatClose: (fn: (ws: unknown) => void) => { h.closeFn.fn = fn; },
    on: () => {}, // 'connect'/'disconnect' list-refresh hooks — not exercised here
    isConnected: () => true,
  },
}));

vi.mock('./persist.js', () => ({
  appendTurn: h.appendTurn,
  loadSession: h.loadSession,
  getConversation: h.getConversation,
  deleteConversation: h.deleteConversation,
  deleteSessionBackups: h.deleteSessionBackups,
  rekey: h.rekey,
  encodeProjectPath: (p: string) => p || '_untitled',
  listConversations: () => [],
  lastActiveProjectPath: () => null,
}));

vi.mock('cubic-ai', async (importActual) => {
  const actual = await importActual<typeof import('cubic-ai')>();
  return {
    ...actual, // keep the real Session class, nextQueueId, etc.
    runAgentTurn: h.runAgentTurn,
    sessionCache: { getProjectInfo: async () => ({ path: '/p.aep' }) },
  };
});

import { registerAgentChat } from './agentChat.js';

function fakeWs() {
  const sent: Array<Record<string, unknown>> = [];
  return { ws: { send: (s: string) => sent.push(JSON.parse(s)) }, sent };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.loadSession.mockReturnValue(null);
  h.getConversation.mockReturnValue(null);
  h.runAgentTurn.mockImplementation(async () => {});
  registerAgentChat(); // re-registers the handler onto our mocked bridge
});

describe('attach', () => {
  it('replies with run state + buffered live-turn events', async () => {
    const { ws, sent } = fakeWs();
    await h.handler.fn!(ws, { type: 'attach', sessionId: 's1' });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'attached', sessionId: 's1', running: false });
    expect(Array.isArray(sent[0].events)).toBe(true); // no live turn → empty replay
  });
});

describe('delete', () => {
  it('wipes the store and drops the session when not running', async () => {
    const { ws } = fakeWs();
    await h.handler.fn!(ws, { type: 'delete', sessionId: 's1' });

    expect(h.deleteConversation).toHaveBeenCalledWith('s1');
  });

  it('refuses to delete a conversation while its turn is in flight', async () => {
    // Hold a turn open: the mocked loop marks the session running, then parks until released.
    let release!: () => void;
    h.runAgentTurn.mockImplementation(async (session: { running: boolean }) => {
      session.running = true;
      await new Promise<void>((r) => { release = r; });
      session.running = false;
    });

    const a = fakeWs();
    const turn = h.handler.fn!(a.ws, { type: 'userChat', sessionId: 's1', text: 'go' }); // not awaited — parks running

    const b = fakeWs();
    await h.handler.fn!(b.ws, { type: 'delete', sessionId: 's1' }); // arrives mid-turn

    expect(h.deleteConversation).not.toHaveBeenCalled();
    // The refusal is emitted through the fan-out, so it arrives wrapped as an agentEvent envelope.
    expect(b.sent.some((m) => m.type === 'agentEvent' && (m.event as { type: string }).type === 'error')).toBe(true);

    release();
    await turn;
  });
});
