import { runAgentTurn, compactSession, Session, type AgentEvent } from "cubic-ai";
import { bridge } from "./bridge/wsBridge.js";

/**
 * Folds the AI agent loop (cubic-ai) into this MCP server process. The panel talks to
 * the loop over the SAME WebSocket it already uses as the ExtendScript worker:
 *   panel → { type: 'userChat' | 'cancel' | 'queue' }  → here
 *   here  → { type: 'agentEvent', sessionId, event }     → panel
 *
 * The loop reaches AE through cubic-ai's mcpClient, which connects to this same bridge
 * as a second (loopback) client — its commands route back to the panel worker. Keeping
 * the brain a separate package means its Anthropic dep stays isolated; we only consume
 * its public surface here.
 */
const sessions = new Map<string, Session>();

export function registerAgentChat(): void {
  bridge.onChat(async (ws, msg) => {
    const id = msg.sessionId ?? "default";
    let session = sessions.get(id);
    if (!session) {
      session = new Session();
      sessions.set(id, session);
    }

    if (msg.type === "cancel") {
      session.cancelRequested = true;
      return;
    }
    if (msg.type === "queue") {
      if (msg.text) session.pendingMessage = msg.text;
      return;
    }

    // userChat
    if (!msg.text) return;

    const emit = (event: AgentEvent) => {
      try {
        ws.send(JSON.stringify({ type: "agentEvent", sessionId: id, event }));
      } catch {
        /* panel disconnected mid-turn — drop the event */
      }
    };

    // Slash commands — the same handlers the Phase 4 UI buttons will call. Exact-match only so
    // a normal message that merely mentions "/clear" isn't swallowed. Both mutate session.messages,
    // so they're rejected mid-run (the loop is reading that array) — finish or cancel the turn first.
    const text = msg.text.trim();
    if (text === "/clear" || text === "/compact") {
      if (session.running) {
        emit({ type: "compaction", status: "failed", reason: "busy — finish or cancel the current turn first" });
        return;
      }
      if (text === "/clear") {
        session.messages = [];
        session.lastContextTokens = 0;
        emit({ type: "compaction", status: "done", reason: "cleared" });
        return;
      }
      emit({ type: "compaction", status: "start" });
      const res = await compactSession(session);
      emit({ type: "compaction", status: res.ok ? "done" : "failed", reason: res.reason });
      return;
    }

    // If a turn is already running, a new message becomes a steer/queue — mirrors
    // Claude Code, where typing mid-run redirects the agent rather than starting a race.
    if (session.running) {
      session.pendingMessage = msg.text;
      return;
    }

    await runAgentTurn(session, msg.text, emit);
    // Mid-turn steers are consumed inside runAgentTurn. A message that arrived AFTER the
    // model's last tool boundary is still queued here → run it as a fresh follow-up turn.
    while (session.pendingMessage && !session.cancelRequested) {
      const next = session.pendingMessage;
      session.pendingMessage = null;
      await runAgentTurn(session, next, emit);
    }
  });
}
