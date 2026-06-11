import type { WebSocket } from "ws";
import type { AgentEvent } from "cubic-ai";

/**
 * Re-attach hub (§0): the transport-side state that lets a reloaded renderer rejoin a still-running
 * turn. Kept out of the brain (cubic-ai) — this is purely about websocket fan-out + replay.
 *
 *  - `sockets`: the set of live sockets attached to each session. `emitFor` fans an agentEvent out
 *    to all of them, so the original sender AND a freshly-reconnected renderer both receive it.
 *  - `liveBuffers`: the current turn's agentEvents, per session. A renderer attaching mid-turn
 *    replays this to catch up. Reset at each turn start (`resetBuffer`) and cleared once the turn is
 *    committed to the JSONL store (`clearBuffer`) — after that the events live in committed history,
 *    so replaying them would duplicate.
 */
const sockets = new Map<string, Set<WebSocket>>();
const liveBuffers = new Map<string, AgentEvent[]>();

/** Add a socket to a session's fan-out set (idempotent — a Set tolerates the reload overlap window). */
export function attachSocket(id: string, ws: WebSocket): void {
  let set = sockets.get(id);
  if (!set) { set = new Set(); sockets.set(id, set); }
  set.add(ws);
}

/** Remove a closed socket from every session's fan-out set (wired to the bridge's ws-close hook). */
export function dropSocket(ws: WebSocket): void {
  for (const set of sockets.values()) set.delete(ws);
}

/** An emit bound to a session: records the event in the live-turn buffer AND fans it out to every
 *  attached socket. Replaces the old single-captured-socket emit in agentChat. */
export function emitFor(id: string): (event: AgentEvent) => void {
  return (event: AgentEvent) => {
    let buf = liveBuffers.get(id);
    if (!buf) { buf = []; liveBuffers.set(id, buf); }
    buf.push(event);
    const set = sockets.get(id);
    if (set) {
      for (const ws of set) {
        try { ws.send(JSON.stringify({ type: "agentEvent", sessionId: id, event })); } catch { /* socket gone — drop */ }
      }
    }
  };
}

/** Start a fresh live-turn buffer (drops any stale between-turn events). */
export function resetBuffer(id: string): void {
  liveBuffers.set(id, []);
}

/** Clear the live-turn buffer once its turn is committed to history (no dup on a later attach). */
export function clearBuffer(id: string): void {
  liveBuffers.delete(id);
}

/** The live-turn events buffered so far for a session (what an attaching renderer replays). */
export function bufferFor(id: string): AgentEvent[] {
  return liveBuffers.get(id) ?? [];
}
