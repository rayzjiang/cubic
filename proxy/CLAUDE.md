# CLAUDE.md — proxy (Cloudflare Worker LLM proxy)

> **Scope:** the hosted LLM proxy (Phase 5 §A). Holds the Anthropic key + owns the
> crown jewels (system prompt + tool catalog) and injects them server-side, so the
> shipped desktop binary never contains either. Anthropic-shaped passthrough: the
> agent loop stays client-side (`server/ai`), one Claude response per call.
>
> **Gated (WT-PROXY-GATING, Wave 2).** Every `POST /v1/messages` now runs: IP throttle → verify the
> Supabase JWT (JWKS) → per-user rate limit → entitlement check (paid + under cap) → forward → meter
> usage. Fail-closed: an un-verifiable/un-entitled/over-cap request is rejected (401/402/429/503) before
> any Anthropic spend. §A-8 (real deploy + flipping the shipped default) is the remaining Wave-2 step.

## Layout
- `src/index.ts` — the Worker. `POST /v1/messages` → **gate** (IP limit → `verifyJwt` → user rate
  limit → `getEntitlement`; 401/402/429/503 on failure) → inject system+tools+tool_choice
  (`prepareUpstream`), set `x-api-key` from the Worker secret, forward to `api.anthropic.com`, then
  `tee` the body: one branch streams to the client, the other is metered async via `ctx.waitUntil`.
- `src/auth.ts` — §A-4 `verifyJwt`: stateless JWKS verification with `jose` (pins asymmetric algs +
  checks iss/aud/exp). `verifyJwtWithKeySet` is the unit-testable core; `bearerToken` parses the header.
- `src/entitlement.ts` — §A-5 `getEntitlement`: `get_entitlement` RPC as service-role, ~60s in-memory
  cache, **strict fail-closed** (throws on lookup failure → 503, never serves stale).
- `src/metering.ts` + `src/usage-parse.ts` — §A-6 `meterResponse`: parse token counts from the teed
  response (JSON now, SSE forward-compat) → cost-cents (proxy-side pricing map) → `record_usage` RPC.
- `src/inject.ts` — builds the injected `system` (static prefix + `cache_control: ephemeral`,
  §A-9) and `tools` (zod → JSON-Schema) from the secrets. Computed once at module load.
- `src/secrets/` — **the single source of truth + the crown jewels** (moved from `server/ai`):
  `rules.ts`, `command-params.ts`, `renderCatalog.ts`, `definitions.ts`, `buildSystemPrompt.ts`,
  `index.ts` (barrel). `server/ai` imports this barrel via its `@secrets` alias in direct-local
  dev only; the prod build aliases `@secrets` to a stub so these never enter the binary.
- `scripts/gen-command-names.mjs` — codegens the client's names-only mirror
  (`server/ai/src/tools/command-names.generated.ts`). Names aren't secret; the catalog is.
  `--check` mode is the drift gate.
- `scripts/mint-test-jwt.mjs` — DEV helper: mints Supabase-shaped ES256 tokens + serves a local JWKS
  (`--var SUPABASE_JWKS_URL`) so you can curl the gate against `wrangler dev` with no real Supabase.
- `tests/` — vitest: worker injection, the moved secret tests, the registry drift guard, and the gate
  (`auth`/`entitlement`/`metering`/`gating` — all offline, zero API spend).

## Secrets / config
- `ANTHROPIC_API_KEY` — Worker **secret**: `wrangler secret put ANTHROPIC_API_KEY` (never committed).
- `SUPABASE_SERVICE_ROLE_KEY` — Worker **secret**: reads any user's entitlement (`get_entitlement`) +
  writes usage (`record_usage`), both bypass RLS. `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`.
- `SUPABASE_URL` — env-specific **var** (JWKS + PostgREST base). Prod: `wrangler deploy` var / dashboard;
  local: `--var SUPABASE_URL:http://127.0.0.1:54321`. `SUPABASE_JWKS_URL` optionally overrides the JWKS.
- Rate limits — `RATE_LIMITER` (per user) + `IP_RATE_LIMITER` (per IP) native bindings in `wrangler.jsonc`.
- `MOCK_UPSTREAM` — when set, return a canned Anthropic-shaped response instead of calling
  upstream → lets full-stack-local exercise the whole client→Worker path at **zero API spend**.

## Four test surfaces (§A-0)
- **MCP-only** — bridge standalone; never touches the proxy.
- **direct-local** (`CUBIC_ENV=local`, default `npm run dev`) — `server/ai` calls Anthropic
  directly with the local secrets. The proxy is not involved.
- **full-stack-local** (`CUBIC_ENV=prod` + `CUBIC_PROXY_URL=http://localhost:8787`) — `wrangler dev`;
  the client sends bare requests, this Worker injects. Add `MOCK_UPSTREAM=1` for zero-spend.
- **prod** — deployed Worker; the only build where the `@secrets` stub strips the bytes.

## Run
```bash
npm install                       # wrangler + @cloudflare/workers-types + zod (+ vitest)
npm test                          # vitest: injection + secret tests + drift guard (no API spend)
npm run gen:command-names         # regenerate the client names mirror after a registry change
npx wrangler dev --var MOCK_UPSTREAM:1   # full-stack-local, zero Anthropic spend
```
Real upstream (spends Anthropic) only with explicit go-ahead: `npx wrangler dev` (no MOCK_UPSTREAM),
point Cubic at it via `CUBIC_ENV=prod CUBIC_PROXY_URL=http://localhost:8787`.

## Engineering constraints
Adding a command: edit `src/secrets/command-params.ts` (registry) → `npm run gen:command-names`
→ keep `server/ae-bridge/src/commands.ts` in sync (the drift test enforces it). Match existing
style; the injection mirrors `server/ai/src/llm/anthropic.ts`'s direct-mode `toSystemParam` + tools.
