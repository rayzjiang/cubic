# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build:server   # Compile src/index.ts → build/index.js
npm run build:plugin   # Bundle CEP extension → cep-extension/dist/
npm run build          # Both of the above
npm run install-plugin # Copy extension to Adobe CEP folder + enable PlayerDebugMode
npm start              # Run the MCP server (opens WS bridge on 127.0.0.1:17923)
```

## When to restart what

| What changed | What to run | What to reload |
|---|---|---|
| Any `src/scripts/*.jsx` handler | `npm run build:plugin` + `npm run install-plugin` | Close + reopen MCP Bridge panel in AE (Window → Extensions → MCP Bridge) |
| `src/index.ts` | `npm run build:server` | Restart Claude Code |
| `src/bridge/wsBridge.ts` | `npm run build:server` | Restart Claude Code |
| Both server and plugin | `npm run build` + `npm run install-plugin` | Reopen panel + restart Claude Code |

**Why:**
- The CEP panel loads its bundled handlers fresh on each command — after `build:plugin` + `install-plugin`, close and reopen the panel. No AE restart needed for handler changes.
- The MCP server (`build/index.js`) is loaded when Claude Code starts — restart CC to pick up server changes.

## Workflows

**Editing any bridge script (`src/scripts/*.jsx`):**
1. Edit the file
2. `npm run build:plugin`
3. `npm run install-plugin`
4. In AE: close + reopen the MCP Bridge panel (Window → Extensions → MCP Bridge)
5. No AE restart needed

**Editing the MCP server (`src/index.ts` or `src/bridge/wsBridge.ts`):**
1. Edit the file
2. `npm run build:server`
3. Restart Claude Code

## Architecture

Two runtime components communicate over WebSocket:

### 1. Node.js MCP Server (`src/index.ts` → `build/index.js`)
- Implements MCP using `@modelcontextprotocol/sdk`
- **Hosts a WebSocket server** on `127.0.0.1:17923` (override with `AE_MCP_PORT` env var)
- Exposes dedicated tools (all camelCase): `runScript`, `getResults` (deprecated shim), `getHelp`, `runBridgeTest`, `testAnimation`, `createComposition`, `setLayerKeyframe`, `setLayerExpression`, `setKeyframeEasing`, `applyEffect`, `applyEffectTemplate`
- All other commands route through `runScript` using the `allowedScripts` allowlist — **any new command must be added here** or it will be rejected
- Results are returned synchronously — no `getResults` needed anymore

### 2. CEP Panel (`cep-extension/`) in After Effects
- A CEP panel (HTML/JS in CEF/Chromium) that connects to the MCP server's WS endpoint as a client
- Sends `{ type: "hello" }` on connect to register as the ExtendScript worker
- Receives `{ id, command, args }` from the server
- Executes commands via `new CSInterface().evalScript(handlersBundle + dispatchFooter, callback)`
- Sends `{ id, ok, result }` or `{ id, ok: false, error }` back to the server

### Bridge script file structure

`mcp-bridge.jsx` is the dispatch module. It is **concatenated** with domain files by `build-cep-extension.mjs` at build time:

```
handlers.bundled.jsx (generated):
  compositions.jsx     ← getProjectInfo, listCompositions, createComposition, setCompositionProperties
  layers.jsx           ← getLayerInfo, createTextLayer, createShapeLayer, createSolidLayer,
  |                       createCamera, createLightLayer, createNullLayer, duplicateLayer,
  |                       setLayerProperties, batchSetLayerProperties, setLayerParent,
  |                       moveLayer, deleteLayer
  animation.jsx        ← getLayerKeyframes, setLayerKeyframe, setLayerExpression,
  |                       setKeyframeEasing, removePropertyKeyframes, getLayerExpressions
  masks.jsx            ← getLayerMasks, setLayerMask, deleteLayerMask
  effects.jsx          ← getLayerEffects, applyEffect, applyEffectTemplate, setEffectProperty, deleteEffect
  footage.jsx          ← deleteUnusedSolids
  mcp-bridge.jsx       ← JSON polyfill + dispatchCommand() + batch()
```

### Communication flow
```
Claude → MCP tool call → bridge.sendCommand(command, args)
                              ↓ WS: { id, command, args }
                         CEP panel in AE (HTML/JS via CSInterface)
                              ↓ evalScript(handlersBundle + footer, cb)
                         ExtendScript → handler → result string
                              ↑ WS: { id, ok: true, result }
                         bridge.sendCommand resolves → returns to Claude
```

## Installing the CEP Panel

Run `npm run install-plugin` — this copies `cep-extension/dist/` to the Adobe CEP folder and enables `PlayerDebugMode` (required for unsigned extensions).

**macOS install path:** `~/Library/Application Support/Adobe/CEP/extensions/com.cubic.ae-mcp-bridge/`
**Windows install path:** `%APPDATA%\Adobe\CEP\extensions\com.cubic.ae-mcp-bridge\`

Run `npm run install-plugin:dry` to preview the paths and commands without making changes.

After installing:
1. Restart After Effects.
2. Open: **Window → Extensions → MCP Bridge**
3. The panel shows "Connecting…" → "Connected" once `npm start` is running.

**IMPORTANT:** Enable AE scripting permissions:
- macOS: After Effects → Settings → Scripting & Expressions
- Windows: Edit → Preferences → Scripting & Expressions
- Enable: **"Allow Scripts to Write Files and Access Network"**

## Troubleshooting

**Tests time out / commands hang:**
The test harness and Claude both route through the WS bridge to the CEP panel. If anything in that chain is missing, every command will time out (30s).

Full reset sequence:
1. `npm run build` — rebuild server + extension from scratch
2. `npm run install-plugin` — push fresh build into CEP folder
3. Restart AE (picks up the new install)
4. `npm start` — start the WS bridge (must be running before tests)
5. AE: **Window → Extensions → MCP Bridge** — wait for "Connected"
6. Run tests in a second terminal

**Panel shows "Disconnected" after `npm start`:**
The panel connects on load. If the server started after AE was already open, click **Reconnect** in the panel — it will reconnect within a few seconds.

**Old `.jsx` scripts reappear in AE's Window menu:**
These are leftover ScriptUI panel scripts from the old polling architecture. Delete them:
```bash
cd "/Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels"
rm animation.jsx applyEffect.jsx applyEffectTemplate.jsx compositions.jsx \
   createComposition.jsx createShapeLayer.jsx createSolidLayer.jsx createTextLayer.jsx \
   effects.jsx footage.jsx getLayerInfo.jsx getProjectInfo.jsx keyframes.jsx \
   layers.jsx listCompositions.jsx masks.jsx mcp-bridge-auto.jsx \
   setLayerProperties.jsx solids.jsx
```
Restart AE. Only `Create Nulls From Paths.jsx` and `VR Comp Editor.jsx` (Adobe's own) should remain.

## Available bridge commands

**Compositions** (`compositions.jsx` — CRUD: C✓ R✓ U✓ D✓):
`getProjectInfo`, `listCompositions`, `createComposition`, `setCompositionProperties`, `deleteComposition`

**Layers** (`layers.jsx` — CRUD: C✓ R✓ U✓ D✓):
`getLayerInfo`, `createTextLayer`, `createShapeLayer`, `createSolidLayer`, `createCamera`, `createLightLayer`, `createNullLayer`, `duplicateLayer`, `setLayerProperties`, `batchSetLayerProperties`, `setLayerParent`, `moveLayer`, `deleteLayer`

**Keyframes & Expressions** (`animation.jsx` — Keyframes: C✓ R✓ U✓ D✓ / Expressions: C✓ R✓ U✓ D✓):
`getLayerKeyframes`, `setLayerKeyframe`, `setKeyframeEasing`, `removePropertyKeyframes`, `setLayerExpression`, `getLayerExpressions`

**Masks** (`masks.jsx` — CRUD: C/U✓ R✓ D✓):
`getLayerMasks`, `setLayerMask`, `deleteLayerMask`

**Footage** (`footage.jsx` — CRUD: C✗ R✗ U✗ D✓):
`deleteUnusedSolids`

**Effects** (`effects.jsx` — CRUD: C✓ R✓ U✓ D✓):
`getLayerEffects`, `applyEffect`, `applyEffectTemplate`, `setEffectProperty`, `deleteEffect`

**Batch** (`mcp-bridge.jsx`):
`batch` — run multiple commands in one round-trip (strongly preferred)

## Domain file conventions

All AE handler functions **must** live in a domain file (`src/scripts/*.jsx`), never in `mcp-bridge.jsx`. This keeps the dispatch module small and makes each domain independently readable and testable.

`mcp-bridge.jsx` owns exactly three things — no more:
- JSON polyfill
- `dispatchCommand()` switch + `batch()`
- (No UI, no file I/O, no scheduling)

**When to add to an existing domain vs. create a new one:**

| Situation | Action |
|---|---|
| New operation on an existing AE object type | Add to the matching domain file |
| New AE object type with 3+ operations | Create a new `<domain>.jsx` |
| Shared helper used by 2+ domains | Add a `helpers.jsx` and add to build order in `build-cep-extension.mjs` |

**Adding a new domain file:**
1. Create `src/scripts/<domain>.jsx` with handler functions
2. Add `<domain>.jsx` to the `domainFiles` array in `scripts/build-cep-extension.mjs`
3. Add the new `case` entries to `dispatchCommand()` in `mcp-bridge.jsx`
4. Add command names to `allowedScripts` in `src/index.ts`
5. `npm run build:plugin` + `npm run install-plugin` + reopen panel in AE

## Adding a new command

1. Add the handler function to the appropriate domain file in `src/scripts/`
2. Add a `case` for it in `dispatchCommand()` in `mcp-bridge.jsx`
3. Add the name to `allowedScripts` in `src/index.ts`
4. Optionally add a dedicated MCP tool in `src/index.ts` (for commands that benefit from typed Zod schemas)
5. `npm run build:plugin` + `npm run install-plugin` + reopen panel (+ `npm run build:server` + restart CC if `index.ts` changed)

## Critical ExtendScript quirks

**Array values arrive as strings from `z.unknown()`:** When Claude passes `[0, 0]` it arrives as the string `"[0, 0]"`. `setLayerKeyframe` handles this with `eval("(" + value + ")")`.

**Use `eval` not `JSON.parse` for command parsing:** AE 2026's `JSON.parse` returns non-native arrays rejected by the AE C++ API in `setValueAtTime`. The dispatch footer always passes args through `eval("(" + JSON.stringify(args) + ")")`.

**Scale is 3-element `[x, y, z]`:** Passing `[x, y]` leaves element 2 as `NaN`. The keyframe setter reconstructs arrays using `property.value` as a template, falling back to current values for missing dimensions.

**`setTemporalEaseAtKey` requires one `KeyframeEase` per dimension:** For a 3D property like Scale, pass `[ease, ease, ease]` not `[ease]`. Use `keyInTemporalEase(ki).length` to get the dimension count dynamically.

**`KeyframeInterpolationType.EASY_EASE` does not exist:** Easy Ease = `BEZIER` interpolation with `KeyframeEase(0, 33.33)`.

**`Date.toISOString()` does not exist in ExtendScript (ES3):** Build ISO strings manually with `getFullYear()`, `getMonth()` etc.

**CEP `evalScript` returns `"EvalScript error."` on syntax failures:** This is a CEP sentinel string — not a real error message. Handler-level errors are already caught by the dispatch footer's try/catch and returned as structured JSON, so this sentinel only fires on bundle-level syntax problems.

**Layer indices:** All AE API collections are 1-based. Lower index = renders on top in the layer stack.

## MCP usage rule

**Use `batch` when executing more than one command.** Each individual command costs 1 tool call. `batch` collapses any number of sub-commands into 1 tool call total (no more `getResults` overhead).

```json
{ "commands": [
    { "command": "getLayerExpressions", "args": { "compName": "My Comp", "layerIndex": 1 } },
    { "command": "getLayerExpressions", "args": { "compName": "My Comp", "layerIndex": 2 } }
] }
```

Use `stopOnError: true` only when later commands depend on earlier ones succeeding.
