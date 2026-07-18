import { runAgentTurn, compactSession, Session, nextQueueId, sessionCache, getProjectInfo, type AgentEvent, type Message } from "cubic-ai";
import type { WebSocket } from "ws";
import { bridge } from "./bridge/wsBridge.js";
import { appendTurn, appendCompactionMarker, truncateToBeforeTurn, loadSession, loadDisplayMessages, getConversation, deleteConversation, deleteSessionBackups, rekey, encodeProjectPath, listConversations, lastActiveProjectPath, renameConversation } from "./persist.js";
import { messagesToDisplayItems } from "./displayItems.js";
import { attachSocket, dropSocket, emitFor, resetBuffer, clearBuffer, bufferFor } from "./reattach.js";

/**
 * Folds the AI agent loop (cubic-ai) into this backend process (the MCP server under
 * index.ts, or the standalone serve.ts backend). The panel talks to
 * the loop over the SAME WebSocket it already uses as the ExtendScript worker:
 *   panel → { type: 'userChat' | 'cancel' | 'queue' | 'editQueue' | 'removeQueue' | 'attach' | 'delete' }  → here
 *   here  → { type: 'agentEvent', sessionId, event } | { type: 'attached', sessionId, running, events }  → panel
 *
 * The loop reaches AE through cubic-ai's bridgeClient, which connects to this same bridge
 * as a second (loopback) client — its commands route back to the panel worker. Keeping
 * the brain a separate package means its Anthropic dep stays isolated; we only consume
 * its public surface here.
 *
 * Conversations are persisted to disk via `persist.ts` (append-only JSONL per turn). The live
 * `sessions` Map is lazily hydrated: a Session is read back from disk only when a message arrives
 * for an id that isn't already in memory (resume), and committed turns are appended after each
 * `runAgentTurn` (re-keying the file if the project was saved/renamed mid-conversation).
 *
 * Re-attach (§0): emit fans out to a SET of sockets per session (not one captured socket), and the
 * current turn's events are buffered so a renderer that reloaded mid-turn can replay what it missed
 * via `{type:'attach'}` → `{type:'attached', running, events}`. That machinery lives in `reattach.ts`.
 */
const sessions = new Map<string, Session>();
/** Every connected chat socket (renderer/panel). Lets us push a fresh conversation list when the AE
 *  worker (re)connects: the project path isn't resolvable until then, so a cold-start list would
 *  otherwise stay empty until something else triggered a refresh. */
const chatSockets = new Set<WebSocket>();

/**
 * Current AE project path for keying the conversation on disk — returns `string | null`:
 *   - `null`  → couldn't determine (worker not connected, or `getProjectInfo` threw/returned an error).
 *               Callers must NOT treat this as a definite project; falling back to the last-known path
 *               keeps the sidebar from being wiped by a momentary no-answer (the regression that filed a
 *               new chat under "").
 *   - `""`    → determined: a genuinely unsaved/untitled project (the real `_untitled` bucket).
 *   - `"/…"`  → determined: a saved project path.
 * Reads UNCACHED (raw `getProjectInfo`, not `sessionCache`): the cache only invalidates after mutation
 * turns, so it would mask an in-AE project switch — and the sidebar list / focus refresh must see the
 * truly-open project. A `{status:"error"}` body (a handler that threw — the bridge passes it through as a
 * successful result, so `.path` is undefined) is treated as "couldn't determine" (null), NOT as a
 * definite unsaved project — otherwise a transient handler error would wipe the sidebar to `_untitled`.
 * Fail-fast when the worker isn't connected (no 3s wait) so startup never blocks; the real list is
 * pushed on the bridge 'connect' event once the path becomes resolvable.
 */
async function resolveProjectPath(): Promise<string | null> {
  if (!bridge.isConnected()) return null;
  try {
    const info = (await getProjectInfo()) as { path?: unknown; status?: unknown };
    if (!info || info.status === "error" || typeof info.path !== "string") return null;
    return info.path; // "" = genuinely unsaved (real _untitled bucket); "/…" = saved path
  } catch {
    return null;
  }
}

// Last project path the sidebar resolved to. When a definite resolve differs from this (an in-AE project
// switch), the cached per-turn live state (`getProjectInfo`/comps) belongs to the OLD project, so we
// invalidate it — otherwise the first chat in the newly-opened project would inject stale `<live_ae_state>`.
let lastResolvedProjectPath: string | null = null;

/**
 * Send the current project's conversation list to one socket (the `list` reply + the connect push).
 * NEVER waits on AE — the list is purely local data (index.json), so it loads instantly like Claude
 * Code. When the worker is connected we use the real project path; before that, we use the last-active
 * project as the best guess so the home appears fully populated immediately. The bridge 'connect' push
 * then re-sends the authoritative list, which only changes anything if a different project was opened.
 */
async function sendConversations(ws: WebSocket): Promise<void> {
  // No-answer guard: a `null` resolve (AE not connected / didn't answer) keeps the LAST-KNOWN project's
  // list instead of wiping to "". A definite "" (genuinely unsaved project) still shows its `_untitled`
  // bucket correctly. Only a definite resolve ever changes which project the sidebar reflects.
  const resolved = await resolveProjectPath();
  const projectPath = resolved ?? (lastActiveProjectPath() ?? "");
  // A definite resolve to a NEW project means AE switched projects under us → the cached live state is
  // stale for the now-open project; drop it so the next turn rebuilds context fresh.
  if (resolved !== null && resolved !== lastResolvedProjectPath) {
    lastResolvedProjectPath = resolved;
    sessionCache.invalidate();
  }
  try {
    ws.send(JSON.stringify({ type: "conversations", projectPath, conversations: listConversations(projectPath) }));
  } catch { /* socket gone */ }
}

/**
 * Push a fresh conversation list to EVERY connected chat socket (not just the one that triggered a
 * change). Called on any index mutation — placeholder, commit, delete, rename, restore — so the backend
 * is the single source of truth for the sidebar: the list stays correct even for a chat the user switched
 * away from (whose `done`/`cancelled` agentEvents the renderer filters out as a background turn).
 */
function broadcastConversations(): void {
  for (const ws of chatSockets) void sendConversations(ws);
}

/** Push the live AE (CEP worker) connectivity to one socket — drives the renderer's always-on status
 *  dot. Sent on the `list` handshake (so a fresh renderer starts correct) and re-broadcast to every
 *  chat socket on each bridge connect/disconnect (below). Separate from the renderer↔backend link. */
function sendAeStatus(ws: WebSocket): void {
  try {
    // `stale` = a connected panel running an outdated build (see wsBridge.isWorkerStale) → the renderer
    // shows a "Restart After Effects" nudge (§F-4). Rides the same message as `connected`.
    ws.send(JSON.stringify({ type: "aeStatus", connected: bridge.isConnected(), stale: bridge.isWorkerStale() }));
  } catch { /* socket gone */ }
}

/** Probe whether AE's "Allow Scripts to Write Files and Access Network" setting is on and push the
 *  result to one socket → drives the renderer's file-access gate (§D-1a). No-op while the worker is
 *  disconnected (the gate is off when AE is down anyway, and the probe needs the panel to run it).
 *  `checkFileAccess` writes a throwaway file to ~/.cubic (not the AE project), so re-calling it to
 *  re-check is safe. Sent on the `list` handshake + every bridge (re)connect, and on renderer demand. */
async function sendFileAccess(ws: WebSocket): Promise<void> {
  if (!bridge.isConnected()) return;
  try {
    const raw = await bridge.sendCommand("checkFileAccess");
    const result = JSON.parse(raw) as { status?: string; canWriteFiles?: boolean };
    if (result.status === "error" || typeof result.canWriteFiles !== "boolean") return; // couldn't determine → leave the gate's last value
    ws.send(JSON.stringify({ type: "fileAccess", canWriteFiles: result.canWriteFiles }));
  } catch { /* socket gone / worker dropped mid-probe */ }
}

/**
 * Run one agent turn and persist it. `onCommit` accumulates exactly the real messages the loop
 * commits this turn (never the compaction summary); after the turn we resolve the project path,
 * re-key the file if it changed (unsaved → saved), then append the turn's messages. Per-turn
 * append is the crash-safe unit — a crash loses at most this in-flight turn.
 */
/** The in-flight turn's prompt: the most recent string-content user message (tool_result user turns
 *  carry ContentBlock[] and are skipped). Surfaced in the `attached` reply so a renderer that reloaded
 *  mid-turn can show the prompt bubble even though the turn isn't committed to history yet. */
function lastUserString(session: Session): string | undefined {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i];
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return undefined;
}

async function runTurnAndPersist(session: Session, text: string, emit: (e: AgentEvent) => void, authToken?: string): Promise<void> {
  resetBuffer(session.id); // fresh buffer for this turn (drops any stale between-turn events)
  const committed: Message[] = [];
  // A turn stopped before any output is DISCARDED (as if never sent): the loop pops the user prompt
  // from session.messages, and we persist nothing — so the conversation isn't polluted.
  let discarded = false;
  // The pre-turn snapshot's turnId, captured from the snapshot event → tags the persisted prompt line
  // so the UI can "restore to before this request" durably.
  let turnId: string | undefined;
  // A successful compaction this turn → persist a marker (summary + how many turns stayed verbatim) so the
  // model resumes from the summarized form on reopen and the divider survives. Captured here, written below
  // just before the turn's own messages so it lands at the compaction boundary in the transcript.
  let compaction: { summary: string; keptTurns: number } | undefined;
  const capture = (e: AgentEvent): void => {
    if (e.type === "snapshot" && e.turnId) turnId = e.turnId;
    if (e.type === "cancelled" && e.discarded) discarded = true;
    // A gate error that produced nothing is discarded too (loop popped the prompt) → persist nothing,
    // so a retry doesn't stack a duplicate of the failed prompt in history.
    if (e.type === "error" && e.discarded) discarded = true;
    if (e.type === "compaction" && e.status === "done" && e.summary && e.keptTurns)
      compaction = { summary: e.summary, keptTurns: e.keptTurns };
    emit(e);
  };
  // Dev-only compaction test knobs (unset in normal use → no effect): shrink the context window,
  // lower the compact threshold, and/or keep fewer recent turns verbatim so a few short messages cross
  // 90% (pill) and compaction has something to summarize — without filling a real 200k window. See §C.
  const ctxOverride = process.env.CUBIC_CONTEXT_WINDOW ? Number(process.env.CUBIC_CONTEXT_WINDOW) : undefined;
  const threshOverride = process.env.CUBIC_COMPACT_THRESHOLD ? Number(process.env.CUBIC_COMPACT_THRESHOLD) : undefined;
  const keepOverride = process.env.CUBIC_KEEP_RECENT_TURNS ? Number(process.env.CUBIC_KEEP_RECENT_TURNS) : undefined;
  await runAgentTurn(session, text, capture, {
    onCommit: (m) => committed.push(m),
    authToken,
    contextWindowOverride: ctxOverride,
    compactThreshold: threshOverride,
    keepRecentTurns: keepOverride,
  });
  if (discarded) { clearBuffer(session.id); return; }
  if (committed.length === 0) return; // turn refused/paused before committing anything (e.g. context_full)
  // Post-turn the cache is warm, so this is reliable; if it somehow can't resolve (null), fall back to the
  // chat's stored path, then the last-active project — never key an append under a bogus value.
  const stored = getConversation(session.id);
  const projectPath = (await resolveProjectPath()) ?? stored?.projectPath ?? lastActiveProjectPath() ?? "";
  // Rekey on a path change. With the pre-turn wrong-project guard above, the only path change that can reach
  // here is unsaved → saved (stored.projectPath was ""): a chat started in an untitled project that the user
  // then saved. A real saved→saved switch is rejected before the turn runs, so this no longer silently
  // migrates a chat to a different project.
  if (stored && encodeProjectPath(stored.projectPath) !== encodeProjectPath(projectPath)) {
    rekey(session.id, stored.projectPath, projectPath);
  }
  // Marker first (after any rekey, before the turn): all prior turns are already on disk, so it lands
  // between the summarized prefix and this turn's new messages — exactly the compaction boundary.
  if (compaction) appendCompactionMarker(session.id, projectPath, compaction.summary, compaction.keptTurns);
  appendTurn(session.id, projectPath, committed, turnId);
  clearBuffer(session.id); // committed → now in history; clear so a later attach sees no dup
  broadcastConversations(); // new row / updated title + lastActivity → push to every client, even backgrounded
}

export function registerAgentChat(): void {
  bridge.onChatClose((ws) => {
    dropSocket(ws);
    chatSockets.delete(ws);
  });
  // When the AE worker (re)connects the real project path becomes resolvable — push a fresh list to
  // every chat client so a cold-start list (worker not yet connected) fills in without a manual refresh.
  // Also flip every renderer's status dot to connected.
  bridge.on("connect", () => {
    for (const ws of chatSockets) { void sendConversations(ws); sendAeStatus(ws); void sendFileAccess(ws); }
  });
  // AE worker dropped → flip every renderer's status dot to disconnected (the dot is the always-on
  // companion to the on-failure "After Effects isn't connected" turn error).
  bridge.on("disconnect", () => {
    for (const ws of chatSockets) sendAeStatus(ws);
  });
  bridge.onChat(async (ws, msg) => {
    chatSockets.add(ws);
    // List the current project's conversations (sidebar/home). No sessionId — handled before the
    // per-session setup below so it never spins up a bogus "default" session or joins a fan-out set.
    if (msg.type === "list") {
      // `list` is the renderer's connection handshake (fired on socket open) → seed its status dot with
      // the current AE state so a renderer that connects while AE is already up/down starts correct.
      sendAeStatus(ws);
      void sendFileAccess(ws); // seed the file-access gate too (§D-1a)
      await sendConversations(ws);
      return;
    }

    // File-access re-check on demand (renderer's "I've enabled it — Re-check" button + window-focus).
    // No session — a pure control message, handled before the per-session hydration below.
    if (msg.type === "checkFileAccess") {
      void sendFileAccess(ws);
      return;
    }

    // Rename a conversation (sidebar kebab → inline edit). Pure index.json metadata, so — unlike delete —
    // it's allowed mid-turn and needs no Session: handle it before the per-session hydration below. The
    // renderer updates the row optimistically; no ack is sent (the next `list` confirms the persisted title).
    if (msg.type === "rename") {
      if (msg.sessionId && msg.title) { renameConversation(msg.sessionId, msg.title); broadcastConversations(); }
      return;
    }

    const id = msg.sessionId ?? "default";
    let session = sessions.get(id);
    if (!session) {
      // Resume: rehydrate the full history from disk if this conversation was persisted before;
      // otherwise start a fresh Session that knows its own id.
      const meta = getConversation(id);
      session = (meta && loadSession(id, meta.projectPath)) || new Session(id);
      sessions.set(id, session);
    }

    // Any message from this socket means it wants this session's events → join the fan-out set.
    attachSocket(id, ws);
    const emit = emitFor(id);

    // Re-attach: a reloaded renderer rejoins a still-running turn. Reply with the run state + the
    // live-turn events it missed (committed history loads separately via the resume path above).
    if (msg.type === "attach") {
      // Include the in-flight turn's prompt (only while running): it isn't committed to history yet
      // and isn't an agentEvent, so a reloaded renderer needs it to render the prompt bubble.
      const userText = session.running ? lastUserString(session) : undefined;
      ws.send(JSON.stringify({ type: "attached", sessionId: id, running: session.running, events: bufferFor(id), userText }));
      return;
    }

    // Load one conversation's committed history as renderable display items. Read the FULL transcript
    // from disk (loadDisplayMessages — NOT loadSession, which returns the compacted model context) so the
    // chat pane always shows the whole conversation, including the persisted compaction dividers. Empty
    // for a brand-new chat with no turns yet.
    if (msg.type === "loadHistory") {
      const meta = getConversation(id);
      const disk = meta ? loadDisplayMessages(id, meta.projectPath) : null;
      const items = messagesToDisplayItems(disk ?? []);
      ws.send(JSON.stringify({ type: "history", sessionId: id, items, running: session.running }));
      return;
    }

    // Manual delete (fired from the sidebar list → may target any conversation, not just the open
    // one). Refuse while a turn is in flight; otherwise wipe disk + drop the live session.
    if (msg.type === "delete") {
      if (session.running) {
        emit({ type: "error", message: "Can't delete a conversation while it's running — stop it first." });
        return;
      }
      const conv = getConversation(id); // capture the project path before we drop the index entry
      deleteConversation(id);
      if (conv) deleteSessionBackups(conv.projectPath, id); // drop this chat's pre-turn backups too
      sessions.delete(id);
      broadcastConversations(); // authoritative removal across every client (not just the optimistic one)
      return;
    }

    if (msg.type === "cancel") {
      session.cancelRequested = true;
      session.abortController?.abort(); // interrupt the in-flight model request now (don't wait for the next boundary)
      return;
    }

    // "Restore to before this request": revert the .aep to that turn's pre-turn backup AND rewind the
    // conversation to before it (one-way — newer backups pruned, history truncated). Refused mid-turn.
    if (msg.type === "restore") {
      if (!msg.turnId) return; // malformed — a restore must name the turn to revert to
      if (session.running) {
        ws.send(JSON.stringify({ type: "restored", sessionId: id, ok: false, message: "Can't restore while Cubic is working — stop it first." }));
        return;
      }
      const turnId = msg.turnId;
      try {
        const raw = await bridge.sendCommand("restoreProject", { turnId, sessionId: id, prune: true }, 30000);
        const result = JSON.parse(raw) as { status?: string; message?: string };
        if (result.status === "error") {
          ws.send(JSON.stringify({ type: "restored", sessionId: id, ok: false, message: result.message ?? "Couldn't restore the project." }));
          return;
        }
        // .aep reverted → rewind the saved transcript to before this turn and drop the live session so
        // the next message lazily rehydrates from the truncated history (matches the resume path above).
        const conv = getConversation(id);
        if (conv) truncateToBeforeTurn(id, conv.projectPath, turnId);
        sessions.delete(id);
        broadcastConversations(); // title may have been re-derived after truncation → push to all clients
        ws.send(JSON.stringify({ type: "restored", sessionId: id, ok: true }));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        ws.send(JSON.stringify({ type: "restored", sessionId: id, ok: false, message }));
      }
      return;
    }
    // Queue ops. The loop drains the queue synchronously at iteration boundaries, so
    // editing/removing between boundaries can't race — allow them regardless of run state.
    if (msg.type === "queue") {
      if (msg.text) session.pendingMessages.push({ id: msg.id ?? nextQueueId(), text: msg.text });
      return;
    }
    if (msg.type === "editQueue") {
      const item = session.pendingMessages.find((m) => m.id === msg.id);
      if (item && msg.text) item.text = msg.text; // no-op if already drained
      return;
    }
    if (msg.type === "removeQueue") {
      session.pendingMessages = session.pendingMessages.filter((m) => m.id !== msg.id);
      return;
    }

    // userChat
    if (!msg.text) return;

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
        // Resolve the project path before wiping: a persisted chat knows it from its index entry; a
        // brand-new chat (no turns yet) falls back to the currently-open AE project.
        const conv = getConversation(id);
        const projectPath = conv ? conv.projectPath : ((await resolveProjectPath()) ?? "");
        session.messages = [];
        session.lastContextTokens = 0;
        deleteConversation(id); // explicit wipe — drop the persisted transcript too (dev escape hatch)
        deleteSessionBackups(projectPath, id); // and this chat's pre-turn backups
        broadcastConversations(); // the wiped chat leaves the sidebar on every client
        emit({ type: "compaction", status: "done", reason: "cleared" });
        return;
      }
      emit({ type: "compaction", status: "start" });
      // Proxy mode: pass the caller's token (the summary call is gated + metered like any other) — else
      // it 401s. Mirrors runTurnAndPersist(..., msg.token).
      const res = await compactSession(session, { authToken: msg.token });
      emit({ type: "compaction", status: res.ok ? "done" : "failed", reason: res.reason });
      return;
    }

    // If a turn is already running, a new message becomes a steer/queue — mirrors
    // Claude Code, where typing mid-run redirects the agent rather than starting a race.
    if (session.running) {
      session.pendingMessages.push({ id: msg.id ?? nextQueueId(), text: msg.text });
      return;
    }

    // Wrong-project guard (authoritative backstop): refuse to run a turn against a project AE doesn't have
    // open. A chat bound to a SAVED project whose path isn't the one currently open in AE would otherwise
    // edit the wrong project (and the post-turn rekey would silently migrate the chat). Reject BEFORE any
    // model call so no credit is spent. The renderer normally prevents this (it locks the composer in that
    // state); this catches paths it can't see — e.g. a reload while AE is on a different project. A brand-
    // new chat (no stored entry) is always allowed → it binds to whatever's open. An UNTITLED-project chat
    // (stored.projectPath === "") is also allowed → it legitimately adopts the project on first save
    // (unsaved → saved rekey in runTurnAndPersist, which is now the only case that rekey ever fires for).
    const stored = getConversation(id);
    if (stored && stored.projectPath !== "") {
      const live = await resolveProjectPath();
      if (live !== null && encodeProjectPath(stored.projectPath) !== encodeProjectPath(live)) {
        emit({ type: "error", message: `This chat belongs to ${stored.projectPath.split("/").pop()}, which isn't open in After Effects. Reopen it, or start a new chat in the current project.` });
        return;
      }
    }

    await runTurnAndPersist(session, msg.text, emit, msg.token);
    // Mid-turn steers are consumed inside runAgentTurn (which emits a `steer` per drain). Messages
    // that arrived AFTER the model's last tool boundary are still queued here → drain the whole
    // remaining queue into one combined follow-up turn (consistent with the in-turn drain-all).
    while (session.pendingMessages.length && !session.cancelRequested) {
      const drained = session.pendingMessages;
      session.pendingMessages = [];
      // Surface each drained item as a `steer` so the UI renders it as the user's message (in order,
      // before the follow-up turn's response) and clears its "queued" chip — matching the in-turn
      // drain. Without this, a message queued after the turn's last tool boundary runs but never
      // appears in the transcript and its chip lingers.
      // NOTE (⑥): these steers reach live sockets immediately, but the next runTurnAndPersist calls
      // resetBuffer() and clears them from the re-attach replay buffer. A renderer reattaching mid
      // follow-up turn won't replay them — it recovers them from committed history (loadHistory).
      for (const m of drained) emit({ type: "steer", id: m.id, text: m.text });
      const combined = drained.map((m) => m.text).join("\n");
      await runTurnAndPersist(session, combined, emit, msg.token);
    }
  });
}
