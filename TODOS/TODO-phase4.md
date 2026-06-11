# Phase 4 — Standalone Electron app + thin AE bridge (v1 / MVP scope)

> **Scope:** this file is **strictly the v1 MVP build** — the leanest app that's *paid-public-ready*: won't break a paying stranger's project, won't look broken to a non-technical video editor. Deferred / post-MVP items live in **`TODO-phase4-later.md`** (each tagged with the §section it came from).
> **The wall:** Phase 5 (hosted proxy holding the API key + Stripe billing + obfuscation + auto-update) is a **hard gate before any paying customer** — not in this file. This trim shortens the road *to* that wall; it doesn't remove it.

> **Decisions & rationale live in [`NOTES-phase4.md`](./NOTES-phase4.md)** — this file is the checklist only. Items link there by anchor when the "why" matters.

---

## §0. Renderer ↔ backend transport — ✅ DECIDED (gates §B/§C) → [NOTES](./NOTES-phase4.md#d0)
- [x] **Direct WebSocket** + one `getBackendPort()` IPC for port discovery. (Rejected: IPC relay.) Re-attach-by-`sessionId` also decided → **built** under §C2 (backend half) + §C (renderer half).
  - [x] **`getBackendPort()` IPC built** (WT-FE-FOUNDATION) — `main` is the single source of truth for the port (passes it to the spawned child + answers the IPC; no file read — corrected from the original "main reads the file", see NOTES d0). Renderer opens its WS to the returned port.

---

## §A. Split CEP panel → headless AE bridge (foundation)
- [x] **Demote `cep-extension/` to a headless bridge** — strip the status/port UI to bare WS-client + `evalScript` dispatch (Role B only). Runs invisibly, auto-connects on AE launch. No chat, no logic.
- [x] **Fix headless port discovery (latent bug).** Bridge binds `17923` (fallback scan → `17927`) and writes the chosen port to `~/.ae-mcp-bridge/port`, but the panel never reads it — it uses the manual port box (default `17923`). Once the UI is stripped, a fallback port silently fails to connect. **Fix:** bridge reads `~/.ae-mcp-bridge/port` on connect **+ re-reads on reconnect**. (Alt: drop the fallback scan, hard-fail on a `17923` conflict.)
- [x] **Lock the wire protocol contract** — `{id,command,args}` ↔ `{id,ok,result}` + `userChat`/`queue`/`cancel`/`agentEvent`. Document once; future host adapters depend only on this.
- [x] **Backend lives in Electron main** — main spawns `server/ae-bridge` (bridge + agent loop) as a child. Confirm it still opens `127.0.0.1:17923` and the headless extension connects as the worker client as today.

## §B. Electron app shell + auto-provisioning
- [x] **`mcp` → `bridge` code-identifier naming pass** ⚠️ hard gate before ship — DONE (code identifiers only; verified by full build + unit + drift + bundle-content check):
    - [x] `server/ai/src/mcp/` → `src/bridge/`, `McpClient`/`mcpClient` → `BridgeClient`/`bridgeClient` (importers + the `vi.mock` mock + the 3 live `tests/*.mjs` that import the singleton).
    - [x] `mcp-bridge.jsx` → `bridge.jsx` (`domainFiles` in `scripts/build-cep-extension.mjs`, the "handlers must not live in …" rule + doc refs in both `CLAUDE.md`, `commands.ts` + test comments, and the real `readFile` path in `tests/bridge.mjs`).
    - [x] Keep `mcp` ONLY on the real MCP entrypoint (`src/index.ts` + `.mcp.json` + `@modelcontextprotocol/sdk` dev dep) — left untouched.
- [ ] **Path/bundle renames — DEFERRED to the auto-install item below** (force a reinstall/migration, so they land *with* the new install flow): bundle id `com.cubic.ae-mcp-bridge` → `com.cubic.ae-bridge`; `~/.ae-mcp-bridge/port` home dir (paired writer `wsBridge.ts` + reader `bridge/client.ts`); AE CEP panel display name "MCP Bridge".
- [x] **Whole-codebase audit — done** — beyond `mcp`→`bridge`, named-for-actual-scope review. Applied (user-approved): `AE_MCP_PORT` → `AE_BRIDGE_PORT` (it's the WS bridge port, not MCP-specific; no external setter), `MCP_SRC` → `AE_BRIDGE_SRC` in `drift-guard.mjs`, and reworded the `client.ts` connect-error message + `agentChat.ts` process comment + the "live WebSocket bridge" scope prose in `server/ai/CLAUDE.md` (they mislabelled the bridge as MCP). Kept as-is (user-approved): `__MCP_TEST_*` test-comp prefixes + "After Effects MCP" suite labels (test-only, never shipped, high churn / low value). Deferred to the install/config plan: the `~/.cubic-backups` (sibling) vs `~/.cubic/{frames,sessions}` (child) path inconsistency.
- [x] **App shell** — new `app/` dir: Electron main + React renderer, native window (vibrancy/traffic-lights), menus, single-instance. ✅ WT-FE-FOUNDATION (electron-vite; main spawns + supervises `serve.js`, logs + `died` signal on crash, no auto-restart → §B6/⑦; renderer = thin WS connection proof, chat UI → §C/⑤).
    - [x] **Styling stack = Tailwind v4** (done on `main` post-merge) — `tailwindcss` + `@tailwindcss/vite` plugin (CSS-first, no `postcss`/`autoprefixer`/`tailwind.config.js`). `styles.css` is now `@import 'tailwindcss'` + a base layer for the global-only bits (dark `color-scheme`, full-height root, transparent body for macOS vibrancy) + a `@theme` SF-Pro font override; component classes are utilities. CSP unchanged (inline `<style>` in dev, `'self'` bundle in prod). The real chat UI in §C/⑤ builds in Tailwind.
- [ ] **Auto-install the AE bridge** — on first run / "Connect to After Effects", write the headless bridge into `~/Library/Application Support/Adobe/CEP/extensions/com.cubic.ae-bridge/` + enable PlayerDebugMode. One app install → provisions the bridge → AE auto-connects next launch. (Replaces ZXP/`install-plugin` friction. Use the NEW bundle id. **Mandatory for v1** — non-technical users can't run install scripts.)
- [ ] **Connection state UX** — "connected / open AE / reconnecting"; handle AE-not-running, bridge-not-installed, port-in-use.
- [x] **Env-switchable backend** — config to point at `localhost` vs the prod proxy (the Phase-5 proxy the shipped app points at). ✅ WT-FE-FOUNDATION (`CUBIC_ENV=local|prod` in `app/src/main/config.ts`, forwarded to the spawned child; switches where the *agent loop* sends Claude calls — `local`=Anthropic direct, `prod`=forward `ANTHROPIC_BASE_URL` to the proxy. `prod` is an inert stub until the Phase-5 proxy exists).

## §C. Chat UI on the `agentEvent` protocol
- [ ] **Chat UI** — renderer consuming `agentEvent` (streaming per-iteration display + message history); prereq for §D/§E.
    - [ ] **Render compaction/context events** (backend done Phase 2) — `compaction` (start/done/failed) = subtle "compacting…" indicator, NOT an error; `context_full` = friendly "this chat is too long — start a new one" CTA. **Load-bearing:** this is the UI half of the context-window safety net.
    - [ ] **Manual E2E compaction test** (deferred from Phase 2; logic is unit-tested) — `/clear` empties; `/compact` collapses old turns to `<conversation_summary>`; auto-compaction fires at turn boundary (lower `compactThreshold`/`contextWindowOverride` deps to trigger) without losing recent context; hard ceiling → `context_full` pause. Run with `CUBIC_LLM_DEBUG=1`.
    - [ ] **Markdown rendering** — `react-markdown` + `remark-gfm`, raw HTML disabled. Monospace code/expression blocks. (Consumer table-stakes — raw markdown looks broken.)
    - [ ] **Friendly transient-error rendering** — the `error` event carries raw SDK text (e.g. `529 overloaded_error`); render "Claude's busy — try again," not the raw string. (Consumer table-stakes.)
    - [ ] **Re-attach on reload (renderer half; → [NOTES](./NOTES-phase4.md#d0))** — on (re)connect send `{type:'attach', sessionId}`, feed the returned buffered `events` through the reducer, set spinner/Stop from `running`. `sessionId` is renderer-minted (uuid on "New chat") + persisted; on reload recover it from storage → §C2 most-recent → fresh chat.
- [ ] **Command surface — consumer-chat feel, NO terminal idioms** (users are video editors):
    - Primary actions = buttons/icons: New chat (+), send, Stop (button leads; wiring in §D).
    - Per-conversation actions (delete) = row kebab (⋯) / right-click.
    - No user-facing slash commands: `/clear` → "New chat" button; `/compact` not surfaced (auto-fires). Backend `/clear`+`/compact` parse stays as a hidden dev escape hatch only.
    - Any other commands → UI interaction.
- [ ] **Good UX** — spinner + nice progress words, Claude-style. (Consumer feel.)
- [ ] **Instrument event seams** — drop no-op `track(...)` calls at natural points (turn start/end, tool runs, cancels, restores, errors) behind a swappable wrapper. No vendor yet.

## §C2. Conversation history + persistence (backend-first)
> Backend owns canonical `Session.messages` but never persists today — quit = gone. Mirror CC's per-project transcripts. **v1 = full list + resume, minus the frills** (no auto-titles, no retention, no rename).
> **Backend DONE (worktree ③):** all 8 bullets below shipped — `ae-bridge/src/persist.ts` (store) + `reattach.ts` (fan-out/buffer) + `agentChat.ts` wiring, fed by a new `onCommit` hook in the loop. Append-only full history (compaction trims model context only, never disk → CC-style scrollback survives reopen). Unit-tested (persist round-trip/index/rekey/delete + fan-out/buffer + attach/delete-refuse). The renderer halves (sidebar list, delete kebab, re-attach renderer side) remain → §C / ⑤·⑥.
- [x] **Backend JSONL store** _(backend-first)_ — one `.jsonl` per conversation (`~/.cubic/sessions/<encoded-project>/<id>.jsonl`) + global `index.json` (id, title, project path, last-activity, `renamed`). In the backend (owns canonical `Message[]`), not the renderer (lossy `agentEvent` view can't resume faithfully).
- [x] **Append per turn (crash-safe)** — append at the turn boundary (via the loop's `onCommit` hook); crash loses at most the in-flight turn. Reload = read `.jsonl` back into a `Session`.
- [x] **Reload + continue (resume)** — lazily rehydrate full `Message[]` into a live `Session` on the first message for an id; live AE state re-fetched fresh next turn.
- [x] **Re-attach backend (in-flight turn)** _(→ [NOTES](./NOTES-phase4.md#d0))_ — `emit` fan-out `Map<sessionId, Set<ws>>` + live-turn `agentEvent` buffer cleared **after** the per-turn JSONL append above + `attach`/`attached` wire. Lets a reloaded renderer rejoin a still-running turn (resume handles committed turns; this handles the live one). Renderer half = §C.
- [x] **Per-project conversation list** — keyed by `getProjectInfo().path` (AE is single-document → always exactly one current project).
- [x] **Unsaved-project handling** — `path:""` → `_untitled` bucket; after save, lazily re-key the active conversation to the real path (rides on the per-turn `getProjectInfo`; no AE save-event hook).
- [x] **Instant placeholder titles** — truncated first user message, stored in `index.json`. _(No Haiku auto-title in v1 — deferred.)_
- [x] **Manual delete** — `delete` ChatInbound (refuses mid-turn); the row dropdown **UI** is ⑤.

## §D. Agent-run controls (pure UI wiring; backend hooks done Phase 2)
- [ ] **Stop / cancel button** → sends `{type:'cancel'}` (stops at next boundary). Esc maps to it. _(Queue/steer/edit-queue UI deferred — backend already supports it.)_

## §E. Seamless backup recovery (restore handler is backend-first)
> Pre-turn `.aep` snapshot to `.cubic-backups/` (rolling last-10) already exists; recovery is currently manual (dig in Finder).
- [x] **Restore handler** _(backend-first — both the button and the agent command depend on it)_ — new bridge command: copy a chosen `.cubic-backups/` file back over the working file + reopen project.
- [ ] **"Restore to before this request" button** — list recent snapshots (timestamp + turn summary), restore the chosen one, with a **confirm-before-overwrite** guard.
- [x] **Agent-driven restore** — "Cubic, undo that / revert the last change" → the model maps to the restore handler above.
- [x] **⚠️ GRILL FIRST — pre-turn snapshot save popup.** `backupProject` (`project.jsx:58`) calls `project.save()` before copying the `.aep`, which fires AE's native save-progress window **every turn** (a ~0.5s centered loading popup — confirmed annoying in live use). AE has no silent-save flag, so the lever is whether/how often we `save()`. Options to grill: (a) drop the pre-copy `save()` and copy the on-disk `.aep` as-is — no popup, but the backup misses *unsaved manual edits* since the last Cmd+S; (b) save only when the project is dirty / once per session; (c) keep as-is (correctness over annoyance). Touches `project.jsx` (+ maybe `snapshot.ts`) — both ④'s files, so it belongs here. _Modifies the existing Phase-2 snapshot._

---

## Already done (Phase 2 backend — no Phase 4 work)
Context-window management + auto-compaction · `/clear` `/compact` · pre-turn `.aep` snapshots · `cancel`/`queue`/`editQueue`/`removeQueue` hooks + `pendingMessages` FIFO · self-healing loop (catches *destructive* drift via structured error codes).
