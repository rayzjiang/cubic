## Phase 2
- [x] Context pipeline (live state)
- [x] System prompt + ai agent sdk/llm wrapper setup (anthropic for now)
    - [x] build system prompt
        - [x] What guardrails should be put onto the ai prompt (like shouldn't it not be spitting out what tool calls it can make + its inner functionality on how it's built/was created)
    - [x] add anthropic API key
    - [x] Test to make sure it works
    - [x] tool single registry, prompt caching, drift test command
    - [x] yes lgtm - **verify that the mcp server/ai ae panel test connections work (the write:clean test)
    - [x] verify that the messages sent by the ai agent are somewhat along the lines of what claude code probably does (answer question/summary ish, makes changes + narration, concise summary of what was done + ends with next steps/short question or something)
- [x] Tool schema registration
- [x] The state machine / agent loop / self healing loop  (server/ai/src/agent/ — bounded while-loop, not an FSM)
    - [x] make sure the ai agent is set up to narrate what its doing as it works (like claude code) — per-iteration AgentEvent push (text + tool_start/tool_end); token-level streaming deferred (same loop, swap chat()→stream())
    - [x] Autosave project before agent run (easy revert point) — `backupProject` jsx handler filesystem-copies the .aep to `.cubic-backups/`; internal-only (not a model tool)
    - [~] ~~Wrap entire agent's single msgs' calls into a single undo group~~ — DROPPED: infeasible (AE undo groups can't span async LLM round-trips). The pre-turn snapshot IS the turn-level revert; per-command undo groups stay for granular ⌘Z.
    - [x] Execute tool calls via callRunScript → feed tool_result blocks back → loop; snapshot before run; sessionCache.invalidate() after mutations; treat RENDER_FAILED as retryable (retry once)
    - [x] Transport: folded the brain into the MCP process — panel sends `userChat`/`cancel`/`queue` over its socket, loop streams `agentEvent` back (wsBridge.onChat + agentChat.ts). cubic-ai is a `file:../ai` dep of server/mcp.
    - [x] **Live verification done** — `npm run test:agent` passes end-to-end against AE (snapshot → comp → batch solid+fade → done, 2/2 tool calls ok, multi-turn history). Fixed a batch field-name mismatch found here ({script,parameters}→{command,args} translation + BATCH_FAILED code).

- [x] **Trim volatile `<live_ae_state>` token weight** — `formatStateForPrompt` now emits compact JSON (dropped the `JSON.stringify(…, null, 2)` pretty-print). This block is re-sent every turn and can't be prompt-cached, so the indentation whitespace was pure wasted tokens. Content was already lean (selectedProperties gated to highlighted props; empty selection → `[]`).

- [x] **Conversation history cap → auto-compaction** (pre-ship must-fix) — `Session.messages` no longer grows unbounded. Chose Claude-Code-style **auto-compaction** (summarize old turns) over silent drop-oldest, since old turns carry intent/decisions and live AE state is re-injected fresh every turn anyway. Implemented in `server/ai/src/agent/compaction.ts`:
    - **Auto-trigger:** at ≥90% of the active model's context window (measured from the *real* token usage the API returns: `input + cacheCreation + cacheRead`), compaction fires at the next turn boundary — summarizes everything older into one XML-wrapped `<conversation_summary>` (structured recap ending in "Next steps", à la Claude Code), keeps the last ~3 turns verbatim. `findCompactionCut` only cuts at a real user-prompt boundary, so a tool_use/tool_result pair is never split.
    - **No silent forgetting:** summary call retries once; if it still fails there's ~10% headroom so the turn continues and retries next time; only at a true hard ceiling (≥97% or a real API context-length error) does it **pause and emit `context_full`** ("start a new conversation"). New `AgentEvent` variants: `compaction` (start/done/failed) + `context_full`.
    - **Model-aware window:** `contextWindow(model?)` is now part of the `LLMProvider` interface; `AnthropicProvider` owns its own per-model `CONTEXT_WINDOWS` table + fallback — nothing hardcoded to 200K, ready for the multi-model picker.
- [x] **Clear / compact commands** — `/clear` (empties history) and `/compact` (compaction on demand) parsed in `agentChat.ts`; same handlers the Phase 4 UI buttons will call. Rejected mid-run (they mutate live history). Showing the context window to users is deferred to the Phase 4 chat UI (no surface yet).
- [x] **Full model I/O + cost visibility in tests** — every real API call is printed (request → response → tokens → est. $) at the provider chokepoint when `CUBIC_LLM_DEBUG=1`; the three paid live scripts (`test:tools`/`test:chat`/`test:agent`) enable it automatically and print a per-run cost total via shared `tests/lib/format.mjs`. Per-model price table lives with the provider; `agent-live` capped at `maxIterations: 5` for thrift.
    - [ ] Follow-up (deferred, not a blocker): per-block elision of an oversized single recent `tool_result` — currently the hard-ceiling pause covers that edge.