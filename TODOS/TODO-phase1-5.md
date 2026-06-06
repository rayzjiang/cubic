## Phase 1.5
Audit analysis prompts
Do a comprehensive analysis of my @server/ae-bridge/src/scripts/ modules, to ensure we have all the features i would need to create great motion graphics/design named robustly enough to cover that domains entire scope. Also Ensure all scripts/stuff are coded optimally + no hardcoded stuff reducing efficiency/shortcuts just to pass tests. Finally Verify that MCP tools/commands are robust + broad enough + have Create/read/update/delete functionality for all functions/commands + ability to revert changes for the ai (like by calling the opposite command/resetting value + reading value beforehand if users dont do ctrl z and ask ai to revert). Lmk if there r issues worth fixing before i move onto phase 2. this is like a final check (ive been working hard to refactor scripts + tests + have enough mcp functionality to create amazing smooth, creative, satisfying launch videos) or if there are none

Do a comprehensive analysis of the scripts, analyze the @server/ae-bridge/tests/ to make sure all the information matches and all mcp functionality is properly tested/working. Btw rn my tests are all passing and working as intended, but im more focused that the commands are in the right spots + organized properly + robustly designed + test all mcp features

- [x] Critical: migrate mcp architecture to CEP extension instead of nonstop 2 second polling + file reading
- [x] Wrap each command in an undo group
    - [ ] **Note: will eventually need to add: Maybe Autosaving before it runs (for easy revert), wrapping each ai agent call into an undo group instead of each command
    - [ ] Maybe Cubic only undo history/viewer/dedicated keybind (to be done in ui step)
- [x] Finish MCP functionality - Identify potential missing functionality that I would need for my product
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
- [x] **do a claude audit w opus - Ensure all scripts/stuff are coded optimally + no hardcoded stuff reducing efficiency/shortcuts just to pass tests**
- [x] **do a claude audit w opus - verify that MCP tools/commands are robust + broad enough + have Create/read/update/delete functionality for all functions/commands + revertibility ability (if users dont do ctrl z)**
    - **id have a tool for creating a layer, and within that specifying what type of layer, not necessarily a new command/tool for each type of layer. I want that robustness in my codebase.
- [x] **opus scripting audit v4 - opusplan + fix those**
    - A1: time remap (setTimeRemapEnabled + stretch in setLayerProperties/batchSetLayerProperties)
    - A2: spatial keyframe control (setKeyframeSpatial — tangents, autoBezier, continuous, roving)
    - A3: bezier mask paths (inTangents/outTangents in setLayerMask/getLayerMasks/deleteLayerMask)
    - A4: setCompositionProperties parity (workArea*, displayStartTime, resolutionFactor, shutterAngle/Phase, motionBlur, draft3d)
    - A6: full camera/light surface (createCamera: startTime/duration/DOF/focusDistance/aperture/blurLevel; createLightLayer: cone/falloff/shadow opts; getLayerInfo/setLayerProperties extended)
    - B1-B7: all revert gaps fixed (moveLayer.previousIndex, setLayerParent.previousParent, updateMarker.previousValues, removeMarker.removedMarker snapshot, trimLayer.previousValues, centerAnchorPoint.previousValues, setSelectedLayers.previousSelection)
    - markers.jsx: label + protectedRegion round-tripped through all handlers
- [x] **opus testing audit v4 - opusplan + fix those**
- [x] **implement test coverage for opus scripting audit v4**
- [x] **impl tools + testing for 3rd party plugin features (gemini breakdown)**
- [x] **impl applyMotionRecipe + distributeLayers3D (macro commands for complex multi-layer scenes)**
    - applyMotionRecipe: popIn/popOut/fadeIn/fadeOut/slideIn/slideOut/scaleIn/bounceIn/wiggle; layerIndices[] + stagger
    - distributeLayers3D: cylinder (tunnel) + grid; backend computes XYZ so LLM doesn't do geometry
    - Tests added to animation.mjs + layers.mjs
- [x] ^^After above 3 are done, move onto Phase 2