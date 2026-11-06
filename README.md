# Cubic

**Motion Copilot for After Effects.** Cubic is an AI agent that builds native After Effects animations and motion graphics from natural language. Ask it to "make this text pop in" or "add a smooth slide transition," and it reads your live AE project, reasons about the motion, and writes the animation directly into your comp — self-healing through any errors along the way.

Built for video editors, not developers: a standalone desktop app with a consumer-style chat UI, no scripting required.

## How it works

```
┌─────────────────┐     IPC      ┌──────────────────┐   Claude calls    ┌────────────────────────────┐
│  Electron app   │◀────────────▶│   Node backend   │──────────────────▶│  Cloudflare Worker proxy   │
│ (React chat UI) │  WebSocket   │  (AE bridge +    │  in prod          │  holds API key + system    │
└─────────────────┘◀────────────▶│   Claude brain)  │  (dev: direct)    │  prompt; gates auth+billing│
                                 └────────┬─────────┘                   └──────────────┬─────────────┘
                                          │ WebSocket (127.0.0.1,                      │
                                          │  OS-assigned port, token)                  ▼
                                          ▼                             Anthropic API · Supabase · Stripe
                                 ┌──────────────────┐
                                 │  CEP extension   │
                                 │  in After Effects│ ── runs ExtendScript
                                 └──────────────────┘
```

1. You type a request in the desktop app.
2. The **Claude brain** (inside the Node backend) fetches live AE state — active comp, selected layers, assets — and reasons about the motion.
3. In the shipped app, that Claude call routes through the **hosted proxy** — a Cloudflare Worker that holds the API key + server-side system prompt, verifies your account + subscription, and meters usage before forwarding to Anthropic. (In local dev the brain calls Anthropic directly, no proxy.)
4. The brain executes **ExtendScript commands** over a local WebSocket bridge into a CEP extension running inside After Effects.
5. If AE throws a compile error, the agent feeds it back to the model and retries — a forward **self-healing loop** (no undo), with a pre-turn `.aep` snapshot for safety.
6. The result appears natively in your AE timeline.

> For the full system design (proxy gating, Supabase/Stripe billing, analytics, packaging), see [`docs/architecture.md`](docs/architecture.md).

## Project structure

This is a monorepo of five independent packages (no root `package.json`).

```
cubic/
├── app/                  # Electron desktop app — React + Zustand + Tailwind chat UI
│   ├── src/main/         #   Electron main: window, IPC, auth/billing/updater/analytics, spawns the backend
│   ├── src/preload/      #   IPC security boundary
│   ├── src/renderer/     #   React chat UI (transcript, sidebar, live agent events)
│   └── src/shared/       #   Shared IPC types
│
├── server/
│   ├── ae-bridge/        # WebSocket bridge + ExtendScript handlers + CEP extension
│   │   ├── src/serve.ts  #   Standalone backend entrypoint (spawned by Electron)
│   │   ├── src/bridge/   #   WS server relaying commands to the CEP worker in AE
│   │   ├── src/scripts/  #   ExtendScript (.jsx) handlers: layers, text, shapes,
│   │   │                 #     animation, effects, masks, footage, markers, etc.
│   │   └── cep-extension/ #  CEP panel running inside AE (runs the bundled .jsx)
│   │
│   └── ai/               # Claude brain — the agent loop
│       ├── src/agent/    #   Iteration loop, tool execution, self-healing, cancel/steer
│       ├── src/context/  #   Live AE state fetching, caching, prompt formatting
│       ├── src/llm/      #   Anthropic SDK wrapper (direct + proxy modes)
│       └── src/bridge/   #   Loopback client into the AE bridge
│
├── proxy/                # Cloudflare Worker — hosted LLM proxy + billing gate + release feed
│   └── src/secrets/      #   System prompt + tool catalog, injected server-side
│
├── supabase/             # Postgres schema + RPCs + Stripe/billing edge functions
│
└── docs/                 # Product + architecture docs (architecture.md, PRD.md, db-schema.md)
```

## Features

- **Natural-language motion design** — describe the animation, get it built natively in AE.
- **Live project awareness** — reads the active comp, selected layers, and assets before acting.
- **Self-healing code loop** — catches ExtendScript errors and retries by reasoning over the error, up to 15 iterations per turn.
- **Pre-turn snapshots** — auto-saves an `.aep` backup before each turn for restore.
- **Stateful sessions** — append-only JSONL transcripts per project; survive crashes and app reloads.
- **Steer & cancel** — queue follow-up messages mid-run; cancel at iteration boundaries (Esc).
- **Context-window safety** — auto-compacts old turns near the limit; full history always preserved on disk.

## Tech stack

| Layer | Tech |
|-------|------|
| Desktop app | Electron, React, Zustand, Tailwind CSS, TypeScript |
| Build | electron-vite, esbuild |
| Transport | WebSocket (`ws`, loopback + per-launch token auth), Electron IPC |
| AI | Anthropic SDK (Claude Sonnet 4.6 default, configurable) |
| AE scripting | ExtendScript via CEP extension |
| Hosted proxy | Cloudflare Workers, Wrangler |
| Auth / billing | Supabase (Postgres + Auth), Stripe |
| Analytics | PostHog |
| Validation / data | Zod, JSON/JSONL files |
| Testing | Vitest + live tests against AE |

## Getting started

**Prerequisites:** Node 18+, After Effects 2024+, and an `ANTHROPIC_API_KEY`.

```bash
# 1. Build the Claude brain
cd server/ai && npm install && npm run build

# 2. Build the AE bridge (and install the CEP extension into AE)
cd ../ae-bridge && npm install && npm run build:serve && npm run install-plugin

# 3. Build & run the app
cd ../../app && npm install && npm run dev
```

Shortcut:
```bash
# The "rebuild everything, don't think" version
cd server/ai        && npm run build
cd server/ae-bridge && npm run build            # build:server + build:serve + build:plugin
cd server/ae-bridge && npm run install-plugin   # only if AE plugin changed (+restart AE)
cd app              && npm run dev              # restart this to pick up fresh backend
```

The app launches a native window, spawns the backend, and connects to After Effects. Open a project in AE, and start chatting.

### Configuration

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Required. Claude API key. |
| `CUBIC_MODEL` | `sonnet` (default), `sonnet5`, `haiku`, or `opus` — switch models without rebuild. |
| `CUBIC_ENV` | `local` (default, direct Anthropic calls) or `prod` (routes through hosted proxy). |

### Run modes (direct vs. proxied)

`CUBIC_ENV` forks where Claude calls go. All three modes share the same code path — only the URLs change.

**direct-local** (default) — the agent loop calls Anthropic directly with your `ANTHROPIC_API_KEY`. No proxy, auth, or billing; fastest inner loop.
```bash
npm run dev
```

**full-stack-local** — routes through a *local* Cloudflare Worker (`wrangler dev`) that verifies the Supabase JWT → checks entitlement → injects the system prompt → meters usage, against local emulators (`supabase start` + Stripe test mode). Add `MOCK_UPSTREAM=1` on the wrangler side for zero Anthropic spend.
```bash
# prereqs, in separate terminals: (cd proxy && npx wrangler dev)  +  supabase start
CUBIC_ENV=prod \
CUBIC_PROXY_URL=http://localhost:8787 \
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_ANON_KEY=<anon key from `supabase status`> \
npm run dev
```

**real-prod** — the identical path, pointed at your deployed Worker + cloud Supabase. Packaged/signed builds **bake** these public values (Supabase URL + anon key, proxy URL, PostHog key) at build time, so the shipped app needs no env vars; the invocation below is how to point a *dev* build at the prod backend.
- Note: No proxy URL set means it goes to anthropic directly
```bash
CUBIC_ENV=prod \
CUBIC_PROXY_URL=https://cubic-proxy.raymondj.workers.dev \
SUPABASE_URL=https://igdbwihwvksraoqghswr.supabase.co \
SUPABASE_ANON_KEY=<anon_key> \
npm run dev
```

### Production build

```bash
cd app
npm run build    # → out/
npm run start    # preview the build
```

## Releasing & shipping updates

Cubic ships as a signed + notarized macOS app that **auto-updates** from a private Cloudflare R2 feed, served read-only through the `cubic-proxy` Worker's `GET /releases/*`. Shipping a new version is two commands.

**One-time setup** (gitignored, in `app/`):
- `app/.env.signing` — `APPLE_ID` · `APPLE_APP_SPECIFIC_PASSWORD` · `APPLE_TEAM_ID` (Developer ID signing + notarization).
- `app/.env.release` — `R2_ACCOUNT_ID` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` (upload to the `cubic-releases` bucket; see `app/.env.release.example`).
- Worker deployed with its R2 binding (`cd proxy && npm run deploy`); the feed URL lives in `app/electron-builder.yml` `publish.url`.

**Ship an update:**
```bash
# 1. Bump app/package.json "version" (e.g. 0.1.0 → 0.1.1). ALWAYS bump — never reuse a shipped number.
rm -rf app/release            # drop stale artifacts from a prior version
cd app
npm run dist                  # build → obfuscate → sign → notarize → staple → dmg + zip + blockmap + latest-mac.yml
npm run release               # upload the signed artifacts + latest-mac.yml to R2
```
`npm run dist` writes `app/release/` — the `.dmg` (fresh installs) plus the `.zip` + `.blockmap` + `latest-mac.yml` (auto-update). `npm run release` uploads them; a shipped version is **immutable** in R2 (re-uploading the same number is refused unless you add `-- --force`).

**Rules of thumb:**
- **Always bump the version** before `dist` — electron-updater keys on the version string, so a client that already downloaded `X` won't cleanly pick up a *different* `X`.
- The `.app` inside the `.zip` is the notarized build → updates apply with **no Gatekeeper reprompt**.
- Roll back by re-pointing `latest-mac.yml` at an older (still-present) version, or `--force` re-releasing.

**How an update reaches users** — electron-updater checks + downloads in the background on launch (and every ~6h), but the swap **applies on the next Cubic restart** (never mid-run) → a non-blocking "restart to update" banner. The AE panel rides **inside** the `.app`, so app + backend + panel travel together; on the post-update launch `provisionBridge()` re-copies the panel **only if it changed** (content hash), and only then is the user nudged to restart After Effects (detected by a panel build-id mismatch).

| Time | What happens | User sees |
|---|---|---|
| You ship | `npm run dist` + `npm run release` → R2 | nothing |
| User's Cubic, next launch/check | downloads the new version in the background | keeps working |
| Download done | update staged (not applied) | "Update ready — Restart now" (non-blocking) |
| User restarts Cubic | new version applies; `provisionBridge` re-copies the panel *iff* it changed | "Restart After Effects to finish" (only if the panel changed) |
| User restarts AE | new panel loads, reconnects | back to work |

## Status

Cubic is functionally complete: the agent brain, AE bridge, hosted proxy + billing gate, packaging (signed + notarized), and background auto-update are all built and working. It is **pre-launch** — not yet publicly released.

See [`docs/architecture.md`](docs/architecture.md) for the system design and [`docs/PRD.md`](docs/PRD.md) for the product vision.
