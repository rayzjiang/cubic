# Cubic desktop app (`app/`)

Standalone Electron + React desktop shell (Phase 4). It hosts the Node backend
(AE bridge + agent loop) as a child process and connects the renderer to it over
WebSocket. This is the **foundation** (Wave 1 #2 / WT-FE-FOUNDATION) — the chat UI,
connection-state UX, persistence, and run controls land in later worktrees.

## Prerequisite — build the backend first

The app spawns `server/ae-bridge/build/serve.js`. Build it once before running:

```bash
cd ../server/ae-bridge && npm install && npm run build:serve
```

If the bundle is missing, the app logs a loud error with this exact command.

## Develop

```bash
npm install
npm run dev          # electron-vite: builds main/preload, serves the renderer (HMR), launches Electron
```

What to expect:
- A native macOS window (inset traffic-lights + translucent vibrancy). On Windows it
  launches with a normal frame (mac-only chrome is guarded).
- Console: `[backend] ... listening on 127.0.0.1:17923`.
- The window shows **"backend connected ✓"** — proof of the full chain
  (spawn → port config → `getBackendPort()` IPC → renderer WebSocket).

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

## Notes / seams

- **Port is owned by main** (`config.ts`): default `17923`, overridable via
  `AE_BRIDGE_PORT`. Main passes it to the child AND answers `getBackendPort()` with the
  same value — it never reads `~/.ae-mcp-bridge/port` (that file is for the
  independently-launched CEP/loopback clients).
- **ESM main**: with `"type":"module"`, electron-vite emits ESM for the main process.
  If a CJS-only native dep ever forces it, drop `"type":"module"` to flip to CJS.
- **Packaging** (signing, electron-builder) is Phase 5; `backend.ts` has an
  `app.isPackaged` path branch as the seam, not implemented here.
