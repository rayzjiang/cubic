# Cubic desktop app (`app/`)

Standalone Electron + React desktop shell (Phase 4). It hosts the Node backend
(AE bridge + agent loop) as a child process and connects the renderer to it over
WebSocket. The renderer is a working chat client — message list, persistence-backed
conversation list (Home view), and run controls (send / steer / queue / cancel /
delete). Still deferred: connection-state UX (reconnect banners) and the Stop-button UI.

## Prerequisite — build the backend first

The app spawns `server/ae-bridge/build/serve.js`, which imports the `cubic-ai` brain
(`server/ai`). Build **both** once before running — `cubic-ai` first (the bridge bundle
resolves it at runtime), then the bridge:

```bash
cd ../server/ai        && npm install && npm run build        # emits build/index.js (+ types)
cd ../server/ae-bridge && npm install && npm run build:serve  # emits build/serve.js
```

If the `serve.js` bundle is missing, the app logs a loud error with the build command.
(If `cubic-ai` isn't built, `serve.js` spawns but exits with `ERR_MODULE_NOT_FOUND`; the
app surfaces this via its `[backend] exited UNEXPECTEDLY` log.)

## Develop

```bash
npm install
npm run dev          # electron-vite: builds main/preload, serves the renderer (HMR), launches Electron
```

What to expect:
- A native macOS window (inset traffic-lights + translucent vibrancy). On Windows it
  launches with a normal frame (mac-only chrome is guarded).
- Console: `[backend] ... listening on 127.0.0.1:17923`.
- A Cubic splash (`LoadingScreen`) while the first conversation list loads, then the
  **Home view** (greeting + your conversations + New chat) — or the chat layout if you
  open/start a conversation. This exercises the full chain: spawn → port config →
  `getBackendPort()` IPC → renderer WebSocket → `list`/`conversations`.

## Scripts

- `npm run dev` — dev with HMR
- `npm run build` — production build to `out/`
- `npm run start` — preview the built app
- `npm run typecheck` — type-check main/preload (node) + renderer (web)

## Backend env switch (§B7)

`CUBIC_ENV` (read in `src/main/config.ts`, forwarded to the spawned backend):
- `local` (default) — the agent loop calls Anthropic directly using your
  `ANTHROPIC_API_KEY` (inherited from the shell).
- `prod` — **stub** until the Phase-5 proxy exists; forwards `ANTHROPIC_BASE_URL`
  (from `CUBIC_PROXY_URL`) so the loop routes through the hosted proxy.

## Renderer architecture

- **`protocol.ts`** — typed wire contract mirroring the backend (`AgentEvent`,
  `DisplayItem`, `ConversationMeta`, `ClientMessage`/`ServerMessage`); keep in sync with
  `server/ai/src/agent/events.ts` + `server/ae-bridge/src/{displayItems,persist}.ts` and
  `wsBridge.ts`'s channel-2 contract (see `server/ae-bridge/PROTOCOL.md`).
- **`store.ts`** — Zustand store; folds streamed `agentEvent`s into the render model
  (shares one render path with loaded history).
- **`ws.ts`** — the single backend socket (one-shot startup retry).
- **`analytics.ts`** — no-op `track()` seam (vendor TBD, eg. this for tracking user actions so Id eventually hook up like PostHog).

## Notes / seams

- **Port is owned by main** (`config.ts`): default `17923`, overridable via
  `AE_BRIDGE_PORT`. Main passes it to the child AND answers `getBackendPort()` with the
  same value — it never reads `~/.ae-mcp-bridge/port` (that file is for the
  independently-launched CEP/loopback clients).
- **ESM main**: with `"type":"module"`, electron-vite emits ESM for the main process.
  If a CJS-only native dep ever forces it, drop `"type":"module"` to flip to CJS.
- **Packaging** (signing, electron-builder) is Phase 5; `backend.ts` has an
  `app.isPackaged` path branch as the seam, not implemented here.
