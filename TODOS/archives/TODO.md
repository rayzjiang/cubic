## General Roadmap
- ✅ Phase 1 — MCP validation
- ✅ Phase 1.5 — Fix the MCP + finish all functionality I need + organize CRUD per operation + comprehensive testing suite
- ✅ Phase 2 — LLM brain + agent architecture (system prompt + Claude API backend) **and** the agent loop / self-healing loop (item 4): tool-execution loop, self-heal on errors, pre-turn backup snapshot, live narration, cancel/steer. Built + unit-tested
   ↳ No separate Phase 3 — what I'd loosely planned as "Phase 3" (the self-healing/correcting loop) was absorbed here as Phase 2 item 4.
- ✅ (basically, some stuff deferred+unverified) Phase 4 — **Standalone Electron desktop app** (chat UI) + **thin headless AE bridge** (the CEP extension demoted to `evalScript` dispatch only). The app consumes the agentEvent protocol, hosts the Node backend as a child process, auto-installs the AE bridge on first run, + seamless backup recovery (restore button + "Cubic, undo that"). Decision recorded in TODO-phase4.md — NOT an in-AE panel anymore.
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
- [x] **Bug FIXED (6/13/26) — "undo that" no-op.** No-args `restoreProject` now lands on the most-recent
  backup whose bytes differ from the working `.aep` (skips the own-turn snapshot), prunes newer backups
  (one-way, no redo), and returns `status:"noop"` at the floor. Self-contained in `project.jsx`.
- [x] **Bug FIXED (6/13/26) — undo leaks across chats.** Backups had no chat identity, so undo dug
  into previous chats' backups. Fixed (per Claude Code's per-session rewind): scoped to current chat via
  per-session subfolder `.cubic-backups/<sessionId>/` (`_sessionBackupDir` in `project.jsx`); `session.id`
  threaded → `backupProject` (`snapshot.ts`/`loop.ts`) + injected into `restoreProject` server-side
  (`executeTool.ts`); keep 10/chat (prune in `project.jsx`); folder deleted on conversation-delete AND
  `/clear` (`deleteSessionBackups` in `persist.ts`, called from `agentChat.ts`).
- [x] **BUG (6/16/26) - on new chat start, the sidebar isnt showing a loading animation/displaying the new chat in the sidebar, unless u go back to home and click the new chat**
- _→ moved to [`POSTMVP.md`](POSTMVP.md) (Rewind / restore): undo depth capped ~10 turns/chat._
- [x] **FIXED (6/13/26) — tool-row "noop" state.** Row used to say "Restored a backup" (success check)
  even when nothing was undone (label computed from intent at `tool_start`; `tool_end` only had `ok`/`fail`,
  so a `status:"noop"` result rendered as success). Added a neutral `noop` outcome end-to-end: `executeTool`
  detects `status:"noop"` (skips cache invalidation) -> `tool_end.noop` + label override; `displayItems`
  reads it from the persisted `tool_result` (history); `ToolActionRow`/`store.ts` render it muted (dash
  icon, no green check, "Nothing to undo"). Mechanism is generic; `restoreProject` is wired as the only
  current producer. Files: `ai/src/agent/{events,loop,executeTool}.ts`, `ae-bridge/src/displayItems.ts`,
  `app/src/renderer/src/{protocol,store}.ts` + `components/ToolActionRow.tsx`.
- [x] **DONE — audit other handlers for real noop conditions** and have them return `status:"noop"`
  (each gets the muted row for free). Shipped the clean single-value + nothing-to-remove noops:
  `setLayerProperty`, `setEffectProperty`, `setShapeOperatorProperty`, `setTextAnimatorProperty`,
  `setLayerKeyframe`, `setLayerExpression`, `setCurrentTime`, `setSelectedLayers`, `moveLayer`,
  `setLayerParent`, `setAnchorPoint`, `centerAnchorPoint`, `trimLayer`, `alignLayers`, `sequenceLayers`,
  `setTimeRemapEnabled`, `setTrackMatte`, `removePropertyKeyframes`, `removeMarker` (all + 0),
  `deleteUnusedSolids` (+ M1: wrapped in try/catch), `saveProject` (clean), `batch` (empty / all-sub-noop).
  Shared `_valuesEqual()` helper (float tolerance + array deep-compare) added in `bridge.jsx`; per-command
  labels in `events.ts` `NOOP_SCRIPT_LABELS`. Principle: already-satisfied = noop, missing named target =
  error (deletes already do this). Verify noop renders muted across rows (unit tests + live spot-check).
- _→ moved to [`POSTMVP.md`](POSTMVP.md) (Test-truth & handler correctness): diff-aware multi-field setters (J2)._
- _→ moved to [`POSTMVP.md`](POSTMVP.md) (Test-truth & handler correctness): handler judgment-call fixes J3–J10._

### Wave 2 — frontend chain (after ② merged; DO SEQUENTIALLY — all share `app/`)
**⑤ WT-CHAT-UI** — the chat surface on `agentEvent`. Needs ② merged; sidebar needs ③ merged. ✅ DONE (branch `feat/wt-chat-ui`).
- [x] §C — Chat UI (agentEvent reducer + message history) — Zustand store `foldEvent` reducer; one `DisplayItem[]` display-model shared by live events + loaded history; Cursor-style transcript (boxed prompt, full-width assistant text, compact per-action tool rows w/ status icons).
- [x] §C — Render compaction/context events — "Summarizing earlier steps…" pill + friendly `context_full` "start a new chat" CTA card.
- [x] **§C — View compaction summary — CODE BUILT + UNIT-TESTED, in-app UI NOT yet verified** (pre-Phase-5 gate — see TODO-phase4.md §C). On a successful compaction, leave a collapsible "Summarized earlier steps · View summary" divider in the transcript at the cut point; expanding shows the AI's `<conversation_summary>` rendered as Markdown (reuse `AssistantMessage`). **Now Claude-Code-style PERSISTED** (changed from the old live-only design): a `_compaction` marker line (summary + `keptTurns`) is appended to the JSONL at the boundary, so on reopen the model **resumes from the summarized form** (`loadSession` reconstruction — never re-summarizes already-summarized history) and the divider + viewable summary survive a reload (`loadDisplayMessages` → `messagesToDisplayItems`). Full scrollback is kept (older turns still visible above the divider). Plumbed via `compaction:done` (now carries `keptTurns`) → store reducer (cut-point insert) + the persisted marker path. Failed/no-op compactions stay **silent** (no marker). Restoring past a boundary un-compacts naturally. **Still pending: manual E2E in the real app** (live compaction → close/reopen → confirm no re-summarize → restore across a boundary).
- [x] §C — Friendly transient-error rendering — mapped plain-English message + "Try again" (resend) + raw "Details" expander; delete-refusal surfaces as a toast.
- [x] §C — Command surface (buttons/icons, no slash commands) — New chat + per-row delete kebab; `/clear`,`/compact` stay backend-only.
- [x] §C — Good UX (spinner + progress words) — motion-themed gerunds cycled in reasoning gaps; per-tool spinners; loading splash; delete confirm modal + toasts.
- [x] §C — Instrument event seams (no-op `track(...)`) — `message_sent`/`turn_done`/`turn_error`/`conversation_deleted`/`new_chat`.
- [x] §C — TESTED W API for COMPACTION - Manual E2E compaction test (deferred from Phase 2) — drive a real chat to ≥90% ctx → "Tidying up…" pill; push to ≥97% → `context_full` card).
- [x] §C2 (UI) — Conversation-list sidebar (collapsible, animated) + delete kebab + Home landing view.
- ↳ §C "Re-attach on reload (renderer half)" is **NOT here** — it's in ⑥.
- [x] optimize conversation-list loading — **decoupled from AE** (the list is local `index.json` data, so it loads instantly like Claude Code, no wait). `sendConversations` uses the real project path when the worker's connected, else `lastActiveProjectPath()` (most-recent conversation's project) as the guess; the bridge 'connect' push re-sends the authoritative list, which only changes anything on a project switch. Root cause was the old `waitForWorker` coupling the list to the CEP panel's exponential reconnect backoff (1s→10s).
- ↳ **Backend footprint (⑤ wasn't frontend-only):** new `list`→`conversations` + `loadHistory`→`history` wire (`wsBridge.ts`/`agentChat.ts`/`PROTOCOL.md`); `displayItems.ts` (Message[]→DisplayItem transform); friendly `describeToolCall` labels (`cubic-ai/events.ts`); `.env` loading at backend boot (`startBackend.ts`); public `bridge.waitForWorker`.

**⑥ WT-CONTROLS** — run controls + the renderer halves that need ⑤'s reducer. Needs ⑤ + ③'s wire + ④'s handler.
- [x] §D — Stop/cancel button (+ Esc) → `{type:'cancel'}`
- [x] §C — Re-attach on reload (renderer half): on (re)connect send `{type:'attach',sessionId}`, feed buffered `events` through the reducer
- [x] §E — "Restore to before this request" button (snapshot list + confirm-before-overwrite)
  - [x] **addressed, deferred to post mvp, simple claude code like rewind everything (including manual changes) for now - BUG (6/16/26) - If someone modifies something in a different piece, the rewind will rewind the ENTIRE project state instead of only the changes that the ai made.. grill to determine if theres a better way to do the backups or if i should js ship mvp v1 like this?**
  - [x] ADDRESSED bc its self healing already basically, switched to be new conversation temp name- not urgent BUG (6/16/26) - if a chat is fully restored (even original message), the title of the chat is still off..
- [x] add a send button to the ui
- [x] add a ae panel connectivity status on all pages of the ui (gotta decide where to put it, i think simple colored status dot + brief word is good)
- [x] in the same area where you can delete a message, add a new option to rename the chat

**⑦ WT-CONNECT** — provisioning + connection. Needs ② merged. (Plan + grilled 6/16/26. The two ⑥
leftovers above — status dot + rename chat — shipped already, so ⑦ = just §B2/§B5/§B6.)
- [x] §B2 (deferred rename — **do FIRST in this worktree**): bundle id `com.cubic.ae-mcp-bridge`→`com.cubic.ae-bridge`; CEP panel display name "MCP Bridge"→**"Cubic"** in `manifest.xml`; port file `~/.ae-mcp-bridge/port`→**`~/.cubic/port`** (consolidate all Cubic state in one dir; change writer `wsBridge.ts` + reader `server/ai/src/bridge/client.ts` **together**). Installer best-effort deletes the OLD bundle dir + old `~/.ae-mcp-bridge` (clean break — nothing shipped, so no migration code). DONE 6/16/26 (`installBridge.ts` `cleanupLegacy`; also synced `install-cep-extension.js` + stray strings in `index.ts`/`config.ts`).
- [x] §B5 — Auto-install the AE bridge: runs in **Electron main, idempotently on every launch**, new file `app/src/main/installBridge.ts`. **Content-hash gate** — hash only the load-bearing files (`handlers.bundled.jsx` + `manifest.xml` + `src/main.js`; ignore `.debug`/mtimes), copy into the CEP dir under the new bundle id only when the hash differs, set PlayerDebugMode (CSXS 11/12). A copy is the one signal that drives the "restart AE" hint. **Never throws** (returns `failed`) → an install problem degrades AE connectivity only, never blocks app launch. Reuses `install-cep-extension.js` `copyDir`/PlayerDebugMode logic + `backend.ts:resolveBackendEntry` dev/packaged seam (packaging stays Phase 5). DONE 6/16/26 (`provisionBridge()` wired into `index.ts` `whenReady`).
- [x] §B6 — Connection-state UX. DONE 6/16/26. **State-source split (architectural crux):** during a backend crash the renderer's own WS is down, so AE state (`aeConnected`) travels over the **backend WS** (existing `aeStatus`, trusted only while `connection==='open'`), but backend-link state must come from **main via IPC push** — new `BackendStatus { phase, install }` over `app/src/main` → preload, `phase: starting|running|reconnecting|port-in-use|stopped`, `install: ok|updated|failed`; pushed on change + a `getBackendStatus()` invoke for late/reloaded renderers. `AeStatus.tsx` becomes a **precedence resolver** (blocking main states → reconnecting → backend-WS states → connecting); all states surface via the existing dot + richer native hover tooltip (no popover/buttons; whole dot+text group triggers it). **restart-AE** is computed renderer-side (grace timer, only when `connection==='open' && !aeConnected` after a fresh/updated install; clears the instant AE connects) so main stays ignorant of AE state.
  - **Port-in-use:** backend `bind` EADDRINUSE → `BridgeError('PORT_IN_USE')` → `serve.ts` exits with **distinct code 17** (`EXIT_PORT_IN_USE` in `startBackend.ts`); main maps 17 → blocking "another copy of Cubic is running" (NO restart — would re-collide). True root fix = hardening **#2 dynamic free port**, still deferred.
  - **Backend crash:** `BackendSupervisor` does **bounded auto-restart** (3 tries, backoff `[400,1000,2000]`, counter reset after a 3s "settled" window) → renderer shows "Reconnecting…" + keeps retrying its WS (change `ws.ts` from one-shot to infinite bounded-backoff) → on reconnect the §C reattach path rejoins the in-flight turn; after exhaustion → blocking "Cubic stopped — reopen it".
- ↳ §B2's one-time forced reinstall is free here because the install flow is being rebuilt — that's why it rides with ⑦, not ①.

- [x] **DONE, in worktree, merged - feat to add: tool to create or rename folders in the project panel, grill + plan + implement**
- [x] **DONE (research, 6/18/26) — feat: do we have functionality/tools to trim/reorder footage?** YES — coverage is broad already:
  `trimLayer` (in/out + startTime, playhead modes), `splitLayer`, `mergeLayer`, `moveLayer` (z-order/stacking),
  `sequenceLayers` (stagger startTimes), `setTimeRemapEnabled` + `stretch` (speed), `importFootage`/`addFootageToComp`/
  `importAssetToComp` (bring clips in with startTime/duration), `duplicateLayer`. The ONE missing paradigm is NLE-style
  ripple editing — see postmvp note below. No code changes; verification item only.
- [x] DONE - resume the paralleization chat and have it modify the phase 5 parallization md to be more like todo.md (as in, make sure that all items are listed as todo items not just as a paragraph blob, and each item should correspond to the section+section item found in phase5 md, similar to how we essentially wrote super concise bullets for each item and then each item corresponds and is labeled directly with which section/item it came from in the original non parallized phase document)
- [x] **FIXED - BUG - when a new chat is switched mid message, the new chat disappears. when an existing chat is switched mid message, and then switched back, its almost as if the new message was never sent + the loading for the new message is gone, the only way to see it back is by clicking home and returning back. grill me to fix all edge cases regarding this issue/related issues**

- [x] **PRE-PHASE-5 VERIFY GATE — in-UI compaction E2E** (added 2026-06-19): the compaction UI (pill / `context_full` card / collapsible "View summary") is built but never driven live in the Electron app. **Painless test recipe** (env): `CUBIC_MODEL=haiku CUBIC_LLM_DEBUG=1 CUBIC_CONTEXT_WINDOW=16000 CUBIC_COMPACT_THRESHOLD=0.7 CUBIC_KEEP_RECENT_TURNS=1` → compaction fires after ~2 short messages and there's headroom under the 97% ceiling (avoids the false "chat's gotten long" card that a 12k window causes — see note below). Verify in-app: "Summarizing earlier steps…" pill → "Summarized earlier steps · View summary" divider renders the `<conversation_summary>` **right before the message that triggered compaction** (the moment) → close+reopen shows the divider in the same spot and the next message does NOT re-summarize. Only the backend/summary-prompt + unit-test paths are confirmed so far (`persist.test.ts`/`displayItems.test.ts`/`loop.test.ts`).
  - Note: the "chat's gotten long" `context_full` card during testing is NOT a bug — the fixed ~10.5k baseline (system prompt + catalog + live state) is untrimmable by compaction, so a tiny `CUBIC_CONTEXT_WINDOW` (e.g. 12k, where baseline is already 87%) leaves no room. Never happens at the real 200k window (baseline = 5%). Use the recipe's larger window.
  - [x] **Compaction now persisted, Claude-Code-style (done 2026-06-19):** changed from the old live-only-no-persistence design. A `_compaction` marker line (summary + `keptTurns`) is written to the JSONL at the boundary; `loadSession` reconstructs the compacted model context so reopening **resumes from the summary** (never re-summarizes), `loadDisplayMessages` keeps the full transcript so the divider + summary survive reload, and restoring past a boundary un-compacts naturally. Brain emits `keptTurns` on `compaction:done`; **divider placed at the compaction moment** (before the triggering turn — live reducer + `messagesToDisplayItems`; model still keeps recent turns verbatim, decoupled from the visual divider). `CUBIC_KEEP_RECENT_TURNS` env knob added for testing (default 3). Touch: `compaction.ts`/`events.ts`/`loop.ts`, `persist.ts`/`agentChat.ts`/`displayItems.ts`, `store.ts`/`protocol.ts`/`CompactionSummary.tsx`/`CompactionPill.tsx`. Unit-tested; in-app E2E still pending (above).

- [x] **DONE (6/20/26) — PR #10 `vidEditorSkillAudit`: video-editing tool wave. - auditing for typical video editing workflow functionality** New one-call editing handlers so the model stops hand-rolling transforms/keyframes:
  - **fitToFrame** — scale a layer to fit/fill/stretch the comp frame (anchor-aware; optional `offset` to nudge framing).
  - **retimeClip** — `speed` (uniform time-stretch; auto frame-blending on slow-mo) / `freeze` (hold one frame) / `reverse`; no manual Time Remap.
  - **adjustColor** — Lumetri-based grade: signed knob deltas (exposure/contrast/sat/temperature/tint/highlights/shadows) + curated looks (warm/cool/teal-orange/vintage/bw/high-contrast); falls back to primitive effects (Brightness-Contrast/Vibrance) + honest warnings when a knob can't apply.
  - ↳ also added **applyTransition** (cross-dissolve/fade-to-black presets) here, then **removed it in #11** as too NLE-y / redundant with solid+fade recipes.
  - **Security:** `executeTool` now refuses model calls to hidden/internal-only commands (`modelCallBlockedReason()`), including batch sub-commands (blocks reaching e.g. `saveFrameToPng`/`introspectMatchNames`).
  - Prompt: expanded `<editing_craft>` (use these tools, honor explicit duration/scale/position/framing). New **no-API** live test `editing-handlers-live.mjs` (drives the 4 handlers against real AE, reads state back, cleans up).
- [x] **DONE (6/20/26) — PR #11 `motionReqAudit`: motion-design + keyframe-pro toolkit (~12 new commands). - auditing for typical motion design workflow functionality**
  - **animateText** — one-call kinetic-type reveals (7 presets: typewriter/wordByWord/lineByLine/fadeUpByWord/cascade/wave/scaleUp); builds animator + range selector + keyframed Offset in one call; auto motion-blur on positional/scale reveals; ease-out settle. Replaces hand-wiring `addTextAnimator`+`setTextAnimatorRangeSelector`+`setLayerKeyframe`.
  - **animateShape** — write-on/draw-on via Trim Paths keyframing (no hand-keyframing).
  - **cameraMove** — one-call `pushIn`/`orbit`/`parallax` (creates a camera if missing; eased; overwrite-or-append keys).
  - **createBackground** — comp-sized bottom solid + optional Gradient Ramp + optional subtle drift.
  - **extractShapes / mergeShapes** — explode a shape layer's groups onto separate layers (shape analog of `explodeTextLayer`) / merge shape layers into the first.
  - **addNullToLayers** — parent-null control rig (`single` bbox-centered null or `perLayer`).
  - **cropComp** — autocrop comp to content bbox (+ optional padding; remaps keyframed positions).
  - **getLayerColors** — extract text/shape colors onto a "Colors" controller null (palette swatches).
  - **Keyframe pro-tools:** `cloneKeyframes` (copy/mirror keys w/ easing), `fixKeyframeTiming` (snap keys to frame grid), `sequenceKeyframes` (stagger EXISTING keys across layers; `orderType` TOP_DOWN/BOTTOM_UP/RANDOM — distinct from `sequenceLayers` which moves start times).
  - **Expressions:** 4 new loop presets (`loopOut/In("continue")`, `loopOut/In("offset")`); `copyKeyframeEasing` gains `copyValues`; `applyMotionRecipe` gains `orderType` stagger.
  - Prompt: new `<kinetic_typography>` + expanded `<motion_design_principles>`/`<visual_design>`. New **no-API** live test `motion-handlers-live.mjs`.
- [x] **DONE (6/20/26) — PR #12 `project-switch-detection`: Cubic mirrors AE's open project live.**
  - Detects real in-AE project switches (File>Open / Save-As / recovery) by reading **uncached** project info; auto-follows the new project, fires a toast ("After Effects switched to <name>"), and starts a fresh chat for it. Each `.aep` = its own conversation bucket.
  - **Guards:** defers a switch silently mid-turn; untitled-just-saved (''→path) adopts the path but keeps the current chat; **wrong-project guard** rejects a turn whose saved project isn't the one open in AE (before any model call/credit); a handler `{status:error}` is treated as "unknown" (won't wipe the sidebar); session cache invalidated on a definite switch.
  - New **internal-only** handler `openProject({path, save})` drives AE to open a file with no save dialog (not in the model catalog). **TopBar** now shows the open AE project name globally (home + chat), cross-fading on switch. New `ProjectSwitchBar.tsx` built but currently **unmounted** (kept for reuse).
- [x] **DONE (6/20/26) — PR #13 `configurable-properties-wave`: model gets ALL settable props, not just keyframeable.**
  - `_keyframeableChildren()` → `_configurableChildren()`: every create/mutate command now returns `configurableProperties` in a lean token format `{n,p,k,v,nk}` (`k:true` = animatable → `setLayerKeyframe`; `k:false` = dropdown/checkbox/menu → `setLayerProperty`; `nk` = numKeys, only when keyframeable).
  - **Payload trim:** skip AE plumbing (`SKIP_CONTAINERS`: Compositing Options/Audio/Marker), de-dupe by path, truncation sentinel `{truncated:true}` at 120 entries. Path-resolution fixes for shape operators/trims (round-trippable display-name paths).
  - Wired into ~all create/mutate handlers (layers/effects/text/shapes/masks/time-remap); prompt updated to the new schema.
  - **Infra:** `CUBIC_LLM_DEBUG` is now a level (0 off / 1 compact / 2 full tool_result bodies, clipped 1500 chars). Loading spinner phrases updated.

- [x] **DONE (6/22/26) — token/cost optimization (4 phases): ~10¢/msg → ~1–1.5¢ steady-state.** The per-message cost was dominated by re-billed context. Result: in a warm chat, a typical edit is ~1–1.5¢; the only big residual is a **one-time ~6¢ system-prompt cache-WRITE on the first call of a fresh chat** (or after the 5-min cache TTL lapses) — intentional (the never-guess catalog + rules are kept for quality; CC/Cursor run larger prompts). All result-trimming is **proxy-side** in `server/ai/src/agent/executeTool.ts` (`trimConfigurableProperties`), so bridge handlers + the live `.mjs` tests stay byte-identical.
  - **Phase 1 — conversation caching + RTK-style trim** (`7fc9f6c`): moved live AE state OUT of the cached system block to the message **tail** with a rolling `cache_control` breakpoint (Claude-Code/Cursor shape — `anthropic.ts` `appendLiveStateAndCacheBreakpoint`), so the conversation prefix stays cache-stable and re-reads at 0.1×. Tool results trimmed (`configurableProperties` → `{n,p,k}`, drop `v`/`nk`). `buildSystemPrompt()` no longer carries volatile state.
  - **Phase 2 — live-state-once-per-turn + batch nudge** (`7fc9f6c`): live state is fetched once per turn and sent ONLY on the first model call (`iter===0`), not re-billed across the turn's tool-loop iterations (`loop.ts`). `rules.ts` sharpened to batch all writes of a turn into ONE call.
  - **Phase 3 — pull catalog on demand + write-receipt trim** (`7c96aa2`): create/mutate results **stop shipping** `configurableProperties` (was ~3.3K tokens / ~half a simple-create turn). New read-only **`getLayerProperties`** pull tool returns paths on demand (never-guess preserved: rules say read-first, and `_resolvePropertyByPath` hard-throws `PROPERTY_NOT_FOUND` on a bad path). `setLayerProperties`/`batchSetLayerProperties` receipts collapse to identity + changed props' final values; `_configurableChildren` cap 120→80 + Transform-first walk.
  - **Phase 4 — comprehensive result minimization** (`956d2dc`): (a) `getLayerProperties` became a **one-level drill-down** — groups as `{p,g:true}` (pass `p` as `scope` to drill in), leaves as `{p,k}`, no `n` (= `p`'s last element); flattens implicit containers, per-level cap. (b) **`status` key eliminated** — the tool_result `is_error` flag conveys success/error: success → drop status+boilerplate message; error → `{errorCode,message}`; noop → `{noop:true,message}`; warning → keep `warning`. (c) **historical echoes dropped** (any `previous*`/`prev*`/`old*` key — never read by code). (d) **batch envelope collapsed** (drop derivable counts + per-sub `index`/`command`/`success`; inline sub-payloads; failed subs keep `{command,errorCode,message}`). (e) `getLayerProperty` drops echoed/derivable `name`/`path`/`isTimeVarying`. Every `events.ts` label was audited to survive the trim.
- [x] **DONE (6/21–6/22/26) — dev-only stale-panel preflight** (`418ea58`, `4ba2ac2`, `4139db0`): the CEP panel **bakes its `.jsx` bundle at open** and stays stale after a rebuild until reloaded — silently running old handler code. `scripts/preflight-panel.mjs` runs on `npm run dev` / tests, detects a stale panel (build-id mismatch), and **rebuilds + reloads + exits** with a colored verdict; only acts when actually stale; on app launch it waits for the panel to (re)connect first (`CUBIC_PREFLIGHT_WAIT_MS` knob). Dev/test-only — never in production.
- [x] **FIXED (6/21/26) — batch sub-commands no longer nest undo groups** (`d1e5807`): `batch` opens its own outer undo group, but its loop called `dispatchCommand` (which wraps each command in *its own* `beginUndoGroup`) → nested groups → an AE "undo group mismatch" and the batch group never closing, so one Cmd+Z reverted the user's later manual tweak **AND** the AI's whole turn together. Batch now calls the **unwrapped** `_dispatchSwitch`. Correct behavior restored: one Cmd+Z = the user's change, the next = the AI's change.
- [x] **FIXED (6/21/26) — text-layer create crash from live-object property values** (`91af460`): some property values are live AE objects (TextDocument/Shape/MarkerValue), not scalars; emitting one as `configurableProperties` `v` crashed the JSON polyfill (a point-text TextDocument's box getters throw "not of Box document type"), **aborting the whole response** on text-layer create. New `_isJsonSafeValue` guard keeps only JSON-safe scalars / number-arrays.
- [x] **FIXED (6/21/26) — create-time text justification restored** (`a142dba` → `87ea49c`): an earlier removal of `justification` from text-layer create was a misdiagnosis; restored so left/center/right alignment applies at creation.
- [x] **TRAINED (6/21/26) — Gradient Ramp fill rule** (`rules.ts`): the model was zeroing a shape's fill opacity to "reveal" a Gradient Ramp, making the layer transparent. Added a one-line constraint: keep the fill at 100% opacity (the Ramp recolors opaque pixels; its color is irrelevant) — never zero/delete the fill.
---
# THEN AUDIT+REVIEW ALL CODE (to verify claude code coding my whole project Lol) + UNDERSTAND architecture/design clearly 100% bro BEFORE PHASE 5
# MAYBE BUILD OUT TEASER DEMO VID BEFORE PHASE 5?? POST ON TWITTER??
---

### notes
- **§0 is a decision, not code.** Its `[x]` means the transport is *decided* (direct WS + one `getBackendPort()` IPC + re-attach-by-`sessionId`). The code gets built later: IPC → ②, re-attach backend half → ③, re-attach renderer half → ⑥.
- **Within a worktree:** plan all its items as one design, implement in *dependency order, not doc-bullet order*.
- ⑤/⑥/⑦ cross-wave deps (③'s sidebar/wire, ④'s handler) are auto-satisfied — Wave-1 is merged before you reach them.
- **If only running 2 parallel:** run ② ∥ ③, slot ④ (smallest, backend-only) right after ③ in the same slot.

---

## Standalone architecture / hardening tasks (NOT worktrees — do each on its own)

> Mirrored here so they're not forgotten; full detail lives in the phase files. These are deliberately **not** parallelized into the worktree waves above.

> _Local transport hardening (dynamic port + WebSocket auth) moved into Phase 5 — ✅ **DONE** (`WT-WS-AUTH`, §???-1/2/3/4 in `TODO-phase5-parallel.md`): backend binds `127.0.0.1:0` + mints a per-launch token, publishes `~/.cubic/conn.json` + reports up to main, all clients authenticate via a token `hello`._
- _→ moved to [`POSTMVP.md`](POSTMVP.md) (Architecture cleanup): brain→bridge direct in-process call._
- _→ moved to [`POSTMVP.md`](POSTMVP.md) (Test-truth & handler correctness): exhaustive test-truth pass._
- [x] **FIXED (6/13/26) — handler atomicity (no orphans / no partial updates).** Self-heal retries were stacking duplicates because a failed create left an orphan. (1) All orphan-prone create/apply handlers (`createTextLayer`, solid/camera/light/null, shape, `applyEffect`/`applyEffectTemplate`, `setLayerMask` create) now roll back the partial object on failure. (2) `set*` handlers (`setLayerProperties`, `batchSetLayerProperties`, `setCompositionProperties`, `setLayerMask` update, `setTextAnimatorRangeSelector`) are validate-first: invalid enum/font throws a self-healing error (via shared `_requireEnum`) BEFORE any mutation, so nothing partially applies; `updateMarker` already atomic. Live-verified. Genuine mid-`setValue` AE rejections still backstopped by idempotent retry + `.aep` snapshot (not in-handler restore — riskier than the partial).
- [x] **FIXED (6/13/26) — font display-name resolution (matchName-class bug).** `TextDocument.font` wants a PostScript name; the model supplied display names → throw → orphaned layer. New `fonts.jsx` `_resolveFont()` maps display→PostScript via live `app.fonts.allFonts` (which is an array-of-arrays — see ae-bridge CLAUDE.md), session-cached with fuzzy match ("Comic Sans"→"Comic Sans MS") + "did you mean" self-heal; degrades to passthrough if enumeration fails. New `listFonts` read command lets the model browse installed families. Live-verified.

---

> **Post-MVP / deferred work now lives in [`POSTMVP.md`](POSTMVP.md).** (Consolidated 6/20/26 — out of this file's bottom sections, the inline `DEFERRED TO POSTMVP` items, and `TODO-phase4-later.md`.)

# PRE-SHIP taste pass (HARD ship gate — Phase 5 §G-0, NOT optional/post-mvp)
The taste/style of the AI's motion is the moat (see the Palmier competitive read — they went generative,
left precise editable AE motion graphics open; that lane is only ours if the output is genuinely good).
Sequencing: do NOT block Phase 5 on this, but it IS a hard gate before any paid ship.
- [x] FIRST (before committing Phase-5 effort): run the 7-trial diagnostic in `taste-eval.md` to classify
  every failure as a JUDGMENT gap (prompt-fixable) vs a CAPABILITY gap (recipe/tool rework). Cheap (~half a day,
  no code). Purpose: de-risk Phase 5 — confirm taste is a prompt-tune, not a core rebuild, before building billing infra around it.
- [x] THEN (pre-ship, gated at §G-0): the prompt-tuning pass — rewrite `<motion_design_principles>` in `server/ai/src/prompt/rules.ts`
  to close the judgment gaps. Inputs: web-verify AE standard conventions for smooth/juicy/bouncy SaaS-video settings;
  inspo from good AE youtube tutorials (+ maybe well-edited gaming montages). Capability gaps deferred to post-mvp recipe work.

# context quality — agent only sees point-in-time property values, not keyframes/animation
The per-turn live-state snapshot (`server/ai/src/context/buildContext.ts`) reads each property's VALUE
at the current playhead time. If the playhead sits at t=0 where an animation hasn't started, Scale/etc.
read as `[0,0]` and the agent concludes "nothing is visible / no animation" — even when the comp clearly
has keyframed animation (it just doesn't see keyframes unless it calls `getLayerKeyframes`). Surfaced
6/12/26 while testing wt-chat-ui (amplified by Haiku; default Sonnet 4.6 reasons better). Fix options:
include a keyframe/animation summary in the live-state context, and/or prompt the agent to check
keyframes before declaring a layer static. Context/prompt work — NOT a chat-UI concern.
