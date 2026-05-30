# CLAUDE.md — server/ai
Keep Claude.md under 150 lines. Concise, high-signal content preferred.

> **Scope:** Claude API backend + agent brain. Talks to AE by connecting to the
> live MCP WebSocket bridge (`server/mcp/src/bridge/wsBridge.ts`) as an external
> client. Does NOT modify any MCP or CEP code.

## Phase 2 build order (this module)
1. ✅ **Context pipeline** — fetch live AE state before every Claude call
2. ✅ **System prompt assembly** — `STATIC_RULES` (Motion Copilot prompt) + `buildSystemPrompt()`
3. ✅ **Tool schema registration** — zod schemas for `runScript`/`batch`/`createComposition`/`getHelp`; wired into `chat()`; `ChatResponse.toolUses[]`; content-block `Message` type
4. ⬜ **State machine / agent loop + self-healing** — incl. autosave before a run (revert point) and wrapping a whole agent turn in one undo group

See `../../TODOS/TODO-phase2.md` for the full checklist.

## Architecture
```
User message
    ↓
buildContext()          ← reads live AE state via the WS bridge (McpClient)
    ↓
formatStateForPrompt()  ← wraps state in <live_ae_state>...</live_ae_state> XML block
    ↓
buildSystemPrompt()     ← [STATIC_RULES] + <live_ae_state>…</live_ae_state>
    ↓
getLLM().chat() / .stream()   ← Anthropic SDK
    ↓
(planned) agent loop: tool calls → bridge → AE → repeat
```

## Module map (`src/`)
- `mcp/client.ts` — `McpClient` / `mcpClient` singleton: WS connection + `callRunScript(command, args)`.
- `mcp/tools.ts` — typed read wrappers + return types: `getProjectInfo`, `listCompositions`, `getCurrentTime`, `getSelectedLayers`.
- `context/buildContext.ts` — assembles `LiveAEState` per turn.
- `context/cache.ts` — `SessionCache` / `sessionCache`: caches `getProjectInfo` + `getCompositionsList`; `invalidate()`.
- `context/format.ts` — `formatStateForPrompt()` → `<live_ae_state>` JSON block.
- `prompt/rules.ts` — `STATIC_RULES` static system-prompt text (user-edited; no logic).
- `prompt/buildSystemPrompt.ts` — joins rules + live state.
- `llm/` — provider abstraction (`getLLM`, `AnthropicProvider`, types).
- `index.ts` — public barrel export.

## Bridge transport (McpClient)
- **How the bridge starts:** Claude Code spawns `server/mcp/build/index.js` via stdio (MCP transport). As a side effect of `main()`, the MCP server opens a WebSocket server on port 17923. The CEP panel inside AE connects *to* that WS port as a client. `McpClient` here connects to the same port as a second external client. Neither depends on Claude Code directly — both just connect to the port the MCP server opened.
- **`npm start` is NOT needed** when Claude Code is running — the bridge is already up. Run `npm start` only when running `server/ai` standalone outside Claude Code.
- Port discovery: read `~/.ae-mcp-bridge/port`, then fall back to scanning `17923–17927`. `callRunScript(command, args)` sends `{ id, command, args }` via `routeExternalCommand()` in `wsBridge.ts`. 10s timeout; results are JSON-parsed.
- Requires AE open **with the MCP Bridge panel connected**; a bare bridge with no panel replies with empty/blank state.

## Context pipeline (per turn)
- Per-turn volatile fetches (parallel): `getSelectedLayers`, `getCurrentTime`.
- Cached per session: `getProjectInfo`, `getCompositionsList`. Call `sessionCache.invalidate()` after any mutation turn.
- Active comp dims are resolved from the cached compositions list by comp name (from `selectedLayers.activeComp` or `currentTime.compName`).
- **Graceful degradation:** every fetch in `buildContext()` is `.catch(() => null)` so a disconnected bridge yields an empty state instead of throwing. Live tests bypass this (call the raw client) to fail loudly.

## Prompt injection rule
All dynamic context injected into prompts **must be wrapped in XML tags** so the model unambiguously knows what each section is — e.g. `<live_ae_state>{JSON}</live_ae_state>`. Never use plain-text headers like `[Live AE State]`.

## LLM wrapper rule
All Claude API calls go through `getLLM()` (from `src/llm/`). Never import `@anthropic-ai/sdk` directly elsewhere — `src/llm/anthropic.ts` is the sole chokepoint that enables multi-provider support later. Supports `chat()` and `stream()`; default model `claude-sonnet-4-6`. `ANTHROPIC_API_KEY` is loaded from `.env` (dotenv).

## Agent tool-surface rule (encoded in `STATIC_RULES`)
The model drives AE through a small parameterized tool set, **not** one tool per feature:
- `runScript({ script, parameters })` is the primary tool; `batch` runs multiple commands in one turn (always with a `groupLabel` for one-Cmd+Z revert); `createComposition` and `getHelp` are the only other tools.
- Never call programmatic undo; self-heal forward on tool errors. (Full operating rules live in `prompt/rules.ts`.)
- Note: this is the model's tool surface. The internal context pipeline still calls typed reads directly via `callRunScript`.

## Tests
- `npm test` — unit tests (vitest), no deps needed.
- `npm run test:tools` — tool-use round-trip; needs `ANTHROPIC_API_KEY` only, no AE (uses Haiku 4.5, ~sub-cent/run).
- `npm run test:drift` — asserts `COMMAND_NAMES` matches `server/mcp`; needs Claude Code running (bridge already up), no AE panel needed.
- `npm run test:live` / `npm run test:chat` — context + full LLM round-trip; need AE + MCP panel + `ANTHROPIC_API_KEY`.

## Engineering constraints
Same as `server/mcp/CLAUDE.md`: no sleeps/polling, match existing style, no per-variant tool explosion.
