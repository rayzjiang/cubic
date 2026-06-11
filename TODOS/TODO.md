## General Roadmap
✅ Phase 1 — MCP validation
✅ Phase 1.5 — Fix the MCP + finish all functionality I need + organize CRUD per operation + comprehensive testing suite
✅ Phase 2 — LLM brain + agent architecture (system prompt + Claude API backend) **and** the agent loop / self-healing loop (item 4): tool-execution loop, self-heal on errors, pre-turn backup snapshot, live narration, cancel/steer. Built + unit-tested; live run against AE (`npm run test:agent`) is the one remaining check.
   ↳ No separate Phase 3 — what I'd loosely planned as "Phase 3" (the self-healing/correcting loop) was absorbed here as Phase 2 item 4.
⬜ Phase 4 — **Standalone Electron desktop app** (chat UI) + **thin headless AE bridge** (the CEP extension demoted to `evalScript` dispatch only). The app consumes the agentEvent protocol, hosts the Node backend as a child process, auto-installs the AE bridge on first run, + seamless backup recovery (restore button + "Cubic, undo that"). Decision recorded in TODO-phase4.md — NOT an in-AE panel anymore.
⬜ Phase 5 — Pre-ship gate (nothing ships to anyone until ALL of these): hosted LLM proxy that holds the API key + injects the system prompt server-side, code obfuscation + binary packaging, and Stripe billing. **Push updates to users** = `electron-updater` (auto-update feed + staged rollouts/beta channel) now that the UI is an Electron app; this is also when app signing/notarization gets turned on. Full checklist → **`TODO-phase5.md`**.

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

### Wave 1 — 3 parallel worktrees (after ① merged; these share zero files)
**② WT-FE-FOUNDATION** — new `app/` dir (Electron + renderer skeleton). **← critical path: blocks all of Wave 2; merge this first.**
- [ ] §B4 — App shell (Electron main + React renderer, native window, menus, single-instance)
- [ ] §B7 — Env-switchable backend (localhost vs prod proxy)
- [ ] §0 (build) — `getBackendPort()` IPC: main answers the one port-discovery IPC, renderer opens its WS to that port

**③ WT-PERSISTENCE** — conversation persistence + in-flight re-attach. **Backend only.** ✅ DONE. Files: `ae-bridge/src/{agentChat.ts, persist.ts (new store), reattach.ts (new fan-out/buffer), bridge/wsBridge.ts}` + `ai/src/agent/{session.ts, loop.ts, events.ts}` + `ai/src/index.ts` (footprint expanded beyond the original 3 — `loop.ts`/`events.ts` for the `onCommit` hook, `wsBridge.ts` for the `attach`/`delete` types + ws-close hook; verified no overlap with ②/④).
- [x] §C2 — Backend JSONL store (`~/.cubic/sessions/<encoded-project>/<id>.jsonl` + global `index.json`; CC-style append-only, full history)
- [x] §C2 — Append per turn (crash-safe; fed by the loop's `onCommit` hook)
- [x] §C2 — Reload + continue (resume — lazy rehydrate from JSONL on first message for an id)
- [x] §C2 — Re-attach backend, in-flight turn (`emit` fan-out `Map<sessionId,Set<ws>>` + `attach`/`attached` wire + live-turn buffer in `reattach.ts`) ← **this is the §0 re-attach backend half**
- [x] §C2 — Per-project conversation list (keyed by project path; `listConversations`)
- [x] §C2 — Unsaved-project handling (`path:""` → `_untitled` bucket, lazy `rekey` on save)
- [x] §C2 — Instant placeholder titles (truncated first message, in `index.json`)
- [x] §C2 — Manual delete (backend `delete` ChatInbound; refuses mid-turn; the row-kebab **UI** lives in ⑤)

**④ WT-RESTORE** — backup recovery, backend pieces. Files: `commands.ts`, `project.jsx`, `snapshot.ts`.
- [ ] §E — Restore handler (new bridge command: copy `.cubic-backups/` back + reopen project)
- [ ] §E — Agent-driven restore ("Cubic, undo that" maps to the handler)
- [ ] §E — **⚠️ GRILL FIRST: kill/reduce the pre-turn snapshot save popup** (`project.jsx:58` `project.save()` → AE save-progress window every turn). Decide save-vs-popup trade-off before coding — full options in `TODO-phase4.md` §E. **Belongs here** because it touches `project.jsx`/`snapshot.ts` (④'s files) → no overlap with ③ (done) or ②/⑤/⑥/⑦.
- ↳ §E **"Restore to before this request" button is NOT here** — it's renderer-side → ⑥.

### Wave 2 — frontend chain (after ② merged; DO SEQUENTIALLY — all share `app/`)
**⑤ WT-CHAT-UI** — the chat surface on `agentEvent`. Needs ② merged; sidebar needs ③ merged.
- [ ] §C — Chat UI (agentEvent reducer + streaming per-iteration + message history)
- [ ] §C — Render compaction/context events ("compacting…" indicator + `context_full` CTA)
- [ ] §C — Markdown rendering (`react-markdown` + `remark-gfm`)
- [ ] §C — Friendly transient-error rendering
- [ ] §C — Command surface (buttons/icons, no slash commands)
- [ ] §C — Good UX (spinner + progress words)
- [ ] §C — Instrument event seams (no-op `track(...)`)
- [ ] §C — Manual E2E compaction test (deferred from Phase 2)
- [ ] §C2 (UI) — Conversation-list sidebar + delete kebab (consume ③'s `index.json`)
- ↳ §C "Re-attach on reload (renderer half)" is **NOT here** — it's in ⑥.

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

# somewhat post mvp, maybe during (billing/usage limiting)
- System prompt, web verify the after effects standard conventions for smooth/juicy/bouncy settings for the good saas videos
- Take inspo from good looking after effects youtube video tutorials
- Maybe inspo from gaming montages as well? (since those are usually edited well)

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

