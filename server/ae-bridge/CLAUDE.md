# CLAUDE.md — server/ae-bridge
Keep Claude.md under 150 lines. Concise, high-signal content preferred.

> **Scope:** AE bridge — WS transport (`wsBridge.ts`), ExtendScript handlers (`src/scripts/*.jsx`), and the CEP extension that runs them, plus an optional MCP-server dev entrypoint. Hosts the `cubic-ai` agent loop in-process but does NOT reimplement the brain (that lives in `server/ai`). End goal: Motion Copilot — an AI agent that writes animations natively in After Effects; see [`docs/PRD.md`](../../docs/PRD.md) (vision) + `TODOS/TODO-phase4.md` (status).

## Project structure (repo root: `cubic/`)
```
cubic/
├── docs/PRD.md              # Product vision + phase roadmap (source of truth for scope)
├── TODO.md                  # Phase checklist (keep in sync when completing tasks)
├── app/                     # Phase 4: standalone Electron desktop app (React chat UI + hosts the Node backend) — to build
├── server/
│   ├── ai/                  # Phase 2 ✅ Claude API backend / agent brain (loop, self-heal, compaction, sessions)
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
│       │       ├── compositions.jsx / layers.jsx / animation.jsx / effects.jsx / masks.jsx / footage.jsx / text.jsx / shapes.jsx / markers.jsx / project.jsx
│       ├── cep-extension/src/main.js  # Thin headless AE bridge: WS client + evalScript dispatch footer (Phase 4: strip its UI, app auto-installs it)
│       ├── scripts/build-cep-extension.mjs  # Bundles .jsx files → handlers.bundled.jsx
│       └── tests/               # Per-domain integration tests (require live AE + panel)
```

> **Naming:** only the actual MCP server entrypoint (`index.ts` + `.mcp.json` + the SDK dep) is correctly named "mcp". The transport, handlers, CEP extension, and `server/ai`'s bridge client are *bridge*, not MCP. The code-identifier rename is done (`bridge.jsx`, `server/ai/src/bridge/` + `BridgeClient`). Two **path/bundle** names still say "mcp" and are deferred to the §B install-flow item (they force a reinstall/migration): the `com.cubic.ae-mcp-bridge` bundle id and the `~/.ae-mcp-bridge/port` home dir.

## Commands
```bash
npm run build:server   # Compile src/index.ts → build/index.js
npm run build:plugin   # Bundle CEP extension → cep-extension/dist/
npm run build          # Both of the above
npm run install-plugin # Copy extension to Adobe CEP folder + enable PlayerDebugMode
npm start              # Run the MCP server standalone (not needed — Claude Code already spawns it)
npm run serve          # Run the backend standalone (bridge + agent loop, no MCP) — the path Electron main spawns in §B
npm run build:serve    # Compile src/serve.ts → build/serve.js
```

## When to restart what
| What changed | What to run | What to reload |
|---|---|---|
| Any `src/scripts/*.jsx` | `npm run build:plugin` + `npm run install-plugin` | Close + reopen MCP Bridge panel in AE |
| `src/index.ts` or `wsBridge.ts` | `npm run build:server` | Restart Claude Code |
| Both | `npm run build` + `npm run install-plugin` | Both of the above |

CEP panel reloads handlers on each command — no AE restart needed for `.jsx` changes. MCP server requires CC restart.

## Env (one shared file)
`startBackend.ts` → `loadLocalEnv()` loads the single **`server/.env`** (resolves `build/ → ../../.env`) — the one source of truth for `ANTHROPIC_API_KEY` + `CUBIC_MODEL` (alias `sonnet|haiku|opus`), gitignored. The per-package `server/ai/.env` / `server/ae-bridge/.env` were removed to stop "edited the wrong .env" drift; don't recreate them. Boot prints a model banner (and warns if `CUBIC_MODEL` is unset → costly Sonnet default). Flip models by editing `server/.env` + restarting — `build:serve` only needed when `src/` changes. A shell-exported `CUBIC_MODEL` still wins (loadEnvFile never overrides a real env var).

## Architecture
Two components over WebSocket: **Node MCP server** (`src/index.ts`) hosts WS on `127.0.0.1:17923`, receives tool calls, forwards `{ id, command, args }` to the **CEP panel** in AE (`cep-extension/`), which runs `evalScript(handlersBundle + footer)` and sends back `{ id, ok, result }`. Results are synchronous — no `getResults` needed.

> **Wire protocol contract:** the full WS message contract (both channels + `AgentEvent` + error codes) is locked in [`PROTOCOL.md`](./PROTOCOL.md) — the single source future host adapters depend on.

**Handler bundle** (concatenated by build script, domain files first, `bridge.jsx` last):
```
compositions.jsx  ← getProjectInfo, listCompositions, getCompositionInfo, createComposition,
                     setCompositionProperties, deleteComposition, duplicateComposition,
                     getCurrentTime, setCurrentTime, saveFrameToPng
layers.jsx        ← getLayerInfo, getSelectedLayers, getSelectionDetails, setSelectedLayers, createLayer (dispatcher), createSolidLayer,
                     createCamera, createLightLayer, createNullLayer, duplicateLayer, setLayerProperties,
                     batchSetLayerProperties, splitLayer, mergeLayer, trimLayer, setTimeRemapEnabled, setLayerParent, moveLayer,
                     setAnchorPoint, centerAnchorPoint (alias), alignLayers, sequenceLayers,
                     precompose, decomposeLayer, setTrackMatte, deleteLayer, getLayerProperty, setLayerProperty,
                     distributeLayers3D (shape: cylinder|grid; backend computes XYZ coords)
text.jsx          ← createTextLayer, addTextAnimator, setTextAnimatorProperty, setTextAnimatorRangeSelector,
                     explodeTextLayer
shapes.jsx        ← createShapeLayer, addShapeOperator, setShapeOperatorProperty, convertToShape
animation.jsx     ← getLayerKeyframes, setLayerKeyframe, setKeyframeEasing, setKeyframeSpatial, removePropertyKeyframes,
                     setLayerExpression (+ preset: INERTIAL_BOUNCE|ELASTIC|OVERSHOOT|WIGGLE|AUTO_FADE|
                     LOOP_OUT|LOOP_IN|LOOP_PINGPONG), getLayerExpressions, copyKeyframeEasing,
                     applyMotionRecipe (recipe: popIn|popOut|fadeIn|fadeOut|slideIn|slideOut|scaleIn|bounceIn|wiggle; layerIndices[] + stagger)
masks.jsx         ← getLayerMasks, setLayerMask, deleteLayerMask
effects.jsx       ← getLayerEffects, applyEffect (friendly effectName resolved via EFFECT_DICT — the
                     single source of truth for matchNames + default settings; raw matchName/presetPath
                     still work), applyEffectTemplate, setEffectProperty, deleteEffect,
                     introspectMatchNames (internal/diagnostic — asks AE for real matchNames; feeds the
                     ae-matchnames.json fixture + the test:matchnames CI guard)
footage.jsx       ← listProjectItems, importFootage, addFootageToComp, importAssetToComp,
                     deleteProjectItem, deleteUnusedSolids
markers.jsx       ← addMarker, listMarkers, updateMarker, removeMarker
project.jsx       ← getProjectPath, saveProject, restoreProject (reopens the .aep from a .cubic-backups/ copy; skips the undo wrapper),
                     backupProject (internal: copies the .aep to .cubic-backups/ — NOT in COMMANDS, called only by the agent loop)
bridge.jsx    ← JSON polyfill + ERROR_CODES + _err() + _resolveComp() + _resolveCompAndLayer() +
                     _resolvePropertyByPath() + READ_ONLY_COMMANDS + dispatchCommand() + _dispatchSwitch() + batch()
```

## Adding a new command
1. Add handler to the appropriate domain file in `src/scripts/`
2. Add a `case` in `_dispatchSwitch()` in `bridge.jsx`
3. If read-only (getter), add to `READ_ONLY_COMMANDS` in `bridge.jsx`
4. Add name to the `COMMANDS` array in `src/commands.ts` (the allowlist `index.ts` validates against)
5. `npm run build:plugin` + `npm run install-plugin` + reopen panel (+ `npm run build:server` + restart CC if `index.ts` changed)

Note: typed MCP tools (`server.registerTool`) are reserved for the bridge/diagnostic surface (`runScript`, `batch`, `getHelp`, `createComposition`, `runBridgeTest`, `testAnimation`, `getResults`). All handler commands are called via `runScript` — no per-command typed tool needed.

**New domain file:** also add to `domainFiles` array in `scripts/build-cep-extension.mjs`. Handler functions must live in domain files only — never in `bridge.jsx`.

## Undo groups (Cubic undo)
Every mutating command is wrapped in `app.beginUndoGroup("Cubic: <command>") / endUndoGroup()` via `try/finally` in `dispatchCommand()` — so one Cmd+Z reverts a full Cubic operation. Read-only commands (in `READ_ONLY_COMMANDS`) skip the wrapper. `batch` gets its own outer group wrapping the entire loop — all sub-commands collapse into one undo entry. Callers may pass `groupLabel` to set a human-readable label (`"Cubic: <groupLabel>"`); when omitted, falls back to `"Cubic: batch (N commands)"`.

Read-only allowlist (`READ_ONLY_COMMANDS`): `getProjectInfo`, `listCompositions`, `getCompositionInfo`, `getLayerInfo`, `getLayerKeyframes`, `getLayerExpressions`, `getLayerMasks`, `getLayerEffects`, `getSelectedLayers`, `getSelectionDetails`, `listProjectItems`, `listMarkers`, `getCurrentTime`, `getProjectPath`, `getLayerProperty`. (`restoreProject` also skips the undo wrapper but via a special-case check, not this map.)

**No programmatic undo.** AE gates `app.executeCommand(Undo)` from CEP's evalScript context — every approach (top-level, `scheduleTask`, `BridgeTalk`, `findMenuCommandId`-by-dynamic-label) no-ops. Rollback is handled via **inverse-CRUD**: each `create*` has a matching `delete*`, each `set*` can be replayed with prior values captured via the matching `get*`. The user's own ⌘Z still works because every mutation is wrapped in `beginUndoGroup`.

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

## Engineering constraints
**No sleeps or polling waits.** The WS bridge is synchronous request/response — commands return results directly. Never add `$.sleep()`, `setTimeout`, or retry loops to make broken code work. If something appears to need a wait, find the real root cause (stale cache, async API, wrong check) and fix that instead.

**Consistency across the codebase.** Comments, error handling, return shapes, and formatting must match the existing style in the file being edited. Don't introduce new patterns without updating all relevant files.

**Broad, parameterized tools — not one tool per variant.** A tool should cover a domain operation with a `type` or similar discriminator, not be split into per-variant commands. Example: `createLayer({ type: "solid" | "text" | "shape" | ... })` — not separate `createSolidLayer`, `createTextLayer`, etc. tools exposed at the MCP level. Internal handler functions can be split for clarity, but the MCP surface stays consolidated and robust.

## Troubleshooting (full reset)
If commands hang or tests time out — the WS chain is broken. Full reset:
1. `npm run build` + `npm run install-plugin`
2. Restart AE → open **Window → Extensions → MCP Bridge** → wait for "Connected"
3. `npm start` in one terminal, run tests in another

**macOS CEP install path:** `~/Library/Application Support/Adobe/CEP/extensions/com.cubic.ae-mcp-bridge/`
Enable AE scripting: **Settings → Scripting & Expressions → Allow Scripts to Write Files and Access Network**