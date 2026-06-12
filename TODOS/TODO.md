## General Roadmap
- ✅ Phase 1 — MCP validation
- ✅ Phase 1.5 — Fix the MCP + finish all functionality I need + organize CRUD per operation + comprehensive testing suite
- ✅ Phase 2 — LLM brain + agent architecture (system prompt + Claude API backend) **and** the agent loop / self-healing loop (item 4): tool-execution loop, self-heal on errors, pre-turn backup snapshot, live narration, cancel/steer. Built + unit-tested; live run against AE (`npm run test:agent`) is the one remaining check.
   ↳ No separate Phase 3 — what I'd loosely planned as "Phase 3" (the self-healing/correcting loop) was absorbed here as Phase 2 item 4.
- ⬜ Phase 4 — **Standalone Electron desktop app** (chat UI) + **thin headless AE bridge** (the CEP extension demoted to `evalScript` dispatch only). The app consumes the agentEvent protocol, hosts the Node backend as a child process, auto-installs the AE bridge on first run, + seamless backup recovery (restore button + "Cubic, undo that"). Decision recorded in TODO-phase4.md — NOT an in-AE panel anymore.
- ⬜ Phase 5 — Pre-ship gate (nothing ships to anyone until ALL of these): hosted LLM proxy that holds the API key + injects the system prompt server-side, code obfuscation + binary packaging, and Stripe billing. **Push updates to users** = `electron-updater` (auto-update feed + staged rollouts/beta channel) now that the UI is an Electron app; this is also when app signing/notarization gets turned on. Full checklist → **`TODO-phase5.md`**.

---

## Phase 4 — Worktree execution plan (grouping · order · parallelization)

> Detailed checklist → `TODO-phase4.md`. This is the build order: which TODO items get grouped into each worktree, what each depends on, and what can run in parallel. Numbers = worktrees / Claude sessions.

**Key constraint:** §B4/§B5/§B6 + §C + §D all live in the new `app/` dir → they can't be parallel worktrees against each other (they'd collide). Real parallelism = backend tracks running *alongside* a serial frontend chain.

### Overall:
- **①** solo → merge. Then **② ∥ ③ ∥ ④** (the 3-at-once wave; merge ② first, ③/④ whenever). Then **⑤ → ⑥ → ⑦** serial. <br>

> **How to read this:** each worktree lists the **exact `TODO-phase4.md` checklist items** it owns, by §ref. To kick one off, tell Claude e.g. *"plan + execute worktree ③ (the items listed under WT-PERSISTENCE)."* Two sections are **split across worktrees** — §E (handler/undo in ④, button in ⑥) and §C2 (backend in ③, sidebar UI in ⑤); splits are flagged inline. §0 is a **decision** (already `[x]`), built across ②/③/⑥ — see note at bottom.

### ✅ DONE — Wave 0 — serialize (do alone, merge first)
**① WT-NAMING** — `mcp`→`bridge` rename + whole-codebase name audit. ✅ DONE + merged.
- [x] §B1 — `mcp`→`bridge` code-identifier naming pass
- [x] §B3 — whole-codebase naming audit
- ↳ §B2 (bundle-id/path rename) was **deferred out of here → ⑦ WT-CONNECT** (forces a one-time reinstall; rides with the new install flow). No longer blocks anything.

### ✅ DONE — Wave 1 — 3 parallel worktrees (after ① merged; these share zero files) — all three merged
**② WT-FE-FOUNDATION** — new `app/` dir (Electron + renderer skeleton). **← critical path: blocks all of Wave 2; merge this first.** ✅ BUILT (electron-vite scaffold).
- [x] §B4 — App shell (Electron main + React renderer, native window, menus, single-instance)
- [x] §B7 — Env-switchable backend (localhost vs prod proxy) — `CUBIC_ENV` flag → spawned child; `prod` stubbed until Phase-5 proxy
- [x] §0 (build) — `getBackendPort()` IPC: main is the single source of truth for the port (passes it to the child + answers the IPC; no file read), renderer opens its WS to that port

**③ WT-PERSISTENCE** — conversation persistence + in-flight re-attach. **Backend only.** ✅ DONE. Files: `ae-bridge/src/{agentChat.ts, persist.ts (new store), reattach.ts (new fan-out/buffer), bridge/wsBridge.ts}` + `ai/src/agent/{session.ts, loop.ts, events.ts}` + `ai/src/index.ts` (footprint expanded beyond the original 3 — `loop.ts`/`events.ts` for the `onCommit` hook, `wsBridge.ts` for the `attach`/`delete` types + ws-close hook; verified no overlap with ②/④).
- [x] §C2 — Backend JSONL store (`~/.cubic/sessions/<encoded-project>/<id>.jsonl` + global `index.json`; CC-style append-only, full history)
- [x] §C2 — Append per turn (crash-safe; fed by the loop's `onCommit` hook)
- [x] §C2 — Reload + continue (resume — lazy rehydrate from JSONL on first message for an id)
- [x] §C2 — Re-attach backend, in-flight turn (`emit` fan-out `Map<sessionId,Set<ws>>` + `attach`/`attached` wire + live-turn buffer in `reattach.ts`) ← **this is the §0 re-attach backend half**
- [x] §C2 — Per-project conversation list (keyed by project path; `listConversations`)
- [x] §C2 — Unsaved-project handling (`path:""` → `_untitled` bucket, lazy `rekey` on save)
- [x] §C2 — Instant placeholder titles (truncated first message, in `index.json`)
- [x] §C2 — Manual delete (backend `delete` ChatInbound; refuses mid-turn; the row-kebab **UI** lives in ⑤)

**④ WT-RESTORE** — backup recovery, backend pieces. ✅ DONE. Files: `ae-bridge/src/{commands.ts, scripts/bridge.jsx, scripts/project.jsx}` + `ai/src/{prompt/rules.ts, tools/command-params.ts}` (the model-visible spec → auto-flows into the `runScript` enum/catalog; footprint was 5 files, not the planned 3 — `bridge.jsx` for dispatch + undo-group bypass, the two `ai/` files for agent guidance + tool surface). Live-AE verified (`restoreProject` smoke test: throwaway comp vanished, path preserved, no save dialog).
- [x] §E — Restore handler (new bridge command: copy `.cubic-backups/` back + reopen via `close(DO_NOT_SAVE_CHANGES)` + `app.open` — reloads at the original path, no "save changes?" dialog; resolves target by `backupPath` → `turnId` → most-recent)
- [x] §E — Agent-driven restore ("Cubic, undo that" maps to the handler via `rules.ts` #4 — explicit user revert only, never as a self-heal step; no params = most recent)
- [x] §E — **pre-turn snapshot save popup — RESOLVED (option b, dirty-guard):** `backupProject` is now `if (project.dirty) project.save()` — clean project copies the on-disk `.aep` as-is (no popup, disk == memory), dirty saves first as before. Zero correctness loss, popup only fires when there are genuinely unsaved edits.
- ↳ §E **"Restore to before this request" button is NOT here** — it's renderer-side → ⑥ (will call this same handler).
- [ ] 🐞 **KNOWN BUG (found 6/12/26, ④ scope — fix before relying on undo):** "undo that" is a no-op. The
  loop snapshots EVERY turn pre-emptively (`loop.ts:116`, turnId=Date.now()), so the undo turn first
  snapshots the CURRENT state, then `restoreProject` with no args restores the "most recent" backup =
  that just-taken snapshot = the very state you're undoing → nothing changes (tool still returns ok, so
  the agent says "rolled back"). Fix options: (a) `restoreProject` no-args should restore the most recent
  backup whose contents DIFFER from the current working `.aep` (the undo turn's snapshot is byte-identical
  to current → skip it, land on the real prior state); or (b) thread the current turn's snapshot turnId so
  restore excludes it; or (c) don't snapshot a turn that only restores. (a) is cleanest + self-contained in
  `project.jsx`. Repro: create comp → "undo that" → comp remains.

### Wave 2 — frontend chain (after ② merged; DO SEQUENTIALLY — all share `app/`)
**⑤ WT-CHAT-UI** — the chat surface on `agentEvent`. Needs ② merged; sidebar needs ③ merged. ✅ DONE (branch `feat/wt-chat-ui`).
- [x] §C — Chat UI (agentEvent reducer + message history) — Zustand store `foldEvent` reducer; one `DisplayItem[]` display-model shared by live events + loaded history; Cursor-style transcript (boxed prompt, full-width assistant text, compact per-action tool rows w/ status icons).
- [x] §C — Render compaction/context events — "Tidying up earlier steps…" pill + friendly `context_full` "start a new chat" CTA card.
- [x] §C — Markdown rendering (`react-markdown` + `remark-gfm`, no `rehype-raw`; `.md-body` styles).
- [x] §C — Friendly transient-error rendering — mapped plain-English message + "Try again" (resend) + raw "Details" expander; delete-refusal surfaces as a toast.
- [x] §C — Command surface (buttons/icons, no slash commands) — New chat + per-row delete kebab; `/clear`,`/compact` stay backend-only.
- [x] §C — Good UX (spinner + progress words) — motion-themed gerunds cycled in reasoning gaps; per-tool spinners; loading splash; delete confirm modal + toasts.
- [x] §C — Instrument event seams (no-op `track(...)`) — `message_sent`/`turn_done`/`turn_error`/`conversation_deleted`/`new_chat`.
- [ ] §C — Manual E2E compaction test (deferred from Phase 2) — **still pending** (drive a real chat to ≥90% ctx → "Tidying up…" pill; push to ≥97% → `context_full` card).
- [x] §C2 (UI) — Conversation-list sidebar (collapsible, animated) + delete kebab + Home landing view.
- ↳ §C "Re-attach on reload (renderer half)" is **NOT here** — it's in ⑥.
- [x] optimize conversation-list loading — **decoupled from AE** (the list is local `index.json` data, so it loads instantly like Claude Code, no wait). `sendConversations` uses the real project path when the worker's connected, else `lastActiveProjectPath()` (most-recent conversation's project) as the guess; the bridge 'connect' push re-sends the authoritative list, which only changes anything on a project switch. Root cause was the old `waitForWorker` coupling the list to the CEP panel's exponential reconnect backoff (1s→10s).
- ↳ **Backend footprint (⑤ wasn't frontend-only):** new `list`→`conversations` + `loadHistory`→`history` wire (`wsBridge.ts`/`agentChat.ts`/`PROTOCOL.md`); `displayItems.ts` (Message[]→DisplayItem transform); friendly `describeToolCall` labels (`cubic-ai/events.ts`); `.env` loading at backend boot (`startBackend.ts`); public `bridge.waitForWorker`.

**⑥ WT-CONTROLS** — run controls + the renderer halves that need ⑤'s reducer. Needs ⑤ + ③'s wire + ④'s handler.
- [ ] §D — Stop/cancel button (+ Esc) → `{type:'cancel'}`
- [ ] §C — Re-attach on reload (renderer half): on (re)connect send `{type:'attach',sessionId}`, feed buffered `events` through the reducer
- [ ] §E — "Restore to before this request" button (snapshot list + confirm-before-overwrite)

**⑦ WT-CONNECT** — provisioning + connection. Needs ② merged.
- [ ] §B2 (deferred rename — **do FIRST in this worktree**): bundle id `com.cubic.ae-mcp-bridge`→`com.cubic.ae-bridge`; rename `~/.ae-mcp-bridge` port dir (writer `wsBridge.ts` + reader `bridge/client.ts` **together**); "MCP Bridge" CEP panel display name in `manifest.xml`
- [ ] §B5 — Auto-install the AE bridge (write into CEP extensions dir under the NEW bundle id + enable PlayerDebugMode)
- [ ] §B6 — Connection-state UX (connected / open AE / reconnecting / not-installed / port-in-use)
- ↳ §B2's one-time forced reinstall is free here because the install flow is being rebuilt — that's why it rides with ⑦, not ①.

### notes
- **§0 is a decision, not code.** Its `[x]` means the transport is *decided* (direct WS + one `getBackendPort()` IPC + re-attach-by-`sessionId`). The code gets built later: IPC → ②, re-attach backend half → ③, re-attach renderer half → ⑥.
- **Within a worktree:** plan all its items as one design, implement in *dependency order, not doc-bullet order*.
- ⑤/⑥/⑦ cross-wave deps (③'s sidebar/wire, ④'s handler) are auto-satisfied — Wave-1 is merged before you reach them.
- **If only running 2 parallel:** run ② ∥ ③, slot ④ (smallest, backend-only) right after ③ in the same slot.

---

**6/9/26: eventually shift the stuff below to a separate todo for post mvp stuff (maybe call it phase 6?)

# postmvp
Resume cost of huge chats: on reopen we load full history; the first turn
 auto-compacts
 (≥90%) or hits the existing context_full CTA (≥97%) — same safety net §C
 renders. **A friendlier pre-warning is a later refinement, not built here.**

# somewhat post mvp, maybe during (billing/usage limiting)
- System prompt, web verify the after effects standard conventions for smooth/juicy/bouncy settings for the good saas videos
- Take inspo from good looking after effects youtube video tutorials
- Maybe inspo from gaming montages as well? (since those are usually edited well)

# context quality — agent only sees point-in-time property values, not keyframes/animation
The per-turn live-state snapshot (`server/ai/src/context/buildContext.ts`) reads each property's VALUE
at the current playhead time. If the playhead sits at t=0 where an animation hasn't started, Scale/etc.
read as `[0,0]` and the agent concludes "nothing is visible / no animation" — even when the comp clearly
has keyframed animation (it just doesn't see keyframes unless it calls `getLayerKeyframes`). Surfaced
6/12/26 while testing wt-chat-ui (amplified by Haiku; default Sonnet 4.6 reasons better). Fix options:
include a keyframe/animation summary in the live-state context, and/or prompt the agent to check
keyframes before declaring a layer static. Context/prompt work — NOT a chat-UI concern.

# post mvp
True token-level streaming + tool events
  WHY: Smoothest 'typing' feel, most like Claude Code. WHY NOT: Must rebuild
  stream() to pass tools + accumulate tool_use JSON deltas + reconcile with
  the loop — meaningfully more code and edge cases. Polish you can add
  post-MVP without changing the loop's shape.

# post mvp (hot swappable models)
Do later. Design for it now by keeping all LLM calls behind a single wrapper (one file to change).

How Cursor does it: direct provider SDKs (Anthropic SDK, OpenAI SDK, Google SDK) + their own
adapter interface — NOT Vercel AI SDK. Reason: need direct access to provider-specific features
(extended thinking, o1 reasoning, etc.) that abstraction layers lag on.

  interface LLMProvider {
    chat(messages, opts): Promise<Response>
    stream(messages, opts): AsyncIterable<Chunk>
  }
  class AnthropicProvider implements LLMProvider { ... }
  class OpenAIProvider implements LLMProvider { ... }

For MVP: implement AnthropicProvider only. Add others when needed.

