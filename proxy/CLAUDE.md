# CLAUDE.md — proxy (Cloudflare Worker LLM proxy)

> **Scope:** the hosted LLM proxy (Phase 5 §A). Holds the Anthropic key + owns the
> crown jewels (system prompt + tool catalog) and injects them server-side, so the
> shipped desktop binary never contains either. Anthropic-shaped passthrough: the
> agent loop stays client-side (`server/ai`), one Claude response per call.
>
> **WT-PROXY-CORE only** — this Worker injects + forwards. It does NOT yet gate:
> JWT verify / entitlement / metering / rate-limit are Wave 2 (WT-PROXY-GATING).

## Layout
- `src/index.ts` — the Worker. `POST /v1/messages` → inject system+tools+tool_choice
  (`prepareUpstream`, exported + unit-tested), set `x-api-key` from the Worker secret,
  forward to `api.anthropic.com`, pipe `upstream.body` straight back (handles streaming +
  non-streaming alike). Reads the `Authorization` header but does NOT enforce it (Wave-2 seam).
- `src/inject.ts` — builds the injected `system` (static prefix + `cache_control: ephemeral`,
  §A-9) and `tools` (zod → JSON-Schema) from the secrets. Computed once at module load.
- `src/secrets/` — **the single source of truth + the crown jewels** (moved from `server/ai`):
  `rules.ts`, `command-params.ts`, `renderCatalog.ts`, `definitions.ts`, `buildSystemPrompt.ts`,
  `index.ts` (barrel). `server/ai` imports this barrel via its `@secrets` alias in direct-local
  dev only; the prod build aliases `@secrets` to a stub so these never enter the binary.
- `scripts/gen-command-names.mjs` — codegens the client's names-only mirror
  (`server/ai/src/tools/command-names.generated.ts`). Names aren't secret; the catalog is.
  `--check` mode is the drift gate.
- `tests/` — vitest: worker injection, the moved secret tests, and the registry drift guard.

## Secrets / config
- `ANTHROPIC_API_KEY` — Worker **secret**: `wrangler secret put ANTHROPIC_API_KEY` (never committed).
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
