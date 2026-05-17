# CLAUDE.md
Be sure to keep Claude.md file less than 150 lines

> **End goal:** Motion Copilot — an AI agent that lives in After Effects and writes animations natively, like GitHub Copilot but for video. See [`docs/PRD.md`](../../docs/PRD.md) for the full vision.

## Project structure (repo root: `cubic/`)

```
cubic/
├── docs/PRD.md              # Product vision + phase roadmap (source of truth for scope)
├── TODO.md                  # Phase checklist (keep in sync when completing tasks)
├── extension/               # Phase 4: UXP/CEP panel UI (React) — empty placeholder
├── server/
│   ├── ai/                  # Phase 2: Claude API backend / agent brain — empty placeholder
│   └── mcp/                 # ← YOU ARE HERE (Phase 1.5)
│       ├── src/
│       │   ├── index.ts         # MCP server: tool/resource registration, allowedScripts list
│       │   ├── bridge/wsBridge.ts  # WebSocket server relaying commands to the CEP panel
│       │   └── scripts/         # ExtendScript handlers (run inside AE via evalScript)
│       │       ├── mcp-bridge.jsx   # Dispatch + batch + undo groups — NOT a handler file
│       │       ├── compositions.jsx / layers.jsx / animation.jsx
│       │       ├── effects.jsx / masks.jsx / footage.jsx
│       ├── cep-extension/src/main.js  # WS client + evalScript dispatch footer
│       ├── scripts/build-cep-extension.mjs  # Bundles .jsx files → handlers.bundled.jsx
│       └── tests/               # Per-domain integration tests (require live AE + panel)
```

**Current phase: 1.5** — MCP functional. Active work: finish CRUD coverage, comprehensive tests, undo groups ✅
**Next: Phase 2** (`server/ai/`) → Claude API backend. **Phase 4** (`extension/`) → Panel UI.

---

## Commands

```bash
npm run build:server   # Compile src/index.ts → build/index.js
npm run build:plugin   # Bundle CEP extension → cep-extension/dist/
npm run build          # Both of the above
npm run install-plugin # Copy extension to Adobe CEP folder + enable PlayerDebugMode
npm start              # Run the MCP server (WS bridge on 127.0.0.1:17923)
```

## When to restart what

| What changed | What to run | What to reload |
|---|---|---|
| Any `src/scripts/*.jsx` | `npm run build:plugin` + `npm run install-plugin` | Close + reopen MCP Bridge panel in AE |
| `src/index.ts` or `wsBridge.ts` | `npm run build:server` | Restart Claude Code |
| Both | `npm run build` + `npm run install-plugin` | Both of the above |

CEP panel reloads handlers on each command — no AE restart needed for `.jsx` changes. MCP server requires CC restart.

## Architecture

Two components over WebSocket: **Node MCP server** (`src/index.ts`) hosts WS on `127.0.0.1:17923`, receives tool calls, forwards `{ id, command, args }` to the **CEP panel** in AE (`cep-extension/`), which runs `evalScript(handlersBundle + footer)` and sends back `{ id, ok, result }`. Results are synchronous — no `getResults` needed.

**Handler bundle** (concatenated by build script, domain files first, `mcp-bridge.jsx` last):
```
compositions.jsx  ← getProjectInfo, listCompositions, createComposition, setCompositionProperties,
                     deleteComposition
layers.jsx        ← getLayerInfo, getSelectedLayers, createTextLayer, createShapeLayer, createSolidLayer,
                     createCamera, createLightLayer, createNullLayer, duplicateLayer, setLayerProperties,
                     batchSetLayerProperties, setLayerParent, moveLayer, deleteLayer
animation.jsx     ← getLayerKeyframes, setLayerKeyframe, setKeyframeEasing, removePropertyKeyframes,
                     setLayerExpression, getLayerExpressions
masks.jsx         ← getLayerMasks, setLayerMask, deleteLayerMask
effects.jsx       ← getLayerEffects, applyEffect, applyEffectTemplate, setEffectProperty, deleteEffect
footage.jsx       ← listProjectItems, importFootage, addFootageToComp, deleteProjectItem, deleteUnusedSolids
mcp-bridge.jsx    ← JSON polyfill + READ_ONLY_COMMANDS + dispatchCommand() + _dispatchSwitch() + batch()
```

## Adding a new command

1. Add handler to the appropriate domain file in `src/scripts/`
2. Add a `case` in `_dispatchSwitch()` in `mcp-bridge.jsx`
3. If read-only (getter), add to `READ_ONLY_COMMANDS` in `mcp-bridge.jsx`
4. Add name to `allowedScripts` in `src/index.ts`
5. Optionally add a dedicated typed MCP tool in `src/index.ts`
6. `npm run build:plugin` + `npm run install-plugin` + reopen panel (+ `npm run build:server` + restart CC if `index.ts` changed)

**New domain file:** also add to `domainFiles` array in `scripts/build-cep-extension.mjs`. Handler functions must live in domain files only — never in `mcp-bridge.jsx`.

## Undo groups (Cubic undo)

Every mutating command is wrapped in `app.beginUndoGroup("Cubic: <command>") / endUndoGroup()` via `try/finally` in `dispatchCommand()` — so one Cmd+Z reverts a full Cubic operation. Read-only commands (in `READ_ONLY_COMMANDS`) skip the wrapper. `batch` gets its own outer group (`"Cubic: batch (N commands)"`) wrapping the entire loop — all sub-commands collapse into one undo entry.

Read-only allowlist: `getProjectInfo`, `listCompositions`, `getLayerInfo`, `getLayerKeyframes`, `getLayerExpressions`, `getLayerMasks`, `getLayerEffects`, `getSelectedLayers`, `listProjectItems`

**No programmatic undo.** AE gates `app.executeCommand(Undo)` from CEP's evalScript context — every approach (top-level, `scheduleTask`, `BridgeTalk`, `findMenuCommandId`-by-dynamic-label) no-ops. Rollback is handled via **inverse-CRUD**: each `create*` has a matching `delete*`, each `set*` can be replayed with prior values captured via the matching `get*`. The user's own ⌘Z still works because every mutation is wrapped in `beginUndoGroup`. Agents wanting "one ⌘Z reverts the whole turn" should emit their mutations through `batch`, which wraps the entire loop in one outer group.

Deferred: autosave before run (Phase 2/3), session-level undo group via `batch` (Phase 2), undo history panel (Phase 4).

## Critical ExtendScript quirks

**Array values arrive as strings:** `[0, 0]` arrives as `"[0, 0]"` — use `eval("(" + value + ")")` to parse.

**Use `eval` not `JSON.parse`:** AE 2026's `JSON.parse` returns non-native arrays rejected by the AE C++ API. The dispatch footer always uses `eval("(" + JSON.stringify(args) + ")")`.

**Scale is 3-element `[x, y, z]`:** Passing `[x, y]` leaves `z` as `NaN`. Reconstruct using `property.value` as a template.

**`setTemporalEaseAtKey` needs one `KeyframeEase` per dimension:** Pass `[ease, ease, ease]` for 3D properties.

**Easy Ease:** `KeyframeInterpolationType.EASY_EASE` doesn't exist — use `BEZIER` + `KeyframeEase(0, 33.33)`.

**`Date.toISOString()` missing in ES3:** Build ISO strings manually with `getFullYear()` etc.

**`"EvalScript error."` = bundle-level syntax failure**, not a handler error (those are caught by the footer's try/catch and returned as structured JSON).

**Layer indices are 1-based.** Lower index = renders on top.

## MCP usage rule

**Always use `batch` for more than one command** — collapses N operations into 1 tool call.

```json
{ "commands": [
    { "command": "createTextLayer", "args": { "compName": "Main", "text": "Hello" } },
    { "command": "setLayerKeyframe", "args": { "compName": "Main", "layerIndex": 1, "propertyName": "Opacity", "timeInSeconds": 0, "value": 0 } }
] }
```

Use `stopOnError: true` only when later commands depend on earlier ones succeeding.

## Troubleshooting (full reset)

If commands hang or tests time out — the WS chain is broken. Full reset:
1. `npm run build` + `npm run install-plugin`
2. Restart AE → open **Window → Extensions → MCP Bridge** → wait for "Connected"
3. `npm start` in one terminal, run tests in another

**macOS CEP install path:** `~/Library/Application Support/Adobe/CEP/extensions/com.cubic.ae-mcp-bridge/`
Enable AE scripting: **Settings → Scripting & Expressions → Allow Scripts to Write Files and Access Network**
