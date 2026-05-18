## General Roadmap
✅ Phase 1 — MCP validation
➡️ Phase 1.5 - **Fixing the MCP + Finishing/adding all functionality that I need + Organizing it for CRUD for each operation + Comprehensive testing suite
Phase 2 — Build the LLM brain + agent architecture (system prompt + Claude API backend)
Phase 3 (self-healing/correcting/bug checking loop)
Phase 4 (After effects panel UI)
Phase 5 (Post MVP stuff?)

Do a comprehensive analysis of my @server/mcp/src/scripts/ modules, are all the commands organized into their proper domain files, and named robustly enough to cover that domains entire scope (eg. id have a tool for creating a layer, and within that specifying what type of layer, not necessarily a new command/tool for each type of layer. I want that robustness in my codebase.). Also Ensure all scripts/stuff are coded optimally + no hardcoded stuff reducing efficiency/shortcuts just to pass tests. Finally Verify that MCP tools/commands are robust + broad enough + have Create/read/update/delete functionality for all functions/commands + ability to revert changes for the ai (like by calling the opposite command/resetting value + reading value beforehand if users dont do ctrl z)

then after your analysis of the scripts, analyze the @server/mcp/tests/ to make sure all the information matches and is properly tested. Btw rn my tests are all passing and working as intended, but im more focused that the commands are in the right spots + organized properly + robustly designed

---
1. Obfuscation (meaningful protection, not foolproof)
    - Run javascript-obfuscator on the bundled JSX + compiled MCP server before distribution
    - Makes casual reading/copying painful; deters 95% of people
    - Determined reverse engineers can still work through it

2. Package the MCP server as a binary
    - Tools like pkg or nexe bundle Node.js + your JS into a single executable
    - Much harder to reverse engineer than plain JS
    - This is actually realistic for your MCP server specifically

## Phase 2
- [ ] x
- [ ] ***Eg. Preset Library?? <-- might be done in phase 2 (give the system prompt a good understanding)

## Phase 1.5
- [x] Critical: migrate mcp architecture to CEP extension instead of nonstop 2 second polling + file reading
- [x] Wrap each command in an undo group
    - [ ] **Note: will eventually need to add: Maybe Autosaving before it runs (for easy revert), wrapping each ai agent call into an undo group instead of each command, Maybe Cubic only undo history/viewer/dedicated keybind (to be done in ui step)
- [ ] Finish MCP functionality - Identify potential missing functionality that I would need for my product
    - [x] see "*missing mcp feat overview claude code chat"
        - [x] Impl + add testing for tier 1 — motion vocabulary blockers
            - precompose, adjustment layer, track matte, Trim Paths operator, Repeater + Rounded Corners, text animators (per-character), getLayerProperty (read any nested prop)
        - [x] Impl + add testing for tier 2 — workflow primitives
            - splitLayer, trimLayer, markers (comp + layer), getCurrentTime/setCurrentTime, setSelectedLayers, saveProject/getProjectPath, centerAnchorPoint
        - [x] Impl + add testing for tier 3 — Phase 3 self-healing enablers
            - saveFrameToPng (vision-in-the-loop), structured error channel ({ errorCode, message, line } + dispatchTool MCP surface)
        - [x] Impl + add testing for tier 4 — fills, modes, depth
            - gradientFill/gradientStroke operators, setLayerProperty (generic path setter mirroring getLayerProperty), layer toggles: motionBlur, collapseTransformation, shy, solo, guideLayer, quality, autoOrient, label, comment
            You can have gradients with color — use the Gradient Ramp effect (applyEffect("ADBE Ramp") +
            setEffectProperty for Start Color / End Color).

            What can't be done: scripting the color stops on a shape layer's gradient fill/stroke operator
            specifically (the one inside Contents > Group > Gradient Fill 1). Those colors are locked.

            So: gradients with color ✅, just not via shape operators. Gradient Ramp effect covers it fully.
        - [x] Visually verify all tiers
    - [x] **Making sure AI reads before edits/deletes + saves to somewhere so it can easily revert? (assuming user doesn't do ctrl+z)
    - [x] figure out why testing suite runtime speed varies (sometimes ultra fast, sometimes seems to go thru each test one at a time)
- [ ] **do a claude audit w opus - Ensure all scripts/stuff are coded optimally + no hardcoded stuff reducing efficiency/shortcuts just to pass tests**
- [ ] **do a claude audit w opus - verify that MCP tools/commands are robust + broad enough + have Create/read/update/delete functionality for all functions/commands + revertibility ability (if users dont do ctrl z)**
    - **id have a tool for creating a layer, and within that specifying what type of layer, not necessarily a new command/tool for each type of layer. I want that robustness in my codebase.
- [ ] ^^After above 2 are done, move onto Phase 2

## Phase 1
- [x] Evaluate + organize what functionalities we have + the CRUD of each
- [x] Update mcp-bridge-auto.jsx to be more modularized into different file (new separate file for each CRUD thing: like for layers, expressions, compositions, etc. instead of all in this file)
- [x] Setup to be able to test mcp server functionality in after effects without needing to have claude run everything
    - [x] Fix it so that its changes + tests are viewable/self verifiable by the user
- [x] Make sure error states are consistent across scripts + tests
- [x] Make sure test files have consistent header documents + test all script CRUD functions + properly domain scoped