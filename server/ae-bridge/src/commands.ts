/**
 * Single source of truth for every command name the MCP server exposes via runScript.
 *
 * - The `allowedScripts` whitelist in `src/index.ts` is derived from this array.
 * - The `listCommands` bridge intercept in `src/bridge/wsBridge.ts` returns this array.
 * - The secret command registry now lives in the proxy/ Worker package
 *   (`proxy/src/secrets/command-params.ts`); its `proxy/tests/drift-guard.test.ts`
 *   asserts this array matches the registry keys. `server/ai` ships a codegen'd
 *   names-only mirror (`src/tools/command-names.generated.ts`) for its dispatch guard.
 *
 * When you add a new ExtendScript handler:
 *   1. Add its name here.
 *   2. Add a `case` in `_dispatchSwitch()` in `src/scripts/bridge.jsx`.
 *   3. If read-only, add to `READ_ONLY_COMMANDS` in `bridge.jsx`.
 *   4. Add it to `proxy/src/secrets/command-params.ts` (the registry) + regenerate the
 *      mirror (`node proxy/scripts/gen-command-names.mjs`).
 *   (The proxy drift-guard test will fail CI until steps 1 + 4 agree.)
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
  "cropComp",
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
  "getLayerProperties",
  "setLayerProperty",
  // Layers — hierarchy & transform
  "setLayerParent",
  "addNullToLayers",
  "getLayerColors",
  "moveLayer",
  "setAnchorPoint",
  "centerAnchorPoint",
  "alignLayers",
  "distributeLayers",
  "fitToFrame",
  "sequenceLayers",
  // Layers — time ops
  "splitLayer",
  "mergeLayer",
  "trimLayer",
  "retimeClip",
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
  "cloneKeyframes",
  "fixKeyframeTiming",
  "sequenceKeyframes",
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
  "adjustColor",
  "applyEffectTemplate",
  "setEffectProperty",
  "deleteEffect",
  "introspectMatchNames",
  // Text
  "addTextAnimator",
  "setTextAnimatorProperty",
  "setTextAnimatorRangeSelector",
  "explodeTextLayer",
  "animateText",
  "listFonts",
  // Shapes
  "addShapeOperator",
  "setShapeOperatorProperty",
  "convertToShape",
  "animateShape",
  "extractShapes",
  "mergeShapes",
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
  "cameraMove",
  "createBackground",
  // Multi-command
  "batch",
] as const;
