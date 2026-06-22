# CLAUDE.md — server/ae-bridge
Keep Claude.md under 150 lines. Concise, high-signal content preferred.

> **Scope:** AE bridge — WS transport (`wsBridge.ts`), ExtendScript handlers (`src/scripts/*.jsx`), and the CEP extension that runs them, plus an optional MCP-server dev entrypoint. Hosts the `cubic-ai` agent loop in-process but does NOT reimplement the brain (that lives in `server/ai`). End goal: Motion Copilot — an AI agent that writes animations natively in After Effects; see [`docs/PRD.md`](../../docs/PRD.md) (vision) + `TODOS/TODO-phase4.md` (status).

## Project structure (repo root: `cubic/`)
```
cubic/
├── docs/PRD.md              # Product vision + phase roadmap (source of truth for scope)
├── TODO.md                  # Phase checklist (keep in sync when completing tasks)
├── app/                     # Standalone Electron desktop app (React chat UI + hosts the Node backend) — see app/README.md
├── server/
│   ├── ai/                  # Claude API backend / agent brain (loop, self-heal, compaction, sessions) — see server/ai/CLAUDE.md
│   └── ae-bridge/           # AE bridge + ExtendScript handlers + CEP extension + optional MCP-server dev interface (this package)
│       ├── src/
│       │   ├── index.ts         # MCP server entrypoint (dev): tool/resource registration + stdio transport for Claude Code
│       │   ├── serve.ts         # Standalone backend entrypoint: bridge + agent loop only, no MCP/stdio — the app spawns this (§B)
│       │   ├── startBackend.ts  # Shared boot helper: loadLocalEnv() + bridge.start() + registerAgentChat() + signal shutdown; logs the active model banner (used by both entrypoints)
│       │   ├── commands.ts       # COMMANDS allowlist — source of truth for valid command names (index.ts validates every runScript against it)
│       │   ├── agentChat.ts      # Folds in the cubic-ai agent loop: bridge.onChat handler, steer queue (incl. edit/remove by id), streams agentEvents back
│       │   ├── persist.ts        # Conversation persistence — sessions on disk (default ~/.cubic/sessions, override CUBIC_SESSIONS_DIR)
│       │   ├── reattach.ts / displayItems.ts  # Re-bind an in-flight turn's stream on renderer reload; map agent events → renderer DisplayItem rows
│       │   ├── bridge/wsBridge.ts  # WebSocket server relaying commands to the CEP panel
│       │   └── scripts/         # ExtendScript handlers (run inside AE via evalScript)
│       │       ├── bridge.jsx   # Dispatch + batch + undo groups — NOT a handler file
│       │       ├── compositions.jsx / fonts.jsx / layers.jsx / text.jsx / shapes.jsx / animation.jsx / masks.jsx / effects.jsx / footage.jsx / markers.jsx / project.jsx
│       ├── cep-extension/src/main.js  # Thin headless AE bridge: WS client + evalScript dispatch footer (Phase 4: strip its UI, app auto-installs it)
│       ├── scripts/build-cep-extension.mjs  # Bundles .jsx files → handlers.bundled.jsx
│       └── tests/               # Per-domain integration tests (require live AE + panel)
```

> **Naming:** only the actual MCP server entrypoint (`index.ts` + `.mcp.json` + the SDK dep) is correctly named "mcp". The transport, handlers, CEP extension, and `server/ai`'s bridge client are *bridge*, not MCP. Both the code-identifier rename (`bridge.jsx`, `server/ai/src/bridge/` + `BridgeClient`) AND the path/bundle rename (§B2, done 6/16/26) are complete: bundle id is now `com.cubic.ae-bridge`, the CEP panel displays as **Cubic**, and the port file lives at `~/.cubic/port` (alongside `~/.cubic/sessions/`).

## Commands
```bash
npm run build:backend  # Bundle src/serve.ts + src/index.ts → build/ (bakes __CUBIC_BACKEND_BUILD_ID__)
npm run build:server   # build/index.js only (MCP entry)
npm run build:serve    # build/serve.js only (the backend the app spawns)
npm run build:plugin   # Bundle CEP extension → cep-extension/dist/
npm run build          # build:backend + build:plugin
npm run install-plugin # Copy extension to Adobe CEP folder + enable PlayerDebugMode
npm start              # Run the MCP server standalone (not needed — Claude Code already spawns it)
npm run serve          # Run the backend standalone (bridge + agent loop, no MCP) — the path Electron main spawns in §B
```

## When to restart what
| What changed | What to run | What to reload |
|---|---|---|
| Any `src/scripts/*.jsx` | `npm run build:plugin` + `npm run install-plugin` | Close + reopen the Cubic panel in AE |
| `src/index.ts` or `wsBridge.ts` | `npm run build:server` | Restart Claude Code |
| Both | `npm run build` + `npm run install-plugin` | Both of the above |

The panel re-evaluates only the dispatch *footer* per command — **the handler bundle (`HANDLERS_BUNDLE`) is baked into `main.js` at build time and loaded once when the panel opens**, so a rebuild+install does NOT reach an already-open panel until it reloads. MCP server requires CC restart.

## Dev-only stale-code preflight (panel + backend)
Two dev artifacts go stale silently: the **panel** bundle (baked into `main.js` at panel-open) and the **backend** (`build/serve.js` + the cubic-ai brain it loads from `server/ai/build/`) — neither is rebuilt by `npm run dev` or by tests. The unified `scripts/preflight.mjs` (single entrypoint; runs `preflight-backend.mjs` + `preflight-panel.mjs`) closes both gaps for developers and exits non-zero if either was stale, so the dev re-runs on fresh code:
- **Panel:** computes the latest build id from source, queries the open panel's `__CUBIC_BUILD_ID__` (reported in `hello`); if stale, rebuilds the plugin + reloads the panel (`devReload`).
- **Backend:** content-hashes both TS trees (`ae-bridge/src` + `ai/src`, `.ts` only, excluding `*.test.ts`) into `__CUBIC_BACKEND_BUILD_ID__`, baked into `build/serve.js`+`build/index.js` by `scripts/build-backend.mjs` and reported by the running backend (`backendInfo`); if stale, rebuilds `server/ai` then `serve.js` (dependency order: the brain first so serve.js's runtime import is current).

Both ids are content hashes, so an unchanged rebuild is a no-op (no spurious reloads/rebuilds). Runs at the top of the panel/backend-requiring `test*` scripts (via `&&`, incl. `server/ai`'s live tests → `node ../ae-bridge/scripts/preflight.mjs`) and dev-only in the Electron app's boot (`app/src/main/index.ts` → `runDevPreflight`, after `backend.start()`; quits the app if stale). Purely developer tooling — production gets fresh code via the auto-updater (no Cubic UI, no per-command runtime guard). Wire shapes (`buildId` in `hello`, `workerInfo`/`backendInfo`/`reload`/`devReload`) are in `PROTOCOL.md`.

## Env (one shared file)
`startBackend.ts` → `loadLocalEnv()` loads the single **`server/.env`** (resolves `build/ → ../../.env`) — the one source of truth for `ANTHROPIC_API_KEY` + `CUBIC_MODEL` (alias `sonnet|haiku|opus`), gitignored. The per-package `server/ai/.env` / `server/ae-bridge/.env` were removed to stop "edited the wrong .env" drift; don't recreate them. Boot prints a model banner (and warns if `CUBIC_MODEL` is unset → costly Sonnet default). Flip models by editing `server/.env` + restarting — `build:serve` only needed when `src/` changes. A shell-exported `CUBIC_MODEL` still wins (loadEnvFile never overrides a real env var).

## Architecture
Two components over WebSocket: the **Node backend** hosts WS on `127.0.0.1:17923` (via the shared `startBackend()` — used by both `serve.ts`, the standalone bridge + agent loop the app spawns, and `index.ts`, the optional MCP dev entrypoint), receives `{ id, command, args }`, and forwards them to the **CEP panel** in AE (`cep-extension/`), which runs `evalScript(handlersBundle + footer)` and sends back `{ id, ok, result }`. Results are synchronous — no `getResults` round-trip.

> **Wire protocol contract:** the full WS message contract (both channels + `AgentEvent` + error codes) is locked in [`PROTOCOL.md`](./PROTOCOL.md) — the single source future host adapters depend on.

**Handler bundle** — the build script concatenates the domain files (then `bridge.jsx` last); `fonts.jsx` must precede `text.jsx` (text resolves fonts via its `_resolveFont`). Each file owns one slice of the AE surface. **`src/commands.ts` is the authoritative command list** (kept in lockstep with the `server/ai` param registry by `test:drift`) — consult it rather than re-listing commands here, so this map doesn't drift as handlers are added.
```
compositions.jsx ← comps + project info, playhead, single-frame PNG render
fonts.jsx        ← font listing + display-name→postScriptName resolution (helper for text.jsx)
layers.jsx       ← layers: create/dupe/delete, transforms & properties, parent/nulls, align/distribute, anchor,
                    fit, sequence, time ops (split/merge/trim/retime), nesting/mattes, 3D layout, camera, background
text.jsx         ← text layers, animators + range selectors, explode, kinetic-type presets
shapes.jsx       ← shape layers, vector operators, convert-to-shape, write-on, extract/merge
animation.jsx    ← keyframes (CRUD/easing/spatial/clone/sequence/fix-timing), expression presets, motion recipes
masks.jsx        ← layer masks
effects.jsx      ← effects (friendly name → matchName via EFFECT_DICT), color grading, templates, introspectMatchNames (diagnostic)
footage.jsx      ← project-panel items: import, add-to-comp, folders, prune
markers.jsx      ← comp/layer markers
project.jsx      ← project path/save, restoreProject + internal backupProject (.cubic-backups/ snapshots)
bridge.jsx       ← NOT a handler: JSON polyfill, ERROR_CODES/_err, comp/layer/property resolvers,
                    READ_ONLY_COMMANDS, dispatchCommand/_dispatchSwitch, batch
```

## Adding a new command
1. Add handler to the appropriate domain file in `src/scripts/`
2. Add a `case` in `_dispatchSwitch()` in `bridge.jsx`
3. If read-only (getter), add to `READ_ONLY_COMMANDS` in `bridge.jsx`
4. Add name to the `COMMANDS` array in `src/commands.ts` (the allowlist `index.ts` validates against)
5. `npm run build:plugin` + `npm run install-plugin` + reopen panel (+ `npm run build:server` + restart CC if `index.ts` changed)

Note: typed MCP tools (`server.registerTool`) are reserved for the bridge/diagnostic surface — exactly four: `runScript`, `getHelp`, `runBridgeTest`, `createComposition`. All handler commands are called via `runScript` — no per-command typed tool needed. (Separate surface: the `server/ai` agent brain (AKA what the users interact with) exposes its own 3 tools to the model — `runScript`, `batch`, `createComposition` — where `batch` IS a dedicated tool, not a `runScript` command. A raw MCP caller, lacking that tool, only has access to the above 4 tools instead and would reach batch via `runScript({script:"batch"})`.)

**New domain file:** also add to `domainFiles` array in `scripts/build-cep-extension.mjs`. Handler functions must live in domain files only — never in `bridge.jsx`.

## Undo groups (Cubic undo)
Every mutating command is wrapped in `app.beginUndoGroup() / endUndoGroup()` via `try/finally` in `dispatchCommand()` — so one Cmd+Z reverts a full Cubic operation. Read-only commands (in `READ_ONLY_COMMANDS`) skip the wrapper. `batch` gets its own outer group wrapping the entire loop — all sub-commands collapse into one undo entry. The Edit > Undo label prefers a caller-supplied `__undoLabel` (a friendly summary the agent injects — e.g. `"Cubic: Added text layer"` — mirroring the chat row, so it never shows the raw command name), then a raw `groupLabel`, then a fallback (`"Cubic: <command>"` for single commands, `"Cubic: batch (N commands)"` for batch).

Read-only allowlist (`READ_ONLY_COMMANDS`): `getProjectInfo`, `listCompositions`, `getCompositionInfo`, `getLayerInfo`, `getLayerKeyframes`, `getLayerExpressions`, `getLayerMasks`, `getLayerEffects`, `getSelectedLayers`, `getSelectionDetails`, `listProjectItems`, `listMarkers`, `getCurrentTime`, `getProjectPath`, `getLayerProperty`. (`restoreProject` also skips the undo wrapper but via a special-case check, not this map.)

**No programmatic undo.** AE gates `app.executeCommand(Undo)` from CEP's evalScript context — every approach (top-level, `scheduleTask`, `BridgeTalk`, `findMenuCommandId`-by-dynamic-label) no-ops. Rollback is handled via **inverse-CRUD**: each `create*` has a matching `delete*`, each `set*` can be replayed with prior values captured via the matching `get*`. The user's own ⌘Z still works because every mutation is wrapped in `beginUndoGroup`.

**Atomic create (handler convention).** A `create*`/`apply*` handler that builds an object (`addText`, `addShape`, `addSolid`, `Effects.addProperty`, `Masks.addProperty`, …) and then does more work that can throw MUST roll back on failure: declare the object var as `null` *before* the `try`, assign it on creation, and in the `catch` do `if (obj !== null) { try { obj.remove(); } catch (e2) {} }` (a loop in reverse for multi-object creates like `applyEffectTemplate`). Without this, a failed create leaves an orphan and the agent's self-heal retry stacks a duplicate. This is intra-handler atomicity — distinct from the model-facing inverse-CRUD above. Since AE can't programmatically undo, there's no generic wrapper; it's per-handler.

Autosave-before-run revert point is now the agent loop's pre-turn `backupProject` snapshot (a filesystem copy to `.cubic-backups/`), NOT a per-turn undo group — AE undo groups can't span the loop's async LLM round-trips. Deferred: undo history panel (Phase 4).

## Agent loop fold (Phase 2)
This process now also hosts the AI agent loop: `server/ae-bridge` depends on `cubic-ai` (`file:../ai`) and `agentChat.ts` registers a chat handler on the bridge (`bridge.onChat`). The panel sends `{type:'userChat'|'cancel'|'queue'}` over its worker socket; the loop streams `{type:'agentEvent', event}` back. **Rebuild + `npm install` notes:** after changing `server/ai`, run its `npm run build` (emits `build/` + `build/types/`) so the symlinked `cubic-ai` is current; then rebuild this server. The loop reaches AE via cubic-ai's own loopback bridge client (a second WS connection), so command + agentEvent traffic share the panel socket. Around the loop this package owns `persist.ts`, `reattach.ts`, `displayItems.ts`, and the steer queue in `agentChat.ts` (queue/edit/remove by id) — see the structure tree above. The `cubic-ai` Session only exposes the FIFO `pendingMessages` drain; queue editing is this package's transport concern.

## Structured errors (Tier 3)
All handler `catch` blocks now return `{ status:"error", errorCode, message, line }`. `errorCode` is one of: `COMP_NOT_FOUND`, `LAYER_NOT_FOUND`, `LAYER_INDEX_OOB`, `PROPERTY_NOT_FOUND`, `INVALID_ARGS`, `TIME_OUT_OF_RANGE`, `RENDER_FAILED`, `UNKNOWN_COMMAND`, `HANDLER_UNCAUGHT`, `INTERNAL_ERROR`, `BATCH_FAILED` (any sub-command of a `batch` failed — per-command codes are in `results[]`). The Node bridge uses `BridgeError` (with `.code`) for transport-level errors. `dispatchTool()` in `src/index.ts` parses handler responses and sets MCP `isError:true` + `structuredContent` when `status:"error"` is detected.

## saveFrameToPng
`comp.saveFrameToPng(time, file)` — renders a single frame. Default output: `~/.cubic/frames/frame_<ts>.png` (persistent; Phase 3 can diff across turns). Returns text JSON + inline base64 PNG. Timeout 30s (rendering is slow). AE setting required: **Settings → Scripting & Expressions → Allow Scripts to Write Files and Access Network**.

**SUPER IMPORTANT `RENDER_FAILED` is retryable.** AE's renderer occasionally flushes the PNG after evalScript returns, producing a 0-byte file. `dispatchTool` in `index.ts` validates the PNG magic header and returns `RENDER_FAILED` in this case. The agent loop (Phase 2) should treat `RENDER_FAILED` on `saveFrameToPng` as a transient error and retry once — not escalate to the user.

## Critical ExtendScript quirks
- **Array values arrive as strings:** `[0, 0]` arrives as `"[0, 0]"` — use `eval("(" + value + ")")` to parse.
- **Use `eval` not `JSON.parse`:** AE 2026's `JSON.parse` returns non-native arrays rejected by the AE C++ API. The dispatch footer always uses `eval("(" + JSON.stringify(args) + ")")`.
- **Scale is 3-element `[x, y, z]`:** Passing `[x, y]` leaves `z` as `NaN`. Reconstruct using `property.value` as a template.
- **`setTemporalEaseAtKey` needs one `KeyframeEase` per dimension:** Pass `[ease, ease, ease]` for 3D properties.
- **Easy Ease:** `KeyframeInterpolationType.EASY_EASE` doesn't exist — use `BEZIER` + `KeyframeEase(0, 33.33)`.
- **`Date.toISOString()` missing in ES3:** Build ISO strings manually with `getFullYear()` etc.
- **`"EvalScript error."` = bundle-level syntax failure**, not a handler error (those are caught by the footer's try/catch and returned as structured JSON).
- **Layer indices are 1-based.** Lower index = renders on top.
- **`app.fonts.allFonts` is an array of per-family ARRAYS of FontObjects**, not a flat list — iterate two levels (`allFonts[i][j]`). Each FontObject has `postScriptName`/`familyName`/`styleName`/`fullName`. `TextDocument.font` wants the `postScriptName` (e.g. "ComicSansMS"), not a display name — `fonts.jsx` `_resolveFont()` does this mapping.

## Engineering constraints
**No sleeps or polling waits.** The WS bridge is synchronous request/response — commands return results directly. Never add `$.sleep()`, `setTimeout`, or retry loops to make broken code work. If something appears to need a wait, find the real root cause (stale cache, async API, wrong check) and fix that instead.

**Consistency across the codebase.** Comments, error handling, return shapes, and formatting must match the existing style in the file being edited. Don't introduce new patterns without updating all relevant files.

**Broad, parameterized tools — not one tool per variant.** A tool should cover a domain operation with a `type` or similar discriminator, not be split into per-variant commands. Example: `createLayer({ type: "solid" | "text" | "shape" | ... })` — not separate `createSolidLayer`, `createTextLayer`, etc. tools exposed at the MCP level. Internal handler functions can be split for clarity, but the MCP surface stays consolidated and robust.

## Troubleshooting (full reset)
If commands hang or tests time out — the WS chain is broken. Full reset:
1. `npm run build` + `npm run install-plugin`
2. Restart AE → open **Window → Extensions → Cubic** → wait for "Connected"
3. `npm start` in one terminal, run tests in another

**macOS CEP install path:** `~/Library/Application Support/Adobe/CEP/extensions/com.cubic.ae-bridge/`
Enable AE scripting: **Settings → Scripting & Expressions → Allow Scripts to Write Files and Access Network**