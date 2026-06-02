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
    - [x] **Live verification pending** — run `npm run test:agent` (server/ai) with AE + panel + API key; then `npm run test:write-clean` (server/mcp) for connection sanity.
- [ ] **Next pass (not this item):** CEP panel chat UI that consumes the agentEvent protocol; agent-run controls UI (Esc/cancel + queue/steer + edit-queued — backend hooks already built here, UI in Phase 4); optional token-level streaming; seamless backup recovery (restore button + agent "undo that" command — see TODO-phase4.md).

#### Caching?? - for system ae live state
- rn getProjectInfo, listCompositions cached; active/highlighted stuff is never cached
- The one staleness gap: if the user manually (outside the agent) resizes a comp or creates a new
  one, the cached dimension table is stale until the next mutation turn invalidates it. Rare, and
  self-heals on any agent mutation. If you ever want it tighter, we could add a short TTL — but
  that's a separate concern from this feature, and I'd leave it as-is.

- [ ] **Eg. Preset Library?? <-- might be done in phase 2 system prompt (give the system prompt a good understanding)