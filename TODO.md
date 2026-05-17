## General Roadmap
✅ Phase 1 — MCP validation
➡️ Phase 1.5 - **Fixing the MCP + Finishing/adding all functionality that I need + Organizing it for CRUD for each operation + Comprehensive testing suite
Phase 2 — Build the LLM brain + agent architecture (system prompt + Claude API backend)
Phase 3 (self-healing/correcting/bug checking loop)
Phase 4 (After effects panel UI)
Phase 5 (Post MVP stuff?)

---
## Phase 2
- [ ] x

1. User Cmd+Z works. Every mutating command is already wrapped in app.beginUndoGroup("Cubic: 
  <command>") (mcp-bridge.jsx:78), so each one shows up as a discrete, named entry in AE's
  user-facing undo menu — "Undo Cubic: createSolidLayer", "Undo Cubic: applyEffect", etc. The CEP
  gate that blocked us from triggering Undo programmatically doesn't apply when the human presses ⌘Z
   — that's a real UI event, processed normally. So the user's own undo path is already fully
  functional.
  2. Per-turn grouping is already supported. Your batch command (mcp-bridge.jsx:140) wraps an entire
   array of operations in one outer beginUndoGroup("Cubic: batch (N commands)"). If the agent emits
  all of its turn's mutations through batch, the user gets exactly what you described: one ⌘Z 
  reverts the entire LLM turn at once. Individual operations within the batch are also preserved —
  they're nested groups, so they don't separately pollute the undo stack, but the inverse-CRUD
  pattern still works programmatically.

  For the "individual undo" flavor: if the agent emits commands as separate (non-batch) calls, each
  becomes its own undo entry — the user can step back one ⌘Z at a time. The agent picks the
  granularity by choosing batch-vs-sequential.
  
  Future polish to make this cleaner for users: rename the batch group from "Cubic: batch (N 
  commands)" to something user-meaningful, like "Cubic: <agent-turn-summary>". The agent could pass
  a groupLabel arg to batch (e.g., "Apply cinematic look to logo"), and the user sees that in the
  Edit menu instead of a generic "batch (3 commands)". Tiny change to mcp-bridge.jsx — happy to do
  it now if you want, or you can add it as a TODO.

## Phase 1.5
- [x] Critical: migrate mcp architecture to CEP extension instead of nonstop 2 second polling + file reading
- [x] Wrap each command in an undo group
    - [ ] **Note: will eventually need to add: Autosaving before it runs (for easy revert), wrapping each ai agent call into an undo group instead of each command, Cubic only undo history/viewer/dedicated keybind (to be done in ui step)
- [x] Finish MCP functionality - Identify potential missing functionality that I would need for my product (see CRUD screenshot above)
    - [ ] 
    - [ ] Ensure Create/read/update/delete functionality for all functions/commands

## Phase 1
- [x] Evaluate + organize what functionalities we have + the CRUD of each
- [x] Update mcp-bridge-auto.jsx to be more modularized into different file (new separate file for each CRUD thing: like for layers, expressions, compositions, etc. instead of all in this file)
- [x] Setup to be able to test mcp server functionality in after effects without needing to have claude run everything
    - [x] Fix it so that its changes + tests are viewable/self verifiable by the user
- [x] Make sure error states are consistent across scripts + tests
- [x] Make sure test files have consistent header documents + test all script CRUD functions + properly domain scoped