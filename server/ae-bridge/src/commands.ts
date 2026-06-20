/**
 * Single source of truth for every command name the MCP server exposes via runScript.
 *
 * - The `allowedScripts` whitelist in `src/index.ts` is derived from this array.
 * - The `listCommands` bridge intercept in `src/bridge/wsBridge.ts` returns this array.
 * - `server/ai` keeps a curated mirror (`src/tools/definitions.ts`) validated by a
 *   drift-guard test that calls `listCommands` and asserts it matches.
 *
 * When you add a new ExtendScript handler:
 *   1. Add its name here.
 *   2. Add a `case` in `_dispatchSwitch()` in `src/scripts/bridge.jsx`.
 *   3. If read-only, add to `READ_ONLY_COMMANDS` in `bridge.jsx`.
 *   4. Update `server/ai/src/tools/definitions.ts` COMMAND_NAMES to match.
 *   (The drift-guard test will fail CI until step 4 is done.)
 */
export const COMMANDS: readonly string[] = [
  // Compositions / project info
  "listCompositions",
  "getProjectInfo",
  "getCompositionInfo",
  "createComposition",
  "setCompositionProperties",
  "deleteComposition",
  "duplicateComposition",
  // Playhead
  "getCurrentTime",
  "setCurrentTime",
  // Layers — selection & info
  "getLayerInfo",
  "getSelectedLayers",
  "getSelectionDetails",
  "setSelectedLayers",
  // Layers — create / duplicate / delete
  "createLayer",
  "duplicateLayer",
  "deleteLayer",
  // Layers — properties
  "setLayerProperties",
  "batchSetLayerProperties",
  "getLayerProperty",
  "setLayerProperty",
  // Layers — hierarchy & transform
  "setLayerParent",
  "moveLayer",
  "setAnchorPoint",
  "centerAnchorPoint",
  "alignLayers",
  "distributeLayers",
  "sequenceLayers",
  // Layers — time ops
  "splitLayer",
  "mergeLayer",
  "trimLayer",
  "setTimeRemapEnabled",
  // Layers — nesting / mattes
  "precompose",
  "decomposeLayer",
  "setTrackMatte",
  // Keyframes
  "getLayerKeyframes",
  "setLayerKeyframe",
  "setKeyframeEasing",
  "setKeyframeSpatial",
  "copyKeyframeEasing",
  "removePropertyKeyframes",
  // Expressions
  "getLayerExpressions",
  "setLayerExpression",
  // Masks
  "getLayerMasks",
  "setLayerMask",
  "deleteLayerMask",
  // Effects
  "getLayerEffects",
  "applyEffect",
  "applyEffectTemplate",
  "setEffectProperty",
  "deleteEffect",
  "introspectMatchNames",
  // Text
  "addTextAnimator",
  "setTextAnimatorProperty",
  "setTextAnimatorRangeSelector",
  "explodeTextLayer",
  "listFonts",
  // Shapes
  "addShapeOperator",
  "setShapeOperatorProperty",
  "convertToShape",
  // Markers
  "addMarker",
  "listMarkers",
  "updateMarker",
  "removeMarker",
  // Footage / project panel
  "listProjectItems",
  "importFootage",
  "addFootageToComp",
  "importAssetToComp",
  "deleteProjectItem",
  "deleteUnusedSolids",
  "createFolder",
  "updateProjectItem",
  // Project
  "getProjectPath",
  "saveProject",
  "saveFrameToPng",
  "restoreProject",
  // Motion recipes & 3D
  "applyMotionRecipe",
  "distributeLayers3D",
  // Multi-command
  "batch",
] as const;
