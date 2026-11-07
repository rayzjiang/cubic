# Cubic desktop app (`app/`)

Standalone Electron + React desktop shell. It hosts the Node backend
(AE bridge + agent loop) as a child process and connects the renderer to it over
WebSocket. The renderer is a full chat client — message list, persistence-backed
conversation list (Home view), run controls (send / steer / queue / cancel / delete /
stop), connection-state UX (an AE status dot with reconnect / "restart AE" banners),
plus the auth, billing, and Settings surfaces.

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
- Console: `[backend] WS bridge listening on 127.0.0.1:<port>` (an OS-assigned dynamic port).
- A Cubic splash (`LoadingScreen`) while the first conversation list loads, then the
  **Home view** (greeting + your conversations + New chat) — or the chat layout if you
  open/start a conversation. This exercises the full chain: spawn → backend reports `{port, token}`
  up → `getBackendPort()` IPC → renderer WebSocket (authed `hello`) → `list`/`conversations`.

## Scripts

- `npm run dev` — dev with HMR
- `npm run build` — production build to `out/`
- `npm run start` — preview the built app
- `npm run typecheck` — type-check main/preload (node) + renderer (web)

## Backend env switch

`CUBIC_ENV` (read in `src/main/config.ts`, forwarded to the spawned backend):
- `local` (default) — the agent loop calls Anthropic directly using your
  `ANTHROPIC_API_KEY` (inherited from the shell).
- `prod` — routes through the hosted Cloudflare Worker proxy: main forwards
  `ANTHROPIC_BASE_URL` (from `CUBIC_PROXY_URL`) and the renderer attaches the user's
  Supabase JWT per request, so the Worker verifies auth, checks entitlement, and meters
  usage. Packaged builds bake the prod config, so a signed app needs no env vars.

## Worker-served config

A packaged app has an empty `process.env`, so the frozen public values are **baked** at build time
(`.env.production` → electron-vite `define`). Five values instead come from the Worker so they can change
without an app release: `CUBIC_MODEL` and the agent-loop tuning knobs (`CUBIC_MAX_ITERATIONS`,
`CUBIC_COMPACT_THRESHOLD`, `CUBIC_KEEP_RECENT_TURNS`, `CUBIC_CONTEXT_WINDOW`). Owned by
`src/main/remoteConfig.ts`; the Worker side is `proxy/src/config.ts`.

Stale-while-revalidate, never on the request path: at launch the disk cache
(`~/.cubic/remote-config.json`) is read **synchronously** and forwarded into `childEnv` before the backend
spawns; a single background `GET /config` (12h floor) then writes the cache for the **next** launch. So a
config change lands on a user's second relaunch — nothing blocks startup and nothing changes mid-session.

- **Precedence:** local env var → cached Worker config → baked in-code default. An env var you set
  yourself always wins, so `CUBIC_MODEL=haiku` stays Haiku in full-stack-local instead of being swapped
  for the Worker's model mid-test. (Moot in real prod, where `process.env` is empty.)
- **Bad values:** validated per key against generous sanity bounds on both fetch and read (the cache is a
  hand-editable JSON file). Invalid → last known-good → baked default, and a `config_value_rejected`
  analytics event fires. Only in dev does `CUBIC_ENV=local` skip the fetch entirely.

## Renderer architecture

- **`protocol.ts`** — typed wire contract mirroring the backend (`AgentEvent`,
  `DisplayItem`, `ConversationMeta`, `ClientMessage`/`ServerMessage`); keep in sync with
  `server/ai/src/agent/events.ts` + `server/ae-bridge/src/{displayItems,persist}.ts` and
  `wsBridge.ts`'s channel-2 contract (see `server/ae-bridge/PROTOCOL.md`).
- **`store.ts`** — Zustand store; folds streamed `agentEvent`s into the render model
  (shares one render path with loaded history).
- **`ws.ts`** — the single backend socket (one-shot startup retry).
- **`analytics.ts`** — forwards user-action events over IPC to the main-process PostHog
  client (`src/main/analytics.ts`), which stamps identity + a strict property whitelist.
  Off unless a PostHog key is present.

## Notes / seams

- **Port + token are owned by the backend**: the backend OS-assigns its WS port
  (`bind 127.0.0.1:0`, overridable via `AE_BRIDGE_PORT` for tests) and mints a per-launch session
  token, then reports `{port, token}` UP to main over the child IPC channel. `getBackendPort()`
  relays them to the renderer, which echoes the token in its first `hello` frame. The backend also
  writes `~/.cubic/conn.json` for the independently-launched CEP/loopback clients.
- **ESM main**: with `"type":"module"`, electron-vite emits ESM for the main process.
  If a CJS-only native dep ever forces it, drop `"type":"module"` to flip to CJS.
- **Packaging** (signing, notarization, electron-builder, auto-update) is implemented in
  `scripts/dist.mjs` + `electron-builder.yml`; `backend.ts` has the `app.isPackaged` path
  branch for the bundled backend. See [`docs/updates.md`](../docs/updates.md).
