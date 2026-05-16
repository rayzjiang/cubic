# Migrate AE MCP Bridge: File-Polling → UXP + WebSocket

## Context

The current architecture has the Node.js MCP server write commands to `~/.ae-mcp-bridge/ae_command.json` and the ExtendScript ScriptUI panel poll that file every 2 seconds via `app.scheduleTask`. Every command costs a minimum ~2s round-trip, and there are stale-result races, a dead poll loop that has to be defended against (`autoRunCheckbox` invalid-object errors), and a `batch` command that exists primarily to amortize the polling tax.

Goals of this change:
- Push commands to AE instead of polling — per-command latency drops to ~50-100ms.
- Move off ExtendScript ScriptUI Panels (a dying platform) onto UXP (Adobe's current platform, called out in `docs/PRD.md` as the intended target).
- Preserve the existing MCP tool surface so Claude's calling convention doesn't change.
- Preserve the existing ExtendScript handler logic — all the documented quirks (3-element Scale arrays, `KeyframeEase` per dimension, `eval`-not-`JSON.parse`, manual ISO dates) were earned through pain and stay untouched.

Target architecture:
```
Claude → MCP tool → MCP server (Node.js, hosts WS server on 127.0.0.1:17923)
                       ↕ WebSocket (UXP plugin connects as client on panel open)
                    UXP plugin in AE (main.js)
                       ↓ app.executeScript(bundled handlers + dispatch footer)
                    ExtendScript dispatchCommand → existing domain handlers
```

## Decisions (confirmed with user)

1. **Keep ExtendScript handlers**, invoke them via `app.executeScript()` from UXP. Don't rewrite ~35 handlers in UXP's native AE API.
2. **Hard cutover, single PR.** Delete file-polling code; the old ScriptUI panel can stay harmlessly installed in AE.
3. **Migrate tests to WebSocket** — rewrite `tests/helpers.mjs` `send()` so each domain suite is unchanged.

## File-by-file plan

### NEW: `server/mcp/src/bridge/wsBridge.ts`

Exports a singleton `AEBridge`:
```ts
class AEBridge {
  start(port: number): Promise<void>          // bind WS server on 127.0.0.1
  sendCommand(cmd: string, args: object, timeoutMs?: number): Promise<string>
  isConnected(): boolean
  on(event: 'connect' | 'disconnect', handler: () => void): void
}
```
Internals:
- One `WebSocketServer` from `ws` bound to `127.0.0.1:17923` (override via `AE_MCP_PORT` env var, +1 fallback up to 5 times if port is taken; persist chosen port to `~/.ae-mcp-bridge/port` so the plugin can read it).
- Single-client invariant: on `'connection'`, close any prior `currentClient` with code 4000. Last-connect-wins.
- Wire format: outbound `{ id, command, args }`, inbound `{ id, ok, result?, error? }`. IDs from `crypto.randomUUID()` (no new dep — Node 19+).
- `pending: Map<id, {resolve, reject, timer}>`. `sendCommand` stashes resolvers, calls `currentClient.send(JSON.stringify(...))`, arms timeout.
- If `currentClient` is null at call time: wait up to 3s for first connection, then reject with friendly "AE UXP plugin not connected — open the MCP Bridge panel in AE."
- On disconnect: reject all pending with `"AE plugin disconnected"`.

### MODIFIED: `server/mcp/src/index.ts`

**Remove:** `getAETempDir`, `readResultsFromTempFile`, `waitForBridgeResult`, `writeCommandFile`, `clearResultsFile`, the `fs`/`os` imports. Roughly halves the file.

**Rewrite every tool handler** to one shape:
```ts
async (params) => {
  try {
    const result = await bridge.sendCommand("applyEffect", params, 10000);
    return { content: [{ type: "text", text: result }] };
  } catch (e) {
    return { content: [{ type: "text", text: `Error: ${String(e)}` }], isError: true };
  }
}
```
Applies to: `runScript` (keeps the `allowedScripts` allowlist guard), `createComposition`, `setLayerKeyframe`, `setLayerExpression`, `setKeyframeEasing`, `applyEffect`, `applyEffectTemplate`, `runBridgeTest`, and the `compositions` resource. For `batch`, raise default timeout to 30000ms (handlers run synchronously on AE's UI thread).

**`getResults`**: keep as a no-op compat shim returning `bridge.lastResult` (cached after each successful sendCommand). Mark deprecated in description. New tools are synchronous — Claude no longer needs `getResults`.

**`testAnimation`**: unchanged (writes a one-shot `.jsx` to `/tmp` for manual `File → Run Script File`; not part of the bridge).

**`main()`**: `await bridge.start(port)` before `server.connect(transport)`.

### NEW: `server/mcp/uxp-plugin/` (UXP plugin scaffold)

```
uxp-plugin/
  manifest.json
  index.html
  src/
    main.js                   ← bundled entry: WS client + dispatch
  scripts/                    ← copied from src/scripts/* at build time
    mcp-bridge.jsx            ← stripped-down version of mcp-bridge-auto.jsx
    compositions.jsx          ← unchanged
    layers.jsx                ← unchanged
    animation.jsx             ← unchanged
    masks.jsx                 ← unchanged
    effects.jsx               ← unchanged
    footage.jsx               ← unchanged
  icons/icon.png
```

**`manifest.json`** (UXP manifest v6):
```json
{
  "id": "com.cubic.ae-mcp-bridge",
  "name": "MCP Bridge",
  "version": "2.0.0",
  "main": "index.html",
  "manifestVersion": 6,
  "host": [{ "app": "AEFT", "minVersion": "24.0.0" }],
  "entrypoints": [{
    "type": "panel",
    "id": "mcpBridgePanel",
    "label": { "default": "MCP Bridge" },
    "minimumSize": { "width": 230, "height": 200 }
  }],
  "requiredPermissions": {
    "network": { "domains": ["ws://127.0.0.1:17923", "ws://localhost:17923"] },
    "localFileSystem": "plugin"
  }
}
```

**`index.html`**: minimal — status line, reconnect button, last-error textarea, port input. `<script src="src/main.js"></script>`.

**`src/main.js` responsibilities:**
1. On panel boot: `loadExtendScript()` reads bundled `handlers.bundled.jsx` from the plugin folder via UXP's `storage.localFileSystem` and caches the source string.
2. `connect()`: `new WebSocket("ws://127.0.0.1:17923")` with exponential backoff (1s → 2s → 5s → 10s cap).
3. `ws.onmessage`: parse `{ id, command, args }`, call `executeCommand(command, args)`, send `{ id, ok, result }` or `{ id, ok: false, error }` back.
4. `executeCommand(command, args)`: build script source = `HANDLERS_BUNDLE + dispatch footer` (see §"Dispatch" below) and call `app.executeScript({ script: source })`. Await its string return value.
5. UI: connection status, reconnect button, last error. Keep under ~80 LOC.

### NEW: `server/mcp/scripts/build-uxp-plugin.mjs`

Build pipeline for the UXP plugin:
1. Concatenate `src/scripts/{compositions,layers,animation,masks,effects,footage,mcp-bridge}.jsx` into `uxp-plugin/dist/handlers.bundled.jsx`. This replaces the `//@include` preprocessor directive (UXP doesn't run the ExtendScript Toolkit preprocessor). Preserve the JSON polyfill block at the top.
2. esbuild `uxp-plugin/src/main.js` → `uxp-plugin/dist/main.js` (`format: iife`, `target: es2020`, `platform: browser`).
3. Copy `manifest.json`, `index.html`, `icons/` into `uxp-plugin/dist/`.

### NEW: `server/mcp/src/scripts/mcp-bridge.jsx`

Rewrite of `mcp-bridge-auto.jsx` with all transport/UI code stripped. Keeps:
- JSON polyfill (ES3, still needed because the ExtendScript engine called by `executeScript` is the same).
- `dispatchCommand(command, args)` switch.
- `batch(args)` function.

Removes:
- ScriptUI panel construction (`new Window`, `panel.add`, etc).
- `app.scheduleTask` poll loop, `checkForCommands`, `executeCommand` wrapper, `updateCommandStatus`.
- File I/O helpers (`getCommandFilePath`, `getResultFilePath`, the write logic in `executeCommand`).
- `//@include` directives (replaced by the build-time bundling).

The result is a pure-function module — exactly what `executeScript` wants.

### Dispatch flow (concrete)

From `main.js`:
```js
const footer = `(function(){
  try {
    var __r = dispatchCommand(${JSON.stringify(command)}, ${JSON.stringify(args)});
    return (typeof __r === "string") ? __r : JSON.stringify(__r);
  } catch (e) { return JSON.stringify({ status:"error", message: e.toString(), line: e.line }); }
})();`;
const source = HANDLERS_BUNDLE + "\n" + footer;
const result = await require('uxp').host.executeScript({ script: source });  // verify exact API in §Risks
```
The dispatch table itself (`dispatchCommand`'s switch) is unchanged from today. `batch` is unchanged. UXP `main.js` is a thin transport — it never branches on command name.

### MODIFIED: `server/mcp/install-bridge.js` → `server/mcp/install-uxp-plugin.js`

Replace the file. New responsibilities:
- **Primary path:** print instructions to use Adobe's UXP Developer Tool (UDT) → "Add Plugin" → select `uxp-plugin/dist/manifest.json` → "Load". UDT handles the install location and supports hot reload.
- **Manual install fallback:** copy `uxp-plugin/dist/` to:
  - macOS: `~/Library/Application Support/Adobe/UXP/Plugins/External/com.cubic.ae-mcp-bridge/`
  - Windows: `%APPDATA%\Adobe\UXP\Plugins\External\com.cubic.ae-mcp-bridge\`
- Keep the network-permission reminder: AE → Settings → Scripting & Expressions → "Allow Scripts to Write Files and Access Network".
- Delete the old `Scripts/ScriptUI Panels/` copy logic.

### MODIFIED: `server/mcp/package.json`

Add deps:
- `"ws": "^8.18.0"`
- `"@types/ws": "^8.5.10"` (dev)

Update scripts:
```json
"build:server":   "esbuild src/index.ts --bundle --platform=node --format=esm --outfile=build/index.js --packages=external",
"build:plugin":   "node scripts/build-uxp-plugin.mjs",
"build":          "npm run build:server && npm run build:plugin",
"install-plugin": "node install-uxp-plugin.js",
"start":          "node build/index.js"
```

Remove `copyfiles` of `src/scripts/**` to `build/` — handlers no longer ship with the server. Remove the old `install-bridge` script.

### MODIFIED: `server/mcp/test-integration.mjs` (and `tests/helpers.mjs`)

Rewrite `tests/helpers.mjs` `send(command, args)` to:
1. Open a single persistent WebSocket to `ws://127.0.0.1:17923` (lazy on first call, reuse across all suites).
2. Send `{ id, command, args }`, await `{ id, ok, result }`, return `result`.

Each domain suite (`tests/compositions.mjs`, `layers.mjs`, `animation.mjs`, `masks.mjs`, `effects.mjs`, `batch.mjs`) needs **no changes** — they call `send()` and that's the only contract.

Replace the `BRIDGE_DIR`-existence preflight in `main()` with a WS connect-with-timeout preflight that prints: "Start the MCP server (`npm start`) and open the MCP Bridge UXP panel in AE."

### DELETE

- `server/mcp/src/scripts/mcp-bridge-auto.jsx` (replaced by `mcp-bridge.jsx`)
- `server/mcp/install-bridge.js` (replaced by `install-uxp-plugin.js`)
- The `~/.ae-mcp-bridge/ae_command.json` and `ae_mcp_result.json` files become unused at runtime. The `port` file (if used for fallback) lives there.

### MODIFIED: `server/mcp/CLAUDE.md`

Update the architecture section, workflow tables, and "When to restart what" matrix to reflect:
- AE side is now a UXP plugin loaded via UDT or manual install
- Server side hosts a WS endpoint
- Editing `.jsx` handlers → rebuild plugin (`npm run build:plugin`) + reload plugin in UDT (no AE restart needed)
- Editing `index.ts` → `npm run build:server` + restart Claude Code

## Risks to validate before implementing

1. **`executeScript` API name in AE 2026.** Confirm whether the call is `require('uxp').host.executeScript({script})` or `require('aftereffects').app.executeScript(script)`. A 30-minute spike: create a stub UXP panel, load it via UDT, log `require('uxp').host` and `require('aftereffects')`. If neither path exposes ExtendScript, the plan needs to fall back to native UXP AE API for at least some handlers.
2. **`executeScript` return-value size.** A heavy `listCompositions` can serialize to 50+ KB. If UXP truncates, fall back to writing the result to a UXP-local temp file and reading it back from `main.js` — defeats most of the latency win, so test early.
3. **localhost network permission.** Some Adobe apps exempt 127.0.0.1; some don't. Verify with a stub before relying on the manifest entry.
4. **`executeScript` blocks AE's UI thread.** Long handlers (mass `batchSetLayerProperties`) will freeze the UI. Today's 2s poll cycle masked nothing — handlers already ran synchronously — but confirm the 30s `batch` timeout in `sendCommand` is enough headroom.
5. **Single-client invariant under panel reopen.** When the panel closes/reopens, the new instance reconnects. Verify in-flight commands surface a clean error rather than hang the MCP tool call — the `sendCommand` timeout covers this, but worth a unit test.

## Critical files

- `/Users/raymondjiang/Desktop/Coding/cubic/server/mcp/src/index.ts` (modified — tool handlers rewritten, file I/O helpers removed)
- `/Users/raymondjiang/Desktop/Coding/cubic/server/mcp/src/bridge/wsBridge.ts` (new — WS server + correlation IDs)
- `/Users/raymondjiang/Desktop/Coding/cubic/server/mcp/src/scripts/mcp-bridge.jsx` (new — stripped from `mcp-bridge-auto.jsx`)
- `/Users/raymondjiang/Desktop/Coding/cubic/server/mcp/uxp-plugin/` (new directory — manifest, html, main.js, bundled handlers)
- `/Users/raymondjiang/Desktop/Coding/cubic/server/mcp/scripts/build-uxp-plugin.mjs` (new — handler concatenation + main.js bundle)
- `/Users/raymondjiang/Desktop/Coding/cubic/server/mcp/install-uxp-plugin.js` (replaces `install-bridge.js`)
- `/Users/raymondjiang/Desktop/Coding/cubic/server/mcp/package.json` (deps + scripts)
- `/Users/raymondjiang/Desktop/Coding/cubic/server/mcp/test-integration.mjs` + `tests/helpers.mjs` (transport swap; suites untouched)
- `/Users/raymondjiang/Desktop/Coding/cubic/server/mcp/CLAUDE.md` (docs)

## Verification

1. **Smoke test the WS bridge alone:**
   - `npm run build && npm start` — server should log "WS bridge listening on 127.0.0.1:17923".
   - From a scratch script: open a WS client, send `{ id:"1", command:"getProjectInfo", args:{} }`, expect `{ id:"1", ok:true, result:"..." }` within 500ms once the plugin is connected.

2. **Install plugin in AE via UDT:**
   - Open UDT → Add Plugin → select `uxp-plugin/dist/manifest.json` → Load.
   - AE → Window → MCP Bridge — panel docks. Status should flip to "Connected".

3. **Latency check:**
   - Call `mcp__AfterEffectsMCP__createComposition` from Claude. Measure wall-clock — should be < 200ms (vs ~2s today).

4. **Run the test suite:**
   - `npm test` (read-only) — all 6 domain suites should pass through the new WS transport with no source changes to individual suites.
   - `npm run test:write-clean` — full create + cleanup cycle in AE; confirms keyframes/effects/masks all round-trip correctly.

5. **Reconnect resilience:**
   - With server running and Claude mid-tool-call, close the UXP panel in AE. The in-flight call should error within the timeout. Reopen the panel → next tool call succeeds.
   - Restart `npm start` while panel is open. The panel's reconnect backoff should grab the new server within 10s.

6. **Batch correctness:**
   - `runScript("batch", { commands: [...] })` with mixed read/write commands. The server-side timeout for batch should be 30s; result should be the same `{ total, succeeded, failed, results }` shape as today.
