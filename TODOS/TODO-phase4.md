# Phase 4 — Standalone Electron app + thin AE bridge (v1 / MVP scope)

> **Scope:** this file is **strictly the v1 MVP build** — the leanest app that's *paid-public-ready*: won't break a paying stranger's project, won't look broken to a non-technical video editor. Deferred / post-MVP items live in **`TODO-phase4-later.md`** (each tagged with the §section it came from).
> **The wall:** Phase 5 (hosted proxy holding the API key + Stripe billing + obfuscation + auto-update) is a **hard gate before any paying customer** — not in this file. This trim shortens the road *to* that wall; it doesn't remove it.

> **Decisions & rationale live in [`NOTES-phase4.md`](./NOTES-phase4.md)** — this file is the checklist only. Items link there by anchor when the "why" matters.

---

## §0. Renderer ↔ backend transport — ✅ DECIDED (gates §B/§C) → [NOTES](./NOTES-phase4.md#d0)
- [x] **Direct WebSocket** + one `getBackendPort()` IPC for port discovery. (Rejected: IPC relay.) Re-attach-by-`sessionId` also decided → **built** under §C2 (backend half) + §C (renderer half).

---

## §A. Split CEP panel → headless AE bridge (foundation)
- [x] **Demote `cep-extension/` to a headless bridge** — strip the status/port UI to bare WS-client + `evalScript` dispatch (Role B only). Runs invisibly, auto-connects on AE launch. No chat, no logic.
- [x] **Fix headless port discovery (latent bug).** Bridge binds `17923` (fallback scan → `17927`) and writes the chosen port to `~/.ae-mcp-bridge/port`, but the panel never reads it — it uses the manual port box (default `17923`). Once the UI is stripped, a fallback port silently fails to connect. **Fix:** bridge reads `~/.ae-mcp-bridge/port` on connect **+ re-reads on reconnect**. (Alt: drop the fallback scan, hard-fail on a `17923` conflict.)
- [x] **Lock the wire protocol contract** — `{id,command,args}` ↔ `{id,ok,result}` + `userChat`/`queue`/`cancel`/`agentEvent`. Document once; future host adapters depend only on this.
- [x] **Backend lives in Electron main** — main spawns `server/ae-bridge` (bridge + agent loop) as a child. Confirm it still opens `127.0.0.1:17923` and the headless extension connects as the worker client as today.

## §B. Electron app shell + auto-provisioning
- [ ] **FIRST — `mcp` → `bridge` naming pass + whole-codebase name audit** ⚠️ hard gate before ship; do it while building the install flow so the install path is written with final names:
    - `server/ai/src/mcp/` → `src/bridge/`, `McpClient` → `BridgeClient` (~5 imports + the `vi.mock('../mcp/client.js')` mock).
    - `mcp-bridge.jsx` → `bridge.jsx` (update `domainFiles` in `scripts/build-cep-extension.mjs`, the "handlers must not live in mcp-bridge.jsx" rule, doc refs in `server/ae-bridge/CLAUDE.md`).
    - Bundle id `com.cubic.ae-mcp-bridge` → `com.cubic.ae-bridge` (`cep-extension/CSXS/manifest.xml` + install path). Forces a one-time reinstall — fine, install flow is being rebuilt here.
    - Keep `mcp` ONLY on the real MCP entrypoint (`src/index.ts` + `.mcp.json` + `@modelcontextprotocol/sdk` dev dep).
    - **Then broaden to a whole-codebase audit** — beyond `mcp`→`bridge`, confirm every module/package/identifier is named for its actual scope (`cubic-ae-bridge`, `cubic-ai`, anything user-facing) and is easy to maintain before ship.
- [ ] **App shell** — new `app/` dir: Electron main + React renderer, native window (vibrancy/traffic-lights), menus, single-instance.
- [ ] **Auto-install the AE bridge** — on first run / "Connect to After Effects", write the headless bridge into `~/Library/Application Support/Adobe/CEP/extensions/com.cubic.ae-bridge/` + enable PlayerDebugMode. One app install → provisions the bridge → AE auto-connects next launch. (Replaces ZXP/`install-plugin` friction. Use the NEW bundle id. **Mandatory for v1** — non-technical users can't run install scripts.)
- [ ] **Connection state UX** — "connected / open AE / reconnecting"; handle AE-not-running, bridge-not-installed, port-in-use.
- [ ] **Env-switchable backend** — config to point at `localhost` vs the prod proxy (the Phase-5 proxy the shipped app points at).

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
- [ ] **Backend JSONL store** _(backend-first)_ — one `.jsonl` per conversation (`~/.cubic/sessions/<project>/<id>.jsonl`) + `index.json` (id, title, project path, last-activity, `renamed`). In the backend (owns canonical `Message[]`), not the renderer (lossy `agentEvent` view can't resume faithfully).
- [ ] **Append per turn (crash-safe)** — append at the turn boundary; crash loses at most the in-flight turn. Reload = read `.jsonl` back into a `Session`.
- [ ] **Reload + continue (resume)** — rehydrate full `Message[]` into a live `Session`; live AE state re-fetched fresh next turn.
- [ ] **Re-attach backend (in-flight turn)** _(→ [NOTES](./NOTES-phase4.md#d0))_ — `emit` fan-out `Map<sessionId, Set<ws>>` + live-turn `agentEvent` buffer cleared **after** the per-turn JSONL append above + `attach`/`attached` wire. Lets a reloaded renderer rejoin a still-running turn (resume handles committed turns; this handles the live one). Renderer half = §C.
- [ ] **Per-project conversation list** — keyed by `getProjectInfo().path` (AE is single-document → always exactly one current project).
- [ ] **Unsaved-project handling** — `path:""` → "Untitled Project" bucket; after save, lazily re-key the active conversation to the real path (rides on the per-turn `getProjectInfo`; no AE save-event hook).
- [ ] **Instant placeholder titles** — truncated first user message, shown immediately (zero latency, no blank rows). _(No Haiku auto-title in v1 — deferred.)_
- [ ] **Manual delete** — row dropdown → delete a conversation anytime.

## §D. Agent-run controls (pure UI wiring; backend hooks done Phase 2)
- [ ] **Stop / cancel button** → sends `{type:'cancel'}` (stops at next boundary). Esc maps to it. _(Queue/steer/edit-queue UI deferred — backend already supports it.)_

## §E. Seamless backup recovery (restore handler is backend-first)
> Pre-turn `.aep` snapshot to `.cubic-backups/` (rolling last-10) already exists; recovery is currently manual (dig in Finder).
- [ ] **Restore handler** _(backend-first — both the button and the agent command depend on it)_ — new bridge command: copy a chosen `.cubic-backups/` file back over the working file + reopen project.
- [ ] **"Restore to before this request" button** — list recent snapshots (timestamp + turn summary), restore the chosen one, with a **confirm-before-overwrite** guard.
- [ ] **Agent-driven restore** — "Cubic, undo that / revert the last change" → the model maps to the restore handler above.

---

## Already done (Phase 2 backend — no Phase 4 work)
Context-window management + auto-compaction · `/clear` `/compact` · pre-turn `.aep` snapshots · `cancel`/`queue`/`editQueue`/`removeQueue` hooks + `pendingMessages` FIFO · self-healing loop (catches *destructive* drift via structured error codes).
