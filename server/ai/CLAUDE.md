# CLAUDE.md — server/ai
Keep Claude.md under 150 lines. Concise, high-signal content preferred.

> **Scope:** Claude API backend + agent brain. Consumes the MCP server (`server/mcp/`) as a programmatic client. Does NOT modify any MCP or CEP code.

## Phase 2 build order (this module)
1. ✅ **Context pipeline** — fetch live AE state before every Claude call
2. ✅ **System prompt assembly** — LLM wrapper + buildSystemPrompt()
3. Tool schema registration (Claude tool use)
4. State machine / agent loop + self-healing

See `TODOS/TODO-phase2.md` for full checklist.

## Architecture
```
User message
    ↓
buildContext()          ← fetches live AE state via MCP client (stdio)
    ↓
formatStateForPrompt()  ← wraps state in <live_ae_state>...</live_ae_state> XML block
    ↓
[System rules] + <live_ae_state>...</live_ae_state>
    ↓
Claude API (Anthropic SDK)
    ↓
State machine loop (tool calls → MCP → AE → repeat)
```

## Prompt injection rule
All dynamic context injected into prompts **must be wrapped in XML tags** so the model unambiguously knows what each section is. Example: `<live_ae_state>{JSON}</live_ae_state>`. Never use plain-text headers like `[Live AE State]`.

Final assembled system prompt: `[Static Global System Rules]\n\n<live_ae_state>…</live_ae_state>`

## MCP client usage
- `server/ai` spawns `server/mcp/build/index.js` via stdio as a child process (one shared `McpClient` instance per process).
- All AE handler commands route through `runScript` — do not call individual typed MCP tools directly (per `server/mcp/CLAUDE.md`).
- For more than one command in the same turn, use `batch` — not multiple `runScript` calls.
- Use `SessionCache` for slow-changing state (`getProjectInfo`, `listCompositions`). Call `cache.invalidate()` after any mutation turn.

## LLM wrapper rule
All Claude API calls go through `llm` (from `src/llm/`). Never import `@anthropic-ai/sdk` directly elsewhere — `src/llm/anthropic.ts` is the sole chokepoint that enables multi-provider support later.

## Context pipeline (per turn)
Per-turn volatile fetches (run in parallel): `getSelectedLayers`, `getCurrentTime`
Cached per session: `getProjectInfo`, `listCompositions`
Active comp dims are resolved from the cached `listCompositions` list by comp name.

## Engineering constraints
Same as `server/mcp/CLAUDE.md`: no sleeps/polling, match existing style, no per-variant tool explosion.
