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