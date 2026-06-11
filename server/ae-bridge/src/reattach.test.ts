import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WebSocket } from 'ws';
import type { AgentEvent } from 'cubic-ai';
import { attachSocket, dropSocket, emitFor, resetBuffer, clearBuffer, bufferFor } from './reattach.js';

// A fake socket that just records what was sent (the hub only ever calls ws.send).
function fakeSocket() {
  const sent: string[] = [];
  const ws = { send: vi.fn((s: string) => { sent.push(s); }) } as unknown as WebSocket;
  return { ws, sent };
}

const ev = (text: string): AgentEvent => ({ type: 'text', text });
const parse = (s: string) => JSON.parse(s) as { type: string; sessionId: string; event: AgentEvent };

// Each test uses a unique session id so the module-level maps don't bleed between tests.
let n = 0;
let id: string;
beforeEach(() => { id = `s${n++}`; });

describe('emitFor — fan-out', () => {
  it('sends each event to every attached socket, wrapped as an agentEvent envelope', () => {
    const a = fakeSocket();
    const b = fakeSocket();
    attachSocket(id, a.ws);
    attachSocket(id, b.ws);

    emitFor(id)(ev('hello'));

    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
    expect(parse(a.sent[0])).toEqual({ type: 'agentEvent', sessionId: id, event: ev('hello') });
    expect(parse(b.sent[0])).toEqual({ type: 'agentEvent', sessionId: id, event: ev('hello') });
  });

  it('does not throw when a socket\'s send fails — other sockets still receive', () => {
    const good = fakeSocket();
    const bad = { send: vi.fn(() => { throw new Error('closed'); }) } as unknown as WebSocket;
    attachSocket(id, bad);
    attachSocket(id, good.ws);

    expect(() => emitFor(id)(ev('x'))).not.toThrow();
    expect(good.sent).toHaveLength(1);
  });
});

describe('buffer lifecycle', () => {
  it('buffers every emitted event for replay (what a mid-turn attach gets)', () => {
    resetBuffer(id);
    const e = emitFor(id);
    e(ev('one'));
    e(ev('two'));
    expect(bufferFor(id)).toEqual([ev('one'), ev('two')]);
  });

  it('resetBuffer drops stale events from before the turn', () => {
    emitFor(id)(ev('stale'));
    resetBuffer(id);
    expect(bufferFor(id)).toEqual([]);
    emitFor(id)(ev('fresh'));
    expect(bufferFor(id)).toEqual([ev('fresh')]);
  });

  it('clearBuffer empties the buffer (turn committed → events now live in history)', () => {
    const e = emitFor(id);
    e(ev('a'));
    e(ev('b'));
    clearBuffer(id);
    expect(bufferFor(id)).toEqual([]); // a later attach replays nothing → no dup with history
  });

  it('bufferFor is empty for an unknown session', () => {
    expect(bufferFor('never-seen')).toEqual([]);
  });
});

describe('dropSocket', () => {
  it('removes a closed socket from the fan-out so it stops receiving', () => {
    const a = fakeSocket();
    const b = fakeSocket();
    attachSocket(id, a.ws);
    attachSocket(id, b.ws);

    dropSocket(a.ws); // a reloaded/closed renderer
    emitFor(id)(ev('after-close'));

    expect(a.sent).toHaveLength(0); // dropped — no longer fanned to
    expect(b.sent).toHaveLength(1); // survivor still receives
  });

  it('attaching the same socket twice is idempotent (one delivery)', () => {
    const a = fakeSocket();
    attachSocket(id, a.ws);
    attachSocket(id, a.ws);
    emitFor(id)(ev('once'));
    expect(a.sent).toHaveLength(1);
  });
});
