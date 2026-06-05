## Phase 4
- ***Should I make my UI standalone instead of a after effects panel? (like something downloadable that would connect to AE - i think this means that they would have to set up something on after effects)
    - Doing this would also allow me to expand to other platforms in the future (eg. premiere pro, davinci, final cut pro, etc., as opposed to having to recreate a new ui for each part)
- new ux (similar to claude's spinning progress bar + nice words, etc.)
- Cubic undo history viewer + dedicated keybind?
- [ ] **CEP panel chat UI** — build the panel-side UI that consumes the `agentEvent` protocol (streaming event display, message history); prerequisite for agent-run controls and recovery UI. Optional: token-level streaming.
    - [ ] **Render the new compaction/context events** (backend done in Phase 2 — auto-compaction, `/clear`, `/compact`): show `compaction` (start/done/failed) as a subtle "compacting conversation…" indicator (NOT a scary error), and render `context_full` as a friendly "this chat is too long — start a new one" CTA, not a red error. Optional: a context-usage meter (`Session.lastContextTokens` vs the model's `contextWindow`).
    - [ ] **Manual end-to-end test of compaction (deferred from Phase 2)** — backend logic is unit-tested (free, in `compaction.test.ts`/`loop.test.ts`), but the real-AE feel was left for this UI. Once the chat UI exists: (1) type `/clear` → history empties; (2) type `/compact` → older turns collapse to a `<conversation_summary>` and the next turn continues coherently; (3) trigger auto-compaction by holding a long conversation (or temporarily lower the threshold via the `compactThreshold`/`contextWindowOverride` deps on `runAgentTurn`) and confirm it fires at the turn boundary without losing recent context; (4) force the hard ceiling and confirm the `context_full` pause. Run any real-API check with `CUBIC_LLM_DEBUG=1` to watch I/O + per-call cost.
- [ ] **Agent-run controls (Claude-Code-style)** — the loop's BACKEND hooks already exist from Phase 2 item 4 (`Session.cancelRequested` + `Session.pendingMessage`, checked at iteration boundaries; agentChat.ts maps `cancel`/`queue` messages to them). Phase 4 wires the panel UI to them:
    - [ ] Esc / cancel button → sends `{type:'cancel'}` to stop the current run at the next boundary.
    - [ ] Type-while-running → sends `{type:'queue', text}` to steer the agent (injected at the next tool boundary, or as a fresh follow-up turn).
    - [ ] Show the queued/steering message(s) in the UI + allow editing/removing before they fire.
    - [ ] ⚠️ Backend bump needed for FULL parity: today `pendingMessage` is a single slot (last-write-wins). Editing/stacking multiple queued messages needs a queue *list* on Session (small change) — single-message steer works today without it.
- [ ] **Seamless backup recovery** — the agent loop already saves a pre-turn `.aep` snapshot to `.cubic-backups/` (rolling last-10), but recovery is currently manual (dig into the hidden folder in Finder). Make it ergonomic:
    - [ ] Panel "restore to before this request" button — list recent snapshots (per turn, with timestamp/summary) and restore the chosen one over the working file (then reopen).
    - [ ] Agent-driven restore — a "Cubic, undo that / revert the last change" command the model understands, mapping to a restore handler (new MCP command: copy a chosen `.cubic-backups/` file back + reopen project).
    - [ ] Confirm-before-overwrite (restoring replaces current working state — guard it).


### Super important
- [ ] **Eg. Preset Library?? <-- might be done in phase 2 system prompt (give the system prompt a good understanding)