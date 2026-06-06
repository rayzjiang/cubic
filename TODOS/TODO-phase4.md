## Phase 4 — Standalone Electron app + thin AE bridge

### ✅ Decision (resolved): standalone Electron desktop app, NOT an in-AE panel
The chat UI ships as a **separate Electron desktop app** that connects to After Effects over the existing WebSocket bridge. The CEP extension stays, but is demoted to a **thin, headless bridge** (its only job is `evalScript` dispatch — no UI). Rationale:
- We're already ~95% decoupled — the CEP panel was only ever a WS client + `evalScript` executor. The agent loop, LLM calls, sessions, and compaction all run in the Node process and reach AE as just another WS client of `127.0.0.1:17923`. The protocol (`{id, command, args}` ↔ `{id, ok, result}`) is the real interface, and it's stable.
- Electron is the proper **home for the Node backend** post-Phase-5 (no Claude Code to spawn it) — main process spawns the agent loop + bridge server, renderer is the UI. CEP's embedded old Node is a fragile host by comparison.
- Modern Chromium → the Claude-Code-grade streaming chat UX is *achievable* instead of a fight against CEP's stale CEF.
- Native FS → the backup-recovery viewer (browse `.cubic-backups/`, native dialogs) becomes easy, not clunky.
- **Strategic:** one UI, swap the *bridge adapter* per host later (Premiere = also CEP, near-free; DaVinci = Python/Lua WS bridge; FCP = weak scripting, likely never). The UI is written once.

**Why this doesn't blow up the rest of the phase:** almost every item below is host-agnostic — cancel/queue/steer are the same WS messages, compaction/`context_full` rendering is the same `agentEvent` consumption, the chat UI consumes the same protocol. We're changing *where it renders*, not *what we build*. The only net-new work is the "split the panel + connection bootstrap" workstream (A + B).

> **Stack notes** (from architecture discussion):
> - **Electron over Swift** — backend is all TS/Node; Electron reuses it, shares types, and hosts the Node backend as a child process. Native-feel (vibrancy, traffic-light styling, native menus/dialogs) is good enough for a chat-beside-AE app. Swift's payoff (raw render perf) isn't our bottleneck. Industry default for non-terminal AI editors is Electron (Cursor/Windsurf/VS Code forks); Zed is the lone native outlier (Rust, perf-driven — not us).
> - **Notarization + auto-update** are deferrable: run unsigned locally; turn on `electron-builder` signing/notarization (Apple Dev acct, $99/yr) + `electron-updater` (staged rollouts, beta channel) when packaging for real users in/around Phase 5. This is also the "push updates to my users" item from TODO.md Phase 5.
> - **Analytics (later, not now):** want usage analytics + feature flags / A-B testing in the app — works in Electron's renderer; manage a per-install `distinct_id` ourselves; ship variants dark and flip flags server-side (flags = our substitute for staging). Pick the vendor + wire it in a later pass; just leaving the hook here so the UI is built with event instrumentation in mind.

---

### A. Split the CEP panel → headless AE bridge (foundation)
- [ ] **Demote `cep-extension/` to a headless bridge** — strip the status/port UI down to the bare WS-client + `evalScript` dispatch (Role B only). It should run invisibly/background and auto-connect to the bridge on AE launch. No chat, no logic.
- [ ] **Lock the wire protocol as the contract** — the app ↔ bridge boundary is `{id, command, args}` ↔ `{id, ok, result}` plus the `userChat`/`queue`/`cancel`/`agentEvent` chat messages. Document it once; everything downstream (and future host adapters) depends only on this.
- [ ] **Decide where the Node backend lives** — Electron main process spawns `server/ae-bridge` (bridge + agent loop) as a child; renderer (UI) talks to it. Confirm the bridge still opens `127.0.0.1:17923` and the headless AE extension connects as the worker client exactly as today.

### B. Electron app shell + auto-provisioning
- [ ] **App shell** — new top-level dir (e.g. `app/`): Electron main + renderer (React), native window (vibrancy/traffic-lights), menus, single-instance.
- [ ] **Auto-install the AE bridge** — on first run / "Connect to After Effects", the app writes the headless bridge extension into the CEP extensions folder (`~/Library/Application Support/Adobe/CEP/extensions/com.cubic.ae-mcp-bridge/`) and enables PlayerDebugMode. One app install → it provisions the bridge → AE auto-connects on next launch. (This replaces the old ZXP/`install-plugin` friction.)
- [ ] **Connection state UX** — clear "connected to AE / open After Effects / reconnecting" status in the app; handle AE not running, bridge not installed, port in use.
- [ ] **Env-switchable backend** — config/env to point the app at `localhost` vs the prod proxy (needed once Phase 5's proxy exists).
- [ ] (Deferred to ~Phase 5) **Signing/notarization + auto-update** — `electron-builder` sign+notarize, `electron-updater` feed + staged rollouts. Run unsigned for local dev until then.

### C. Chat UI on the `agentEvent` protocol
- [ ] **Chat UI** (was "CEP panel chat UI") — build the renderer UI that consumes the `agentEvent` protocol (streaming event display, message history); prerequisite for agent-run controls and recovery UI. Optional: token-level streaming.
    - [ ] **Render the compaction/context events** (backend done in Phase 2 — auto-compaction, `/clear`, `/compact`): show `compaction` (start/done/failed) as a subtle "compacting conversation…" indicator (NOT a scary error), and render `context_full` as a friendly "this chat is too long — start a new one" CTA, not a red error. Optional: a context-usage meter (`Session.lastContextTokens` vs the model's `contextWindow`).
    - [ ] **Manual end-to-end test of compaction (deferred from Phase 2)** — backend logic is unit-tested (free, in `compaction.test.ts`/`loop.test.ts`), but the real-AE feel was left for this UI. Once the chat UI exists: (1) type `/clear` → history empties; (2) type `/compact` → older turns collapse to a `<conversation_summary>` and the next turn continues coherently; (3) trigger auto-compaction by holding a long conversation (or temporarily lower the threshold via the `compactThreshold`/`contextWindowOverride` deps on `runAgentTurn`) and confirm it fires at the turn boundary without losing recent context; (4) force the hard ceiling and confirm the `context_full` pause. Run any real-API check with `CUBIC_LLM_DEBUG=1` to watch I/O + per-call cost.
- [ ] **Good UX** (similar to Claude's spinning progress bar + nice words, etc.)
- [ ] **Instrument events as you build** — fire analytics events at the natural UI seams (turn start/end, tool runs, cancels, restores, errors) behind a thin wrapper so the vendor is swappable. Don't wire a vendor yet; just don't build the UI analytics-blind.

### D. Agent-run controls (Claude-Code-style)
The loop's BACKEND hooks all exist from Phase 2 (`Session.cancelRequested` + the `pendingMessages` FIFO queue, checked at iteration boundaries; agentChat.ts maps `cancel`/`queue`/`editQueue`/`removeQueue`). Phase 4 is pure app-UI wiring:
- [ ] Esc / cancel button → sends `{type:'cancel'}` to stop the current run at the next boundary.
- [ ] Type-while-running → sends `{type:'queue', id, text}` to steer the agent (injected at the next tool boundary, or as a fresh follow-up turn).
- [ ] Show the queued/steering message(s) + allow editing/removing before they fire → send `editQueue`/`removeQueue` by `id`; mark a row "sent" when its `steer` event (carrying that `id`) arrives.

### E. Seamless backup recovery
The agent loop already saves a pre-turn `.aep` snapshot to `.cubic-backups/` (rolling last-10), but recovery is currently manual (dig into the hidden folder in Finder). Make it ergonomic (Electron's native FS makes this easy now):
- [ ] **VERY IMPORTANT:** App "restore to before this request" button — list recent snapshots (per turn, with timestamp/summary) and restore the chosen one over the working file (then reopen).
- [ ] Agent-driven restore — a "Cubic, undo that / revert the last change" command the model understands, mapping to a restore handler (new MCP command: copy a chosen `.cubic-backups/` file back + reopen project).
- [ ] Confirm-before-overwrite (restoring replaces current working state — guard it).
- [ ] Cubic undo history viewer + dedicated keybind?

### F. Transient API-error polish (not a blocker)
When Anthropic has a transient error (429/529/network), the SDK auto-retries (default 2; we can bump). If those also fail, `chat()` throws → the loop's `catch` emits a raw `error` event and the turn ends (process/session fine, history intact, AE changes already applied stay — user just re-sends). Two rough edges to smooth:
- **#1 (UI):** the `error` event carries the raw SDK text (e.g. `529 overloaded_error`) → render it as a friendly "Claude's busy, try again." Folds into building the chat UI (same `agentEvent` rendering).
- **#2 (backend):** a mid-turn failure abandons the *whole* turn (e.g. dies on iteration 6/10) → auto-retry the failed iteration so the turn resumes instead of restarting. Post-launch polish.
- Quick win (backend, anytime): `new Anthropic({ apiKey, maxRetries: 4 })` for a bit more resilience. (eg. if it fails after it made some changes to ur project, it just abandons instead of resuming cleanly) — **make it autoretry the failed iteration instead of killing the turn**

---

### Super important
- [ ] **Permission/Edit modes like CC** — Rn, everything auto executes. For a creative AE tool with per-command ⌘Z and pre-turn backups, auto-run is defensible (and faster UX). But CC's whole feel includes accept/reject + a plan step. Decide deliberately: pure auto-run (simplest, recommended for v1) vs. a confirm-destructive / plan-first mode. **It affects the app's layout, so pick before designing it — not after.**
- [ ] **Mid-turn state-staleness guard (Claude-Code-style "modified since read")** — today if the user edits the project *while* a turn runs, only destructive drift is caught (a stale-target tool call fails with `LAYER_NOT_FOUND`/etc. → self-heal re-reads); silent drift (e.g. user nudges a layer's position) is acted on against stale context. AE has no free revision counter (unlike file mtime), so: capture a cheap project-state **fingerprint** at turn start, re-check it before each *mutating* tool call, and on mismatch emit a new `STATE_STALE` error code into the existing self-heal path → model re-reads fresh context before retrying. Post-launch hardening, not a blocker.
- [ ] **Motion-quality judgement call (deferred from Phase 2)** — once the UI is done, drive it through real prompts and watch the rendered output. Then decide: does the model's understanding of "juicy/good" motion design actually need improving (recipes already exist + system prompt steers toward them, so the baseline may be enough)? If yes, decide the best way to do it (e.g. tune recipe defaults, adjective→recipe mapping in the system prompt, more composite recipes, or a visual feedback loop) — NOT a separate preset library by default.
- [ ] Giving the AI an option to view video it just generated (probably have to integrate with Google Gemini?? since gemini has video feature) — BECAUSE no point in having my ai read images, it should be viewing video..

---

### Deferred cleanup: finish the `mcp` → `bridge` rename
Done already: `server/mcp` → `server/ae-bridge` (folder + package name `cubic-ae-bridge`), `.mcp.json` path, all `server/mcp` doc/comment path refs. **Principle:** only the genuine MCP server entrypoint (`src/index.ts` + `.mcp.json` + the `@modelcontextprotocol/sdk` dep, kept as a dev interface) should keep the `mcp` name — everything else is *bridge*. These lingering misnomers were left for a focused follow-up (low-value churn / runtime-identity risk, not worth bundling into the folder move):
- [ ] **`server/ai/src/mcp/`** (the `McpClient` + `tools.ts` that talk to the bridge over WS) → rename to `src/bridge/` + `McpClient` → `BridgeClient`. Touches ~5 import paths in `server/ai` + the `vi.mock('../mcp/client.js')` test mock. It's a bridge client, not MCP.
- [ ] **`mcp-bridge.jsx`** (the ExtendScript dispatch/batch/undo file — pure bridge infra, no MCP) → rename to `bridge.jsx`. Update the `domainFiles` array in `scripts/build-cep-extension.mjs` + the "handlers must not live in mcp-bridge.jsx" rule + doc refs in `server/ae-bridge/CLAUDE.md`.
- [ ] **CEP bundle id `com.cubic.ae-mcp-bridge`** (in `cep-extension/CSXS/manifest.xml` + the AE install path) → `com.cubic.ae-bridge`. ⚠️ Changes the install-path folder, so it forces a one-time reinstall of the AE extension — do it when you're already touching the install flow (workstream A/B), not standalone.
