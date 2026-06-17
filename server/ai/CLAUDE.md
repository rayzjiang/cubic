# CLAUDE.md — server/ai
Keep Claude.md under 150 lines. Concise, high-signal content preferred.

> **Scope:** Claude API backend + agent brain. Talks to AE by connecting to the
> live WebSocket bridge (`server/ae-bridge/src/bridge/wsBridge.ts`) as an external
> client. Does NOT modify any bridge or CEP code (that lives in `server/ae-bridge`).

## Phase 2 build order (this module)
1. ✅ **Context pipeline** — fetch live AE state before every Claude call
2. ✅ **System prompt assembly** — `STATIC_RULES` (Motion Copilot prompt) + `buildSystemPrompt()`
3. ✅ **Tool schema registration** — zod schemas for `runScript`/`batch`/`createComposition` (no `getHelp` — see tool-surface rule); wired into `chat()`; `ChatResponse.toolUses[]`; content-block `Message` type
4. ✅ **Agent loop + self-healing** (`src/agent/`) — bounded while-loop: chat → execute tools → feed `tool_result` back → repeat until no tool calls or the iteration budget. Pre-turn `.aep` snapshot is the revert point (NOT a per-turn undo group — infeasible across async round-trips). Self-heals by returning error tool_results; retries `RENDER_FAILED` once; invalidates `sessionCache` after mutations. Folded into the MCP process via a `userChat`/`agentEvent` channel.

See `../../TODOS/TODO-phase2.md` for the full checklist.

## Architecture
```
User message
    ↓
buildContext()          ← reads live AE state via the WS bridge (BridgeClient)
    ↓
formatStateForPrompt()  ← wraps state in <live_ae_state>...</live_ae_state> XML block
    ↓
buildSystemPrompt()     ← { cached: STATIC_RULES + generated <command_catalog>,
                            volatile: <live_ae_state>… }   (split for prompt caching)
    ↓
getLLM().chat() / .stream()   ← Anthropic SDK (cached prefix marked cache_control)
    ↓
agent loop: tool calls → bridge → AE → repeat (built — see `src/agent/`)
```

## Module map (`src/`)
- `bridge/client.ts` — `BridgeClient` / `bridgeClient` singleton: WS connection + `callRunScript(command, args)`.
- `bridge/tools.ts` — typed read wrappers + return types: `getProjectInfo`, `listCompositions`, `getCurrentTime`, `getSelectedLayers`, `getSelectionDetails` (selected-property detail).
- `context/buildContext.ts` — assembles `LiveAEState` per turn.
- `context/cache.ts` — `SessionCache` / `sessionCache`: caches `getProjectInfo` + `getCompositionsList`; `invalidate()`.
- `context/format.ts` — `formatStateForPrompt()` → `<live_ae_state>` JSON block.
- `prompt/rules.ts` — `STATIC_RULES` system-prompt text (user-edited) with a `{{COMMAND_CATALOG}}` placeholder; no logic.
- `tools/command-params.ts` — **single source of truth** for every command + its params (`COMMAND_PARAMS`); `COMMAND_NAMES`/`CommandName` are derived from its keys.
- `prompt/renderCatalog.ts` — `renderCommandCatalog()` generates the compact `<command_catalog>` text from the registry (deterministic → cache-stable).
- `prompt/buildSystemPrompt.ts` — returns `{ cached, volatile }`: rules+catalog (stable, cached) + live state (per-turn).
- `llm/` — provider abstraction (`getLLM`, `AnthropicProvider`, types).
- `agent/` — the agent loop. `loop.ts` (`runAgentTurn` — deps injectable for tests; `DEFAULT_MAX_ITERATIONS = 15`, overridable per-turn), `session.ts` (`Session`: history + run lock + cancel/steer flags + `lastContextTokens` for compaction), `executeTool.ts` (ToolUse → `callRunScript` → `tool_result`; retry `RENDER_FAILED`; cache invalidation), `compaction.ts` (auto-summarizes history when the context window fills — `compactSession`/`findCompactionCut`; `COMPACT_THRESHOLD` 90%, `HARD_CEILING` 97% emergency pause, `KEEP_RECENT_TURNS` 3 kept verbatim), `snapshot.ts` (`snapshotProject()` — calls the bridge `backupProject` command), `events.ts` (`AgentEvent` union streamed to the panel).
- `index.ts` — public barrel export.

## Agent loop (`src/agent/`)
- **Shape:** bounded while-loop (`DEFAULT_MAX_ITERATIONS = 15`, overridable per-turn via deps), not a formal state machine. One model call per iteration; tools execute in order; their `tool_result` blocks become the next user message.
- **Self-healing:** tool errors return as `tool_result(is_error)` so the model reasons + retries forward, bounded by the iteration budget. `RENDER_FAILED` retries once (transient flush race). Transport failures surface as a `BRIDGE_ERROR` result, never a thrown turn.
- **Revert point:** a pre-turn filesystem copy of the `.aep` to `.cubic-backups/<sessionId>/` via the internal-only `backupProject` command (deliberately NOT in the registry/catalog — invisible to the model; reached only through `bridgeClient`). A failed snapshot warns and proceeds. The model-facing counterpart is `restoreProject` ("undo that"): a catalogued command whose `sessionId` the server injects in `executeTool` (the model can't choose it); each call walks back one turn through the session's snapshots (`noop` at the earliest point).
- **Compaction:** `loop.ts` watches `Session.lastContextTokens` (the true prefill size of the last `chat()`); at `COMPACT_THRESHOLD` (90% of the model's context window) it calls `compactSession` (`compaction.ts`) to summarize older turns into one message while keeping `KEEP_RECENT_TURNS` (3) verbatim; `HARD_CEILING` (97%) is an emergency pause when even compaction can't fit. A real API context-overflow (a `model_context_window_exceeded` stop reason or a thrown "prompt is too long" error) also raises the same `context_full` pause, not just the 97% ceiling. The summary is itself a Claude call (extra cost — visible under `CUBIC_LLM_DEBUG`).
- **Narration:** per-iteration `AgentEvent` push (assistant text, then `tool_start`/`tool_end`). Token-level streaming is a later swap (`chat()`→`stream()`) with no change to the loop.
- **Concurrency:** single in-flight run per `Session`; `cancelRequested` and the `pendingMessages` queue (FIFO `{id,text}[]` steer queue) are checked at iteration boundaries — mirrors Claude Code. The whole queue drains in order at each tool-result boundary (never just the last → no silent drop). Messages left after the final boundary run as one combined follow-up turn. (Editing/removing a queued steer before it fires is a transport concern owned by `server/ae-bridge`'s `agentChat.ts`.)
- **Consumed by `server/ae-bridge`:** that package folds this loop into its process (`cubic-ai` as a `file:../ai` dep) and owns the panel↔loop wiring, session persistence, and steer-queue editing — see `server/ae-bridge/CLAUDE.md`. Build note: rebuild `cubic-ai` (incl. `build:types`) before building `server/ae-bridge`.

## Bridge transport (BridgeClient)
- **How the bridge starts:** Claude Code spawns `server/ae-bridge/build/index.js` via stdio (MCP transport). As a side effect of `main()`, the MCP server opens a WebSocket server on port 17923. The CEP panel inside AE connects *to* that WS port as a client. `BridgeClient` here connects to the same port as a second external client. Neither depends on Claude Code directly — both just connect to the port the MCP server opened.
- **`npm start` is NOT needed** when Claude Code is running — the bridge is already up. Run `npm start` only when running `server/ai` standalone outside Claude Code.
- Port discovery: read `~/.cubic/port`, then fall back to scanning `17923–17927`. `callRunScript(command, args)` sends `{ id, command, args }` via `routeExternalCommand()` in `wsBridge.ts`. 10s timeout; results are JSON-parsed.
- Requires AE open **with the Cubic panel connected**; a bare bridge with no panel replies with empty/blank state.

## Context pipeline (per turn)
- Per-turn volatile fetches (parallel): `getSelectedLayers`, `getCurrentTime`, `getSelectionDetails` (its `selectedProperties` are merged into the selected-layers list).
- Cached per session: `getProjectInfo`, `getCompositionsList`. Call `sessionCache.invalidate()` after any mutation turn.
- Active comp dims are resolved from the cached compositions list by comp name (from `selectedLayers.activeComp` or `currentTime.compName`).
- **Graceful degradation:** every fetch in `buildContext()` is `.catch(() => null)` so a disconnected bridge yields an empty state instead of throwing. Live tests bypass this (call the raw client) to fail loudly.

## Prompt injection rule
All dynamic context injected into prompts **must be wrapped in XML tags** so the model unambiguously knows what each section is — e.g. `<live_ae_state>{JSON}</live_ae_state>`. Never use plain-text headers like `[Live AE State]`.

## LLM wrapper rule
All Claude API calls go through `getLLM()` (from `src/llm/`). Never import `@anthropic-ai/sdk` directly elsewhere — `src/llm/anthropic.ts` is the sole chokepoint that enables multi-provider support later. Supports `chat()` and `stream()`; default model `claude-sonnet-4-6`. `defaultModel()` reads `CUBIC_MODEL` (alias `sonnet|haiku|opus` or a full id) at call time, so flipping models needs no rebuild — just edit the env and restart.

**Env: one shared file — `server/.env`** (the single source of truth for `ANTHROPIC_API_KEY` + `CUBIC_MODEL`, gitignored). The running app loads it via `server/ae-bridge/src/startBackend.ts` → `loadLocalEnv()`; these tests load it via `tests/lib/loadEnv.mjs` (a side-effect import that replaced bare `dotenv/config`). Do NOT recreate per-package `server/ai/.env` or `server/ae-bridge/.env` — both were removed to end the "edited the wrong .env" drift.

## Agent tool-surface rule (encoded in `STATIC_RULES`)
The model drives AE through a small parameterized tool set, **not** one tool per feature:
- `runScript({ script, parameters })` is the primary tool; `batch` runs multiple commands in one turn (the model is told to always set a `groupLabel` for one-Cmd+Z revert, though the schema makes it optional); `createComposition` is the only other tool. **No `getHelp`** — per-command params are always present in the `<command_catalog>` (generated from `command-params.ts`), so the model never fetches docs and never guesses args.
- Never call programmatic undo; self-heal forward on tool errors. (Full operating rules live in `prompt/rules.ts`.)
- Note: this is the model's tool surface. The internal context pipeline still calls typed reads directly via `callRunScript`.

## Tests
- `npm test` — unit tests (vitest), no deps needed.
- `npm run test:tools` — tool-use round-trip; needs `ANTHROPIC_API_KEY` only, no AE (uses Haiku 4.5, ~sub-cent/run).
- `npm run test:drift` — **static** unified guard (builds first): asserts the `command-params.ts` registry matches `server/ae-bridge/commands.ts` (names) AND the `.jsx` handler `args.X` reads (params). No bridge/AE/Claude Code needed — runs in CI.
- `npm run test:matchnames` — **static** guard (CI, no AE): asserts every hardcoded `"ADBE …"` matchName in the `.jsx` handlers is AE-verified (effects, via `server/ae-bridge/tests/fixtures/ae-matchnames.json`) or in the reviewed text/shape baseline. Catches a wrong matchName (the class that shipped the glow bug). Regenerate the fixture after an AE upgrade: `cd server/ae-bridge && node scripts/introspect-matchnames.mjs`.
- `npm run test:live` / `npm run test:chat` — context + full LLM round-trip; need AE + MCP panel + `ANTHROPIC_API_KEY`.
- `npm run test:agent` — **full agent loop** end-to-end (snapshot → context → chat → tools → loop); needs AE + panel + `ANTHROPIC_API_KEY`. ⚠️ mutates the project (creates a `__CUBIC_AGENT_TEST` comp — delete after).

## Engineering constraints
Same as `server/ae-bridge/CLAUDE.md`: no sleeps/polling, match existing style, no per-variant tool explosion.
