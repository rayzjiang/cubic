# Cubic — Architecture

System design of the whole Cubic codebase. This is the map; each subsystem has a deeper doc that owns the detail, and this file links to it rather than duplicating it (so those docs stay the single source of truth).

Cubic is an Electron desktop app that drives Adobe After Effects (AE) from natural language. A local Claude agent loop reads the live AE project, reasons about the motion, and writes animations into the comp by running ExtendScript through a CEP panel inside AE. In production, Claude calls route through a Cloudflare Worker that holds the API key + system prompt, verifies the user, checks their subscription, and meters usage; Supabase + Stripe back auth and billing.

## Packages

A monorepo of five independent packages, no root `package.json`.

| Package | Role | Deeper doc |
|---|---|---|
| `app/` | Electron desktop app (main + preload + renderer). Owns windows, auth, billing display, updates, analytics, and spawns the backend. | [`app/README.md`](../app/README.md) |
| `server/ae-bridge/` | Node backend the app spawns: the WebSocket hub, the ExtendScript `.jsx` handlers, and the invisible CEP panel. Hosts the agent loop in-process. | [`server/ae-bridge/CLAUDE.md`](../server/ae-bridge/CLAUDE.md), [`PROTOCOL.md`](../server/ae-bridge/PROTOCOL.md) |
| `server/ai/` | The Claude "brain" — agent loop, context pipeline, LLM wrapper. Consumed by `ae-bridge` as `cubic-ai` (`file:../ai`). | [`server/ai/CLAUDE.md`](../server/ai/CLAUDE.md) |
| `proxy/` | Cloudflare Worker: the hosted LLM proxy + billing gate, the server-side system prompt + tool catalog, and the read-only release feed. | [`proxy/CLAUDE.md`](../proxy/CLAUDE.md) |
| `supabase/` | Postgres schema + RPCs + Deno edge functions (Stripe checkout/portal/webhook, billing details, account deletion). | [`supabase/README.md`](../supabase/README.md), [`db-schema.md`](./db-schema.md) |

## Component diagram

```
┌──────────────────────── DESKTOP (one machine, 127.0.0.1) ───────────────────────────┐
│                                                                                      │
│  ┌────────────────────┐    IPC (contextBridge)   ┌───────────────────────────────┐   │
│  │ Renderer            │◀────────────────────────▶│ Main process                  │   │
│  │ React · Zustand     │   window.cubic.*         │ auth · billing · analytics    │   │
│  │ App.tsx · ws.ts     │                          │ updater · BackendSupervisor   │   │
│  └─────────┬──────────┘                           │ installBridge · config        │   │
│            │ WS (dynamic port, token, role:'ui')  └──────────────┬────────────────┘   │
│            ▼                                        spawn (ELECTRON_RUN_AS_NODE)       │
│  ┌────────────────────────────────────────────┐                 │                     │
│  │ Node backend (server/ae-bridge · serve.js) │◀── ~/.cubic/conn.json {port, token}  │
│  │ wsBridge (WS hub · token auth · dyn port)  │── persist ▶ ~/.cubic/sessions/*.jsonl │
│  │ agentChat (steer · persist · reattach)     │             ~/.cubic/.cubic-backups/  │
│  │  ┌──────────────────────────────────────┐  │             ~/.cubic/frames/          │
│  │  │ cubic-ai brain (in-process)          │  │                                       │
│  │  │ runAgentTurn · executeTool · context │  │                                       │
│  │  │ llm/anthropic (forks on CUBIC_ENV)   │  │                                       │
│  │  └──────┬─────────────────┬─────────────┘  │                                       │
│  └─────────┼ loopback WS ────┼─────────────────┘                                      │
│            │ role:'loopback' │ command channel                                        │
│            ▼                 ▼                                                         │
│  ┌───────────────────────────────────┐   evalScript(handlers + footer)                │
│  │ CEP panel (invisible ext in AE)   │──────────────▶ After Effects (ExtendScript)     │
│  │ role:'worker' · fs.watch conn.json│                                                │
│  └───────────────────────────────────┘                                                │
└───────┬───────────────────────────────────────────────┬──────────────────────────────┘
        │ prod: ANTHROPIC_BASE_URL                       │ system browser
        │ (direct-local skips the Worker)                ▼ OAuth / Checkout / Portal
        ▼                                        ┌────────────────┐  cubic:// deep link back
┌─────────────────────────────────┐             │ System browser │──────────────────────┐
│ Cloudflare Worker (cubic-proxy) │             └───────┬────────┘                      │
│ POST /v1/messages:              │   verify JWT +      │                               │
│  IP→JWT(JWKS)→user-limit→       │   service-role RPC  ▼                               │
│  entitlement→allowlist→inject   │──────────▶┌─────────────────────┐  webhook  ┌────────┐
│  secrets→Anthropic→tee→meter    │           │ Supabase            │◀─────────▶│ Stripe │
│ GET /releases/*: R2 feed (open) │           │ Postgres + Auth +   │           └────────┘
└──────┬──────────────┬───────────┘           │ edge functions      │◀── OAuth (PKCE) ──┘
       ▼              ▼ R2                      │ plans/subs/usage    │
 api.anthropic.com  cubic-releases             │ get_entitlement …   │
                                               └─────────────────────┘
   PostHog ◀── whitelisted events from the main-process AnalyticsManager
```

## Subsystems

### Desktop app (`app/`)
Electron with three build targets (main + preload + renderer via `electron-vite`). The **main process** (`src/main/`) owns everything privileged — `AuthManager` (Supabase PKCE OAuth, session in the OS keychain), `BillingManager` (entitlement display + Checkout/Portal), `AnalyticsManager` (the single PostHog client), `UpdateManager` (background auto-update), `BackendSupervisor` (spawns + supervises the Node backend), and `installBridge` (provisions the CEP panel). The **preload** exposes a thin `window.cubic` IPC bridge; the **renderer** (`src/renderer/`) is the React/Zustand chat UI and talks to the backend over a loopback WebSocket (`ws.ts`). The renderer never touches Supabase/Stripe directly — main fetches and hands data over IPC. See [`app/README.md`](../app/README.md).

### AE bridge + backend (`server/ae-bridge/`)
The Node process the app spawns (`serve.ts`). Its `wsBridge` is a loopback WebSocket hub with two channels over one socket: a **command channel** (`{id, command, args}` → AE → `{id, ok, result}`) and a **chat channel** (agent turns). `agentChat.ts` folds in the `cubic-ai` loop and owns steering, persistence, and re-attach. The `.jsx` handlers under `src/scripts/` are bundled and run inside the **CEP panel** (`cep-extension/`), an invisible auto-starting extension that connects back over the WS. `index.ts` is a separate **dev-only** MCP entrypoint (Claude Code driving AE), parallel to the shipped path. See [`server/ae-bridge/CLAUDE.md`](../server/ae-bridge/CLAUDE.md) and the wire contract in [`PROTOCOL.md`](../server/ae-bridge/PROTOCOL.md).

### AI brain (`server/ai/`)
The agent loop. `agent/loop.ts` `runAgentTurn` runs a bounded iterate-until-no-tool-calls loop (default 15 iterations) with compaction, pre-turn snapshots, self-heal via error `tool_result`s, and cancel/steer at iteration boundaries. `llm/anthropic.ts` is the sole Anthropic chokepoint and **forks on `CUBIC_ENV`**: direct-local sends the real key + system + tools; prod sends a bare request (the Worker injects the secrets) and threads the caller's Supabase JWT per call. `context/` builds the per-turn `<live_ae_state>` block. See [`server/ai/CLAUDE.md`](../server/ai/CLAUDE.md).

### Hosted proxy (`proxy/`)
A Cloudflare Worker with two routes. `POST /v1/messages` is the gate — IP rate-limit → verify Supabase JWT (JWKS via `jose`) → per-user rate-limit → entitlement check (service-role `get_entitlement`, cached ~60s, fail-closed) → model allowlist + `max_tokens` clamp → inject the system prompt + tool catalog → forward to Anthropic with the real key → `tee` the response to the client while metering usage into `record_usage`. `GET /releases/*` serves the auto-update feed read-only from a private R2 bucket (handled before the auth gate; electron-updater holds no JWT). The **crown jewels** (`src/secrets/`) — system prompt + tool catalog — live only here. See [`proxy/CLAUDE.md`](../proxy/CLAUDE.md).

### Auth + billing data (`supabase/`)
Postgres with three tables — `plans` (allowance SSOT), `subscriptions` (paid-state, PK `user_id`, webhook-written only), `usage` (cost-cents counter) — plus `SECURITY DEFINER` RPCs `get_entitlement` (the gate read), `apply_subscription` (webhook upsert), and `record_usage` (proxy increment). Deno edge functions cover `create-checkout`, `create-portal`, `stripe-webhook` (the only writer of paid-state), `billing-details`, and `delete-account`. See [`supabase/README.md`](../supabase/README.md) and the data model in [`db-schema.md`](./db-schema.md).

### Local WS transport
Everything on-device speaks one loopback WebSocket, bound to `127.0.0.1:0` (OS-assigned port, so a port conflict can never brick a machine). A per-launch token is minted at startup and written with the port to `~/.cubic/conn.json` (`0600`). Every client's first frame must be `{type:'hello', token, role}` with the matching token or it's dropped — a malicious webpage can't read `conn.json`, so it can never authenticate. Three clients share the socket: the CEP panel (`worker`), the renderer (`ui`), and the brain's `BridgeClient` (`loopback`). See [`PROTOCOL.md`](../server/ae-bridge/PROTOCOL.md).

## Request lifecycles

### Chat / edit turn (prod / proxied)
```
Renderer sendUserChat (attaches fresh Supabase JWT) → WS chat channel → agentChat → runAgentTurn
  → buildContext reads live AE state via the loopback BridgeClient → panel → ExtendScript
  → llm.chat (bare request) → ANTHROPIC_BASE_URL = Worker
       Worker: IP-limit → verify JWT → user-limit → entitlement (fail-closed)
               → model allowlist → inject system + tools → api.anthropic.com
               → tee: stream back  +  meter → record_usage
  → tool_use blocks → executeTool → BridgeClient.callRunScript → command channel
       → CEP panel evalScript(handlers) → AE (undo-grouped) → {id, ok, result}
  → error tool_results loop back (self-heal, ≤ 15 iterations)
  → agentEvent stream back to the renderer; turn persisted to JSONL
```
In **direct-local** mode the Worker is bypassed: `llm.chat` sends system + tools + the real `ANTHROPIC_API_KEY` straight to `api.anthropic.com`.

### Billing
```
Renderer openCheckout(plan) → main BillingManager → create-checkout edge fn (user JWT)
  → Stripe Checkout URL → system browser → user pays
Stripe → stripe-webhook edge fn (signature verified) → apply_subscription RPC → subscriptions row
Browser → cubic://billing/success → main → billing.handleReturn → poll get_entitlement until entitled
Next chat: the Worker's service-role get_entitlement sees the paid row → allows
```

### Auth
```
Renderer authSignIn(google) → main signInWithOAuth (PKCE) → system browser → provider consent
  → cubic://auth/callback?code=… → main → exchangeCodeForSession
  → session persisted to userData/auth.bin (OS keychain via safeStorage)
  → 'signedIn' broadcast → billing refresh + analytics identify
Refresh: AuthManager self-drives (on-demand within a 10-min skew in getAccessToken()).
```

## Cross-cutting concerns

- **Config: baked vs runtime.** `CUBIC_ENV` (`local` | `prod`) forks direct vs proxied — only URLs change, one code path. Packaged builds compile the public values (Supabase URL + anon key, PostHog key, proxy URL) into the bundle via `electron-vite`/esbuild `define`; `config.ts` reads them with a `process.env` fallback for dev. Real secrets are never on-device.
- **Secrets discipline.** `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `STRIPE_*` live only in the Worker / Supabase edge env. The crown jewels (prompt + catalog) live in `proxy/src/secrets` and are aliased to `src/secrets/stub.ts` in the `server/ai` prod build (guarded by a leak test), so no shipped binary contains them.
- **Packaging / signing / auto-update.** `app/scripts/dist.mjs` builds → obfuscates the bundled backend + main → `electron-builder` signs (Developer ID + hardened runtime), notarizes, and staples the `.app` + DMG. `scripts/release.mjs` uploads the signed artifacts to R2; electron-updater downloads in the background and applies on the next restart. The full flow is documented in [`updates.md`](updates.md).
- **Analytics.** One `posthog-node` client in the main process; the renderer and backend forward raw events over IPC and main stamps identity + a strict event/property whitelist, so only verb names, outcomes, and counts leave the machine — never prompt or project content. Off unless keyed.

## Data stores

- **Supabase Postgres** — `auth.users` + `plans` + `subscriptions` + `usage`. One writer per table. Read model in [`db-schema.md`](./db-schema.md).
- **Local `~/.cubic/`** (`0700`) — `conn.json` (WS handshake `{port, token}`); `sessions/<encoded-project>/<id>.jsonl` + `sessions/index.json` (append-only transcripts + sidebar metadata); `frames/frame_<ts>.png` (single-frame renders); `.cubic-backups/<sessionId>/` (pre-turn `.aep` snapshots).
- **Electron `userData/`** — `auth.bin` (keychain-encrypted session), analytics id + first-event markers.
- **Cloudflare R2** `cubic-releases` — signed update artifacts, served read-only through the Worker's `/releases/*`.
- **Adobe CEP dir** `~/Library/Application Support/Adobe/CEP/extensions/com.cubic.ae-bridge/` — the installed invisible panel.

## Current constraints (as of 7/18/26, post phase 5 impl)

Present-state facts, not roadmap:

- **direct-local is the dev default.** The proxied path is what ships; both share one code path.
- **OAuth:** Google is live; Apple sign-in is config-only.
- **Plan prices are sandbox/placeholder** in `plans` until production numbers are locked.
- **macOS only.** Windows path seams exist but are not built out; some local-file hardening (Windows ACLs) is POSTMVP.
- Runtime Worker-served config override (live-tunable values without a release) is designed but not yet built — packaged builds use baked values.
