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

- [ ] **Eg. Preset Library?? <-- might be done in phase 2 system prompt (give the system prompt a good understanding)

- [x] **Trim volatile `<live_ae_state>` token weight** — `formatStateForPrompt` now emits compact JSON (dropped the `JSON.stringify(…, null, 2)` pretty-print). This block is re-sent every turn and can't be prompt-cached, so the indentation whitespace was pure wasted tokens. Content was already lean (selectedProperties gated to highlighted props; empty selection → `[]`).

- [ ] **Conversation history cap / truncation** (pre-ship must-fix) — `Session.messages` currently grows UNBOUNDED. Short sessions are fine, but a long back-and-forth eventually overflows the model's context window and the turn errors out. Add a simple cap/trim in `Session` (e.g. keep the most recent N messages / token budget, preserving tool_use↔tool_result pairing so a truncated assistant tool_use never loses its matching tool_result). Planned in the original design (plan item 7) but not yet built. Not a Phase 4 blocker, but don't ship without it.
    - [ ] Add a clear/compact command? allow users to see context window?