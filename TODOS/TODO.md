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

### ✅ DONE (except deferred §B2) - Wave 0 — serialize (do alone, merge first)
1. **WT-NAMING — §B1 + §B3** — `mcp`→`bridge` code-identifier rename + whole-codebase name audit. ✅ DONE + merged. Cross-cutting (renames files §E / §B5 depend on). **The §B2 bundle-id/path rename was deferred out of here → folded into ⑦ WT-CONNECT** (it forces a one-time reinstall, so it rides with the new install flow being built there). **Merge before forking anything.**

### Wave 1 — 3 parallel worktrees (after ① merges; these share zero files)
2. **WT-FE-FOUNDATION — §B4 + §B7 + port IPC** — new `app/`: Electron main + React renderer skeleton, native window, menus, single-instance; env-switchable backend; `getBackendPort()` IPC. **← critical path: blocks all of Wave 2; merge this first.**
3. **WT-PERSISTENCE — §C2 + §0 re-attach (backend half)** — JSONL store, per-turn append, resume, per-project list, unsaved-project re-key, placeholder titles, manual-delete (backend); `emit` fan-out `Map` + `attach`/`attached` wire + live-turn buffer. Files: `agentChat.ts`, `session.ts`, new store.
4. **WT-RESTORE — §E restore handler (backend) + agent-driven undo** — new bridge command (copy `.cubic-backups/` back + reopen project), exposed as agent tool ("Cubic, undo that"). Files: `commands.ts`, `project.jsx`, `snapshot.ts`.

### Wave 2 — frontend chain (after ② merges; TO BE DONE SEQUEUNTIALLY — all share `app/`)
5. **WT-CHAT-UI — §C core + §C2 sidebar** — `agentEvent` reducer + streaming + history → markdown → friendly error render → command surface (buttons, no slash) → spinner/UX → compaction-event render → instrument seams; + conversation-list sidebar + delete kebab (consume §C2 `index.json`). Needs ② merged (sidebar needs ③).
6. **WT-CONTROLS — §D + §C re-attach (renderer half) + §E restore button** — Stop/cancel (+Esc); re-attach-on-reload renderer half; "Restore to before this request" button. Needs ⑤ + ③'s wire + ④'s handler.
7. **WT-CONNECT — §B2 + §B5 + §B6** — **first do the deferred §B2 bundle/path rename here** (write the install path with the final `com.cubic.ae-bridge` bundle id; rename the `~/.ae-mcp-bridge` port dir — writer `wsBridge.ts` + reader `bridge/client.ts` together; update the "MCP Bridge" CEP panel display name in `manifest.xml`), then auto-install the headless bridge + PlayerDebugMode; connection-state UX (connected / open AE / reconnecting / not-installed / port-in-use). Needs ②. (§B2 is self-contained in this worktree — the one-time forced reinstall is free because the install flow is being rebuilt here; no longer a dep on ①.)

### other notes
- ⑤/⑥/⑦ depend on the prior + on already-merged Wave-1 backend, so their cross-wave deps (③ sidebar/wire, ④ handler) are auto-satisfied by the time you reach them.
- **Within a worktree:** plan all its items as one design, implement in *dependency order, not doc-bullet order*.
- **if doing 2 parallel:** run ② ∥ ③, slot ④ (smallest, backend-only) right after ③ in the same slot.

---
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

