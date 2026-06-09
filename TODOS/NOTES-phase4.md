# Phase 4 — Decisions & context (the "why")

> Companion to `TODO-phase4.md` (the checklist). Reference, not todos. Checklist items link here by anchor when they need the rationale.

## Decisions & context

**Resolved decisions**
- **Standalone Electron desktop app, not an in-AE panel.** CEP extension demoted to a thin, headless `evalScript` bridge (no UI). We're ~95% decoupled already — the agent loop/LLM/sessions/compaction run in Node and reach AE as a WS client of `127.0.0.1:17923`; the `{id,command,args}` ↔ `{id,ok,result}` protocol is the real, stable interface. Strategic: one UI, swap the bridge adapter per host later (Premiere = CEP near-free; DaVinci = Python/Lua WS; FCP = unlikely).
- **Pure auto-run for MVP.** Tool calls execute immediately — no accept/reject, no plan step. Safe: every command is ⌘Z-able + pre-turn `.aep` backup; users are video editors, not coders. _Post-MVP:_ plan mode + accept-edits-one-at-a-time.
- **v1 bar = lean but paid-public-ready.** Cut power-user / refinement extras; keep consumer table-stakes. The two systems that protect a paying stranger's work — **context-window management** and **pre-turn snapshots** — are both already done (Phase 2 backend), so zero project-breaking risk was trimmed.
- **Sequencing rule: backend before UI.** Backend-first v1 items: **§C2** (JSONL store), **§E** (restore handler).

**Stack notes**
- **Electron over Swift** — backend is TS/Node; Electron reuses it. Native-feel is good enough; render perf isn't the bottleneck.
- **Signing/notarization + auto-update → Phase 5.** Run unsigned locally until then.
- **Analytics** — keep cheap no-op event seams in v1 (so you don't retrofit later); pick the vendor + `distinct_id` + flags in a later pass.

---

## Decision log
> Append an important dated record here whenever a grill resolves an important decision. The checklist points at these anchors.

### §0 — Renderer ↔ backend transport + re-attach <a id="d0"></a>
_Resolved 2026-06-08 (grill)._

**Transport = Direct WebSocket.** Renderer opens `ws://127.0.0.1:<port>` as a 3rd client alongside the CEP worker + `cubic-ai` loopback; reuses the `{userChat/cancel/queue}`↔`{agentEvent}` protocol verbatim. `main` only spawns/supervises the child — never in the chat hot path. Renderer stays sandboxed (`WebSocket` is a browser global → no `nodeIntegration`).
- **Port discovery:** one IPC `getBackendPort()` from `main` at startup (`main` reads `~/.ae-mcp-bridge/port`); all chat traffic is direct WS. Keeps `fs`/`ws` out of the renderer.
- _Rejected — Electron IPC relay:_ can't hide `17923` (the AE CEP panel, a separate process, keeps it open regardless), so it buys only encapsulation at the cost of a relay + duplicated attach/replay logic in `main`.

**Re-attach to an in-flight turn by `sessionId`** (renderer reload while the backend child keeps running — ⌘R / window reopen / renderer crash). Backend half lands with §C2/§C; renderer half rides §C.
- **Emit routing** — replace the single captured socket (`agentChat.ts:51`) with `Map<sessionId, Set<ws>>`; `emit()` fans out to the set. `attach` adds the socket, `ws` `close` removes it. (Set tolerates the reload overlap window; single-instance ⇒ ~1 socket in practice.)
- **Live-turn event buffer** — backend accumulates the current turn's `agentEvent`s; clears the buffer **only after** the committed turn is appended to the §C2 JSONL store. One source covers every turn — buffer until persisted, history after — so a reload sees no gap and no dupe.
- **Wire** — renderer sends `{type:'attach', sessionId}`; backend replies with one envelope `{type:'attached', sessionId, running, events: AgentEvent[]}`. Renderer feeds `events` through its normal `agentEvent` reducer + sets spinner/Stop from `running`. (New message types: `attach`, `attached`.)
- **Scope = live turn only.** Committed history loads separately via §C2's resume path (read JSONL `Message[]`), which fires on every conversation open regardless of run state. The two ops run in parallel on reload — history renders above, the live turn below — so §0 doesn't block on §C2's storage format.
- **`sessionId` = renderer-minted** (uuid on "New chat"), persisted in renderer storage as the active id, sent with the first `userChat`; backend uses it verbatim as the `sessions` Map key + JSONL filename. On reload the renderer recovers the active id from its own storage → falls back to §C2 most-recent for the project → else a fresh chat. `cancel`/`queue`/`steer` after reload just work: the new socket sends them with `sessionId`, keyed into the surviving `sessions` Map.
- _Out of scope:_ whole-app quit mid-turn loses the in-flight turn (resume from the last committed JSONL turn — the §C2 guarantee). Re-attach only covers a renderer restart against a still-live backend.
