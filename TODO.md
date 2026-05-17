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
- [ ] ***Eg. Preset Library?? <-- might be done in phase 2 (give the system prompt a good understanding)

## Phase 1.5
- [x] Critical: migrate mcp architecture to CEP extension instead of nonstop 2 second polling + file reading
- [x] Wrap each command in an undo group
    - [ ] **Note: will eventually need to add: Maybe Autosaving before it runs (for easy revert), wrapping each ai agent call into an undo group instead of each command, Maybe Cubic only undo history/viewer/dedicated keybind (to be done in ui step)
- [ ] Finish MCP functionality - Identify potential missing functionality that I would need for my product
    - [x] see "*missing mcp feat overview claude code chat"
        - [x] Impl + add testing for tier 1
        - [x] Impl + add testing for tier 2
        - [x] Visually verify all tiers
    - [ ] **Making sure AI reads before edits/deletes + saves to somewhere so it can easily revert? (assuming user doesn't do ctrl+z)
    - [ ] figure out why testing suite runtime speed varies (sometimes ultra fast, sometimes seems to go thru each test one at a time)
    - [ ] Ensure Create/read/update/delete functionality for all functions/commands + revertibility
- [ ] **verify that MCP tools/commands are robust/broad enough + add this note to Claude MD**
    - **id have a tool for creating a layer, and within that specifying what type of layer, not necessarily a new command/tool for each type of layer. I want that robustness in my codebase.

## Phase 1
- [x] Evaluate + organize what functionalities we have + the CRUD of each
- [x] Update mcp-bridge-auto.jsx to be more modularized into different file (new separate file for each CRUD thing: like for layers, expressions, compositions, etc. instead of all in this file)
- [x] Setup to be able to test mcp server functionality in after effects without needing to have claude run everything
    - [x] Fix it so that its changes + tests are viewable/self verifiable by the user
- [x] Make sure error states are consistent across scripts + tests
- [x] Make sure test files have consistent header documents + test all script CRUD functions + properly domain scoped