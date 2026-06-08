# Phase 4 — Standalone Electron app + thin AE bridge

## Decisions & context
> Reference, not todos — condensed so they're scannable. Candidates to move to a separate doc later; kept here for now so they're visible while building.

**Resolved decisions**
- **Standalone Electron desktop app, not an in-AE panel.** CEP extension stays but is demoted to a thin, headless `evalScript` bridge (no UI). We're ~95% decoupled already — the agent loop/LLM/sessions/compaction run in Node and reach AE as a WS client of `127.0.0.1:17923`; the `{id,command,args}` ↔ `{id,ok,result}` protocol is the real, stable interface. Electron is the post-Phase-5 home for the Node backend, gives a modern-Chromium streaming UX, and native FS for the backup viewer. Strategic: one UI, swap the bridge adapter per host later (Premiere = CEP near-free; DaVinci = Python/Lua WS; FCP = unlikely).
- **Pure auto-run for MVP.** Tool calls execute immediately — no accept/reject, no plan step. Safe: every command is ⌘Z-able + pre-turn `.aep` backup; users are video editors, not coders. _Post-MVP:_ plan mode + accept-edits-one-at-a-time like Claude Code.
- **Sequencing rule: backend before UI.** Build + test the backend half before its UI. Backend-first items: **C2** (JSONL store), **§E** (restore handler). Only **§D** is pure UI wiring.

**Stack notes**
- **Electron over Swift** — backend is TS/Node; Electron reuses it + shares types. Native-feel (vibrancy/traffic-lights/native menus) is good enough; render perf isn't the bottleneck.
- **Signing/notarization + auto-update → ~Phase 5.** `electron-builder` sign+notarize (Apple Dev, $99/yr) + `electron-updater` staged rollouts. Run unsigned locally until then.
- **Analytics → later.** Instrument event seams now behind a swappable wrapper; pick the vendor + per-install `distinct_id` + flags in a later pass.

---

## §0. Decide first — gates the UI
- [ ] **Renderer ↔ backend transport (OPEN — decide before §B).** How the renderer reaches the spawned Node backend:
    - **(a) Direct WebSocket** to `127.0.0.1:17923` — simplest, reuses the existing protocol verbatim (same as the CEP bridge + `cubic-ai` client).
    - **(b) Electron IPC** via the main process — main relays to/from the backend; port stays private to main.
    - Either way, the answer **must define how the UI re-attaches to an in-flight turn by `sessionId`** on renderer reload — the `agentEvent` view is lossy and can't rebuild mid-turn state alone.

---

## §A. Split CEP panel → headless AE bridge (foundation)
- [ ] **Demote `cep-extension/` to a headless bridge** — strip the status/port UI to bare WS-client + `evalScript` dispatch (Role B only). Runs invisibly, auto-connects on AE launch. No chat, no logic.
- [ ] **Fix headless port discovery (latent bug).** Bridge binds `17923` (fallback scan → `17927`) and writes the chosen port to `~/.ae-mcp-bridge/port`, but the panel never reads it — it uses the manual port box (default `17923`). Once the UI is stripped, a fallback port silently fails to connect. **Fix:** bridge reads `~/.ae-mcp-bridge/port` on connect **+ re-reads on reconnect**. (Alt: drop the fallback scan, hard-fail on a `17923` conflict.)
- [ ] **Lock the wire protocol contract** — `{id,command,args}` ↔ `{id,ok,result}` + `userChat`/`queue`/`cancel`/`agentEvent`. Document once; future host adapters depend only on this.
- [ ] **Backend lives in Electron main** — main spawns `server/ae-bridge` (bridge + agent loop) as a child. Confirm it still opens `127.0.0.1:17923` and the headless extension connects as the worker client as today.

## §B. Electron app shell + auto-provisioning
- [ ] **FIRST — `mcp` → `bridge` naming pass + final-name audit** ⚠️ hard gate before ship; do it while building the install flow so the install path is written with final names:
    - `server/ai/src/mcp/` → `src/bridge/`, `McpClient` → `BridgeClient` (~5 imports + the `vi.mock('../mcp/client.js')` mock).
    - `mcp-bridge.jsx` → `bridge.jsx` (update `domainFiles` in `scripts/build-cep-extension.mjs`, the "handlers must not live in mcp-bridge.jsx" rule, doc refs in `server/ae-bridge/CLAUDE.md`).
    - Bundle id `com.cubic.ae-mcp-bridge` → `com.cubic.ae-bridge` (`cep-extension/CSXS/manifest.xml` + install path). Forces a one-time reinstall — fine, install flow is being rebuilt here.
    - Audit final package names (`cubic-ae-bridge`, `cubic-ai`, anything user-facing) before ship.
    - Keep `mcp` ONLY on the real MCP entrypoint (`src/index.ts` + `.mcp.json` + `@modelcontextprotocol/sdk` dev dep).
- [ ] **App shell** — new `app/` dir: Electron main + React renderer, native window (vibrancy/traffic-lights), menus, single-instance.
- [ ] **Auto-install the AE bridge** — on first run / "Connect to After Effects", write the headless bridge into `~/Library/Application Support/Adobe/CEP/extensions/com.cubic.ae-bridge/` + enable PlayerDebugMode. One app install → provisions the bridge → AE auto-connects next launch. (Replaces ZXP/`install-plugin` friction. Use the NEW bundle id.)
- [ ] **Connection state UX** — "connected / open AE / reconnecting"; handle AE-not-running, bridge-not-installed, port-in-use.
- [ ] **Env-switchable backend** — config to point at `localhost` vs prod proxy (needed once Phase 5's proxy exists).

## §C. Chat UI on the `agentEvent` protocol
- [ ] **Chat UI** — renderer consuming `agentEvent` (streaming display + message history); prereq for §D/§E. Optional: token-level streaming.
    - [ ] **Render compaction/context events** (backend done Phase 2) — `compaction` (start/done/failed) = subtle "compacting…" indicator, NOT an error; `context_full` = friendly "this chat is too long — start a new one" CTA. Optional: context-usage meter (`Session.lastContextTokens` vs model `contextWindow`).
    - [ ] **Manual E2E compaction test** (deferred from Phase 2; logic is unit-tested) — `/clear` empties; `/compact` collapses old turns to `<conversation_summary>`; auto-compaction fires at turn boundary (lower `compactThreshold`/`contextWindowOverride` deps to trigger) without losing recent context; hard ceiling → `context_full` pause. Run with `CUBIC_LLM_DEBUG=1`.
    - [ ] **Markdown rendering** — `react-markdown` + `remark-gfm`, raw HTML disabled. Monospace code/expression blocks; syntax highlighting is a later add. Streams fine incrementally.
    - [ ] **Friendly transient-error rendering** — the `error` event carries raw SDK text (e.g. `529 overloaded_error`); render "Claude's busy — try again," not the raw string. (Backend resilience → Post-launch.)
- [ ] **Command surface — consumer-chat feel, NO terminal idioms** (users are video editors):
    - Primary actions = buttons/icons: New chat (+), send, Stop (Esc maps to it, button leads).
    - Per-conversation actions (rename/delete) = row kebab (⋯) / right-click.
    - No user-facing slash commands: `/clear` → "New chat" button; `/compact` not surfaced (auto-fires). Backend `/clear`+`/compact` parse in `agentChat.ts` stays as a hidden dev escape hatch only.
    - Any other commands → UI interaction.
- [ ] **Good UX** — spinner + nice progress words, Claude-style.
- [ ] **Instrument events as you build** — turn start/end, tool runs, cancels, restores, errors, behind the swappable wrapper. No vendor yet.

## §C2. Conversation history + persistence (CC-style, per-project)
> Backend owns canonical `Session.messages` but never persists today — quit = gone. Mirror CC's per-project transcripts.
- [ ] **Per-project conversation list** — keyed by `getProjectInfo().path` (AE is single-document → always exactly one current project).
- [ ] **Unsaved-project handling** — `path:""` → "Untitled Project" bucket; after save, lazily re-key the active conversation to the real path (rides on the per-turn `getProjectInfo`; no AE save-event hook).
- [ ] **Backend JSONL store** _(backend-first)_ — one `.jsonl` per conversation (`~/.cubic/sessions/<project>/<id>.jsonl`) + `index.json` (id, title, project path, last-activity, `renamed`). In the backend (owns canonical `Message[]`), not the renderer (lossy `agentEvent` view can't resume faithfully).
- [ ] **Append per turn (crash-safe)** — append at the turn boundary; crash loses at most the in-flight turn. Reload = read `.jsonl` back into a `Session`.
- [ ] **Reload + continue (resume)** — rehydrate full `Message[]` into a live `Session`; live AE state re-fetched fresh next turn.
- [ ] **Retention** — auto-delete ~30d since last activity (one knob = CC's `cleanupPeriodDays`) + manual delete (row dropdown).
- [ ] **Titles** — instant truncated first-message placeholder → after turn 1, a `claude-haiku-4-5` call via `getLLM()` generates a clean title into `index.json`. Once, not per turn.
- [ ] **Manual rename** — overrides the auto-title, sets `renamed` so Haiku won't clobber it.

## §D. Agent-run controls (pure UI wiring; backend hooks done Phase 2)
- [ ] Esc / cancel button → `{type:'cancel'}` (stops at next boundary).
- [ ] Type-while-running → `{type:'queue', id, text}` (injected at next tool boundary / as a follow-up turn).
- [ ] Show queued/steering messages + edit/remove before they fire → `editQueue`/`removeQueue` by `id`; mark a row "sent" when its `steer` event (carrying that `id`) arrives.

## §E. Seamless backup recovery
> Pre-turn `.aep` snapshot to `.cubic-backups/` (rolling last-10) exists; recovery is currently manual (dig in Finder).
- [ ] ⚠️ **"Restore to before this request" button** — list recent snapshots (timestamp/summary), restore the chosen one over the working file + reopen.
- [ ] **Agent-driven restore** _(backend-first — handler must exist before the button above)_ — "Cubic, undo that / revert the last change" → restore handler (new bridge command: copy a chosen `.cubic-backups/` file back + reopen project).
- [ ] **Confirm-before-overwrite** — restoring replaces current working state; guard it.
- [ ] Undo-history viewer + dedicated keybind?

---

## Post-launch / backlog (not blocking Phase 4 ship)
- [ ] **§F — transient API-error resilience (backend).** SDK auto-retries transient 429/529/network; quick win: `new Anthropic({ apiKey, maxRetries: 4 })`. Remaining: a mid-turn failure (dies iter 6/10 after already changing the project) abandons the whole turn → auto-retry the failed iteration so the turn resumes instead of restarting.
- [ ] **Mid-turn state-staleness guard** ("modified since read"). Destructive drift is already caught (stale-target tool call → `LAYER_NOT_FOUND` → self-heal re-reads); silent drift (user nudges a layer mid-turn) is not. AE has no free revision counter → capture a cheap project-state **fingerprint** at turn start, re-check before each *mutating* tool call, mismatch → emit `STATE_STALE` into the self-heal path → model re-reads fresh.
- [ ] **Motion-quality judgement call** (deferred from Phase 2). Once the UI exists, drive real prompts + watch output. Decide if the model's "juicy" motion understanding needs improving (recipes + system prompt may already suffice). If yes: tune recipe defaults / adjective→recipe mapping / composite recipes / visual feedback loop — NOT a preset library.
- [ ] **Let the AI view generated video** (not images) — likely via Gemini's video capability.
