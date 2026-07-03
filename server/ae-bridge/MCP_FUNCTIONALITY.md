# Cubic MCP — Functionality Map

A complete map of every tool, command, and capability currently exposed by the Cubic MCP server. Use this as the source-of-truth reference when designing the agent brain (Phase 2) or onboarding a new collaborator.

> **Invocation model:** Almost everything is called via `runScript({ script, parameters })` or wrapped in `batch` (itself a `runScript` command). The MCP-level typed tools (`runScript`, `createComposition`, `runBridgeTest`, `getHelp`) are diagnostic/bridge surface only. The real verbs are the handler commands listed below.

---

## 1. MCP-Level Tools (typed surface)

| Tool | Purpose |
|---|---|
| `runScript({ script, parameters })` | Universal entry point. `script` must be in the `allowedScripts` list; `parameters` is forwarded to the AE handler. |
| `createComposition({...})` | Typed convenience wrapper — same as `runScript("createComposition", ...)`. |
| `runBridgeTest` | Calls `getProjectInfo` to verify MCP ↔ AE WebSocket health. |
| `getHelp` | Returns the embedded help/command catalog. |

### Resources & Prompts
- **Resource** `aftereffects://compositions` — returns list of comps in active project.
- **Prompts** `listCompositions`, `analyzeComposition(compositionName)`, `createComposition` — pre-baked user-facing prompt scaffolds.

---

## 2. Project & Composition

### Project (read)
| Command | Description |
|---|---|
| `getProjectInfo` | Project filename, path, dirty state, comp count. |
| `getProjectPath` | Absolute path to the saved project, or null if unsaved. |
| `listCompositions` | All comps in the project. |
| `listProjectItems` | Every item in the Project Panel (footage, comps, solids, folders). |
| `getCompositionInfo({compName})` | Full comp details: duration, fps, resolution, work area, layers. |

### Project (write)
| Command | Description |
|---|---|
| `saveProject({saveAs?})` | Save in place, or pass `saveAs` (absolute fsName) to save-as to a new path. |
| `restoreProject` | Reopen the `.aep` from the agent loop's pre-turn `.cubic-backups/<sessionId>/` snapshot — the model-facing "undo that" (server injects `sessionId`; walks back one turn per call; `noop` at the earliest point). |
| `deleteProjectItem({name})` | Remove an item from the Project Panel. |
| `deleteUnusedSolids` | Garbage-collect orphan solids. |

### Composition (CRUD)
| Command | Description |
|---|---|
| `createComposition({name, width, height, pixelAspect?, duration?, frameRate?, backgroundColor?})` | New comp. |
| `setCompositionProperties({compName, ...})` | Update name, width, height, duration, fps, bg, **workArea**, **displayStartTime**, **resolutionFactor**, **shutterAngle/Phase**, **motionBlur**, **draft3d**. Returns `previousValues` for revert. |
| `duplicateComposition({compName, deep?})` | Shallow or full recursive duplicate (deep traverses nested pre-comps). |
| `deleteComposition({compName})` | Remove comp from project. |

### Playhead
| Command | Description |
|---|---|
| `getCurrentTime({compName?})` | Current playhead position (seconds + frame). |
| `setCurrentTime({compName, timeInSeconds \| frame})` | Move the playhead. |

### Rendering / Vision
| Command | Description |
|---|---|
| `saveFrameToPng({compName, timeInSeconds?, filePath?})` | Renders a single frame to PNG. Default output `~/.cubic/frames/frame_<ts>.png`. Returns text JSON + inline base64 PNG image block. **Powers vision-in-the-loop for self-healing.** |

---

## 3. Layers — Lifecycle

### Create (single dispatcher)
| Command | Description |
|---|---|
| `createLayer({compName, type, ...})` | Single entry point. `type` ∈ `text \| shape \| solid \| adjustment \| null \| camera \| light`. Adjustment layers are solids w/ `isAdjustment` flag. |

Per-type parameter surface:
- **text** — `text`, `fontFamily`, `fontSize`, `fillColor`, position, inPoint/outPoint
- **shape** — see §5 (shapes)
- **solid** — `color`, `width`, `height`, `duration`, `isAdjustment`
- **null** — `position`, `width`, `height`, `threeDLayer`, in/out
- **camera** — `cameraType` (oneNode / twoNode), `centerPoint`, `startTime`, `duration`, plus DOF / focusDistance / aperture / blurLevel
- **light** — `lightType` (parallel / spot / point / ambient), `color`, `intensity`, cone params, falloff, shadow opts

### Read
| Command | Description |
|---|---|
| `getLayerInfo({compName, layerIndex})` | Type, transform values, 3D flag, autoOrient, motion blur, all toggles, type-specific (fillColor for text, etc.). |
| `getSelectedLayers({compName?})` | The layers highlighted in AE's timeline — primary context signal for the agent. |
| `getSelectionDetails({compName?})` | Selected layers plus the specific selected properties (path + value) — the finer-grained "what is the user looking at" signal merged into per-turn context. |
| `getLayerProperty({compName, layerIndex, propertyPath})` | Path-addressable getter for any nested property (e.g. `["Contents","Group 1","Stroke 1","Color"]`). |

### Update
| Command | Description |
|---|---|
| `setLayerProperties({compName, layerIndex, ...})` | Mutate name, label, comment, position, scale, rotation, opacity, fillColor (text), fontFamily, fontSize, textContent, blendMode, threeDLayer, motionBlur, collapseTransformation, shy, solo, guideLayer, quality, autoOrient, in/outPoint, startTime, stretch, **timeRemap enable**. Returns `previousValues` for revert. `overwriteKeyframes` guard prevents accidental keyframe destruction. |
| `batchSetLayerProperties({compName, operations[]})` | Same args, applied to many layers in one undo group. |
| `setLayerProperty({compName, layerIndex, propertyPath, value})` | Generic path-based setter — write any nested property the typed setters don't cover. |
| `moveLayer({compName, layerIndex, newIndex})` | Reorder. Returns `previousIndex`. |
| `setLayerParent({compName, layerIndex, parentIndex})` | Parent / unparent. Returns `previousParent`. |
| `duplicateLayer({compName, layerIndex})` | Clone. |

### Delete
| Command | Description |
|---|---|
| `deleteLayer({compName, layerIndex})` | Remove layer. |

### Selection
| Command | Description |
|---|---|
| `setSelectedLayers({compName, layerIndices[]})` | Programmatic selection. Returns `previousSelection`. |

---

## 4. Layers — Structure & Composition

### Time
| Command | Description |
|---|---|
| `splitLayer({compName, layerIndex, timeInSeconds})` | Razor cut. |
| `mergeLayer({compName, layerIndex})` | Inverse of split — rejoin adjacent halves. |
| `trimLayer({compName, layerIndex, inPoint?, outPoint?, startTime?, mode?})` | Trim in/out/start. Returns `previousValues`. |
| `setTimeRemapEnabled({compName, layerIndex, enabled})` | Toggle time remap. |

### Spatial
| Command | Description |
|---|---|
| `setAnchorPoint({compName, layerIndex, position})` | 9-position grid: `TOP_LEFT \| TOP_CENTER \| TOP_RIGHT \| MIDDLE_LEFT \| CENTER \| MIDDLE_RIGHT \| BOTTOM_LEFT \| BOTTOM_CENTER \| BOTTOM_RIGHT`. Preserves visual position. Returns `previousValues`. |
| `centerAnchorPoint({...})` | Alias for `CENTER`. |
| `alignLayers({compName, layerIndices, alignment, reference})` | `alignment`: `LEFT \| HORIZONTAL_CENTER \| RIGHT \| TOP \| VERTICAL_CENTER \| BOTTOM`. `reference`: `COMPOSITION \| SELECTION`. |
| `sequenceLayers({compName, layerIndices, gapTime?, orderType?})` | Stagger inPoints. `orderType`: `TOP_DOWN \| BOTTOM_UP \| RANDOM`. |
| `distributeLayers3D({compName, layerIndices, shape, ...})` | Position ≥2 layers in a 3D shape — backend computes all XYZ coords. `shape`: `cylinder` \| `grid`. |

#### distributeLayers3D — detail

The backend (ExtendScript) does the geometry so the LLM doesn't have to. Automatically enables `layer.threeDLayer = true` on every targeted layer (before writing Position, per the required AE ordering).

| Shape | Description | Key params |
|---|---|---|
| `cylinder` | Layers around a Z-axis cylinder, optionally stacked in depth-rings (tunnel). | `radius` (default 400), `rings` (default 1), `depthSpacing` (default 500), `axis` (z\|y\|x) |
| `grid` | Rows × cols planar grid with optional Z-step per plane. | `rows`, `cols`, `spacing:[x,y,z]` (default [200,200,0]) |

Shared params: `center:[x,y,z]` (default comp center, z=0), `enable3D` (default true), `faceCamera` (sets autoOrient=cameraOrPOI), `overwriteKeyframes`

Returns: `{ shape, layersPositioned, positionedLayers: [{ layerIndex, position:[x,y,z], previousPosition, previousThreeDLayer }] }` — `previousPosition`/`previousThreeDLayer` enable inverse-CRUD rollback.

> For a tunnel scene pair with `createCamera({ oneNode: true, position: [cx, cy, -1000] })`. v2 deferred shapes: sphere, helix, ring, line.

### Nesting & Mattes
| Command | Description |
|---|---|
| `precompose({compName, layerIndices, newCompName, moveAttributes?})` | Wrap layers in a new comp. |
| `decomposeLayer({compName, layerIndex})` | Inverse of precompose — flatten a pre-comp back into its parent. |
| `setTrackMatte({compName, layerIndex, mode})` | Apply a track matte (alpha, alpha inverted, luma, luma inverted). |

---

## 5. Shapes

| Command | Description |
|---|---|
| `createShapeLayer({compName, shapeType, ...})` | Create rectangle / ellipse / polygon / star with fill, stroke, sizing. |
| `addShapeOperator({compName, layerIndex, type, ...})` | Add a shape operator. `type` ∈ `trimPaths \| repeater \| roundedCorners \| gradientFill \| gradientStroke`. |
| `setShapeOperatorProperty({compName, layerIndex, operatorPath, propertyName, value})` | Update any operator parameter. |
| `convertToShape({compName, layerIndex})` | Convert text or vector layer to shapes (menu-driven; may be CEP-gated in some AE versions). |

> **Color gradients on shape operators**: stop colors on a shape's gradient fill/stroke can't be set via scripting. Use the **Gradient Ramp** effect (`applyEffect("ADBE Ramp")` + `setEffectProperty` for Start/End Color) — covers gradients with color fully.

---

## 6. Text

| Command | Description |
|---|---|
| `createTextLayer({compName, text, fontFamily?, fontSize?, fillColor?, ...})` | New text layer. |
| `addTextAnimator({compName, layerIndex, properties[]})` | Per-character animator. Properties ∈ position/scale/rotation/opacity/color/tracking/skew/etc. |
| `setTextAnimatorProperty({compName, layerIndex, animatorIndex, propertyName, value})` | Update one animator property. |
| `setTextAnimatorRangeSelector({compName, layerIndex, animatorIndex, ...})` | Configure the range selector — `start`, `end`, `offset`, `units` (percent/index), `basedOn` (characters/words/lines), `mode`, `amount`, `shape`, `randomize`, `randomSeed`. |
| `explodeTextLayer({compName, layerIndex, splitMethod})` | Split text into per-character / per-word / per-line layers. `splitMethod` ∈ `CHARACTERS \| WORDS \| LINES`. Uses animator-mask technique to preserve kerning and layout. |

---

## 7. Animation — Keyframes

| Command | Description |
|---|---|
| `getLayerKeyframes({compName, layerIndex, propertyName?})` | All keyframes including `inTemporalEase` / `outTemporalEase` / spatial tangents / interpolation type. |
| `setLayerKeyframe({compName, layerIndex, propertyName, timeInSeconds, value})` | Create / update a single keyframe. |
| `setKeyframeEasing({compName, layerIndex, propertyName, keyIndex, inEase?, outEase?, interpolationType?})` | Set temporal ease (influence + speed) per dimension. Supports `BEZIER` / `LINEAR` / `HOLD`. Easy Ease = `BEZIER` + `KeyframeEase(0, 33.33)`. |
| `setKeyframeSpatial({compName, layerIndex, propertyName, keyIndex, inTangent?, outTangent?, autoBezier?, continuous?, roving?})` | Spatial tangents for position keyframes — full motion-path control. |
| `copyKeyframeEasing({sourceLayer, targetLayer, propertyName})` | Clone easing curves between layers without touching values. |
| `removePropertyKeyframes({compName, layerIndex, propertyName})` | Wipe all keyframes on a property. |

---

## 8. Animation — Expressions

| Command | Description |
|---|---|
| `getLayerExpressions({compName, layerIndex})` | All expressions on a layer with property path + expression string + enabled flag. |
| `setLayerExpression({compName, layerIndex, propertyName, expressionString? \| preset?, presetParams?})` | Set raw expression string OR a named preset. |

### Expression presets
| Preset | Use |
|---|---|
| `INERTIAL_BOUNCE` | Classic spring-back overshoot after keyframe lands. |
| `ELASTIC` | More oscillation than inertial bounce. |
| `OVERSHOOT` | Soft single-overshoot settle. |
| `WIGGLE` | Randomized organic motion. Params: `freq`, `amp`. |
| `AUTO_FADE` | Fades opacity in/out at layer in/out points. |
| `LOOP_OUT` / `LOOP_IN` / `LOOP_PINGPONG` | Loop keyframes beyond their range. |

All presets accept `presetParams` overrides.

### Recipes (macro)

| Command | Description |
|---|---|
| `applyMotionRecipe({compName, layerIndices, recipe, ...})` | Apply a named motion recipe to N layers in one call. Computes all keyframes + easing + expressions internally. |

**Recipe table:**

| Recipe | Effect |
|---|---|
| `popIn` | Scale 0→100% + Opacity 0→100. `bounce:true` adds INERTIAL_BOUNCE on Scale. |
| `popOut` | Inverse of popIn. |
| `fadeIn` | Opacity 0→100. |
| `fadeOut` | Opacity 100→0. |
| `slideIn` | Position offset→current. Default `from=[-200,0,0]`, overridable. |
| `slideOut` | Position current→offset. |
| `scaleIn` | Scale 0→100% only. Honors `bounce`. |
| `bounceIn` | Alias for popIn with `bounce:true`. |
| `wiggle` | Applies WIGGLE expression to Position. `intensity` scales amp. |

Params: `layerIndices` (array, required), `startTime` (default 0), `duration` (default 0.5), `stagger` (per-layer cascade delay), `ease`, `bounce`, `intensity` (0–1), `from` ([x,y,z] slide offset override), `overwriteKeyframes`

Returns: `{ recipe, layersAffected, results: [{ layerIndex, startTime, keyframesAdded, expressionsApplied, previousValues }] }`

> **Token savings:** 20 cards with popIn+bounce = 1 call vs ~200 individual setLayerKeyframe/setKeyframeEasing/setLayerExpression calls. All mutations stay inside the single outer undo group — one ⌘Z reverts everything.

---

## 9. Masks

| Command | Description |
|---|---|
| `getLayerMasks({compName, layerIndex})` | All masks with vertices, **inTangents/outTangents** (bezier), closed flag, mode, opacity, feather, expansion. |
| `setLayerMask({compName, layerIndex, maskIndex?, vertices, inTangents?, outTangents?, closed?, mode?, opacity?, feather?, expansion?, name?})` | Create or update a mask. Bezier tangents supported. Returns `previousValues`. |
| `deleteLayerMask({compName, layerIndex, maskIndex})` | Remove. Returns the deleted mask snapshot for revert. |

Mask modes: `NONE`, `ADD`, `SUBTRACT`, `INTERSECT`, `LIGHTEN`, `DARKEN`, `DIFFERENCE`.

---

## 10. Effects

### Effect commands
| Command | Description |
|---|---|
| `getLayerEffects({compName, layerIndex})` | All effects with matchName, name, enabled, properties + values. |
| `applyEffect({compName, layerIndex, effectName? \| effectMatchName? \| presetPath?, effectSettings?})` | Apply an effect. Prefer a friendly `effectName` (glow, drop-shadow, …) — resolved to the real matchName via `EFFECT_DICT`; raw `effectMatchName` or a `.ffx` `presetPath` also work. A bad name returns a self-healable error listing known effects; a partial apply returns a `warning` (effect added, but a setting didn't stick). |
| `applyEffectTemplate({compName, layerIndex, templateName, customSettings?})` | Apply a built-in template bundle. |
| `setEffectProperty({compName, layerIndex, effectIndex, propertyName, value})` | Update one property. Returns `previousValue`. |
| `deleteEffect({compName, layerIndex, effectIndex})` | Remove. |
| `introspectMatchNames` | Internal/diagnostic — asks AE for the real effect matchNames; feeds the `tests/fixtures/ae-matchnames.json` fixture + the `test:matchnames` CI guard. Not for general agent use. |

### Built-in effect templates
`gaussian-blur`, `directional-blur`, `color-balance`, `brightness-contrast`, `curves`, `glow`, `drop-shadow`, `cinematic-look`, `text-pop`

### Common matchNames
Prefer a friendly `effectName` (gaussian-blur, glow, drop-shadow, …) — `applyEffect` resolves it to the
right matchName via the curated `EFFECT_DICT` in `effects.jsx`, so you never guess. matchNames below are
AE-verified (see `tests/fixtures/ae-matchnames.json`, generated from real AE); note they often differ
from the display name (the trap that shipped the glow bug).
| Effect (display name) | matchName |
|---|---|
| Gaussian Blur | `ADBE Gaussian Blur 2` |
| Directional Blur | `ADBE Motion Blur` |
| Brightness & Contrast | `ADBE Brightness & Contrast 2` |
| Curves | `ADBE CurvesCustom` |
| Glow | `ADBE Glo2` |
| Drop Shadow | `ADBE Drop Shadow` |
| Color Balance (HLS) | `ADBE Color Balance (HLS)` |
| Hue/Saturation | `ADBE HUE SATURATION` |
| Vibrance | `ADBE Vibrance` |
| Gradient Ramp | `ADBE Ramp` |

---

## 11. Footage / Project Panel

| Command | Description |
|---|---|
| `listProjectItems` | Enumerate the Project Panel. |
| `importFootage({filePath})` | Bring a file into the Project Panel. |
| `addFootageToComp({compName, itemName})` | Drop an existing project item into a comp as a new layer. |
| `importAssetToComp({filePath, compName})` | One-shot import + place. |
| `deleteProjectItem({name})` | Remove from Project Panel. |
| `deleteUnusedSolids` | GC orphan solids. |

---

## 12. Markers

| Command | Description |
|---|---|
| `addMarker({compName, layerIndex?, timeInSeconds, comment?, duration?, label?, protectedRegion?, chapter?, url?, frameTarget?, cuePointName?, params?})` | Add. Omit `layerIndex` for a composition marker. |
| `listMarkers({compName, layerIndex?})` | Read all. |
| `updateMarker({compName, layerIndex?, markerIndex, ...})` | Edit. Returns `previousValues`. |
| `removeMarker({compName, layerIndex?, markerIndex})` | Delete. Returns full snapshot for revert. |

---

## 13. Batch

| Command | Description |
|---|---|
| `batch({commands[], groupLabel?, stopOnError?})` | Run many commands in a single tool call wrapped in one outer undo group. |

```json
{
  "groupLabel": "fade in title",
  "commands": [
    { "command": "createTextLayer", "args": { "compName": "Main", "text": "Hello" } },
    { "command": "setLayerKeyframe", "args": { "compName": "Main", "layerIndex": 1, "propertyName": "Opacity", "timeInSeconds": 0, "value": 0 } }
  ]
}
```

- `groupLabel` becomes the AE Edit > Undo label (`"Undo Cubic: fade in title"`). One ⌘Z reverts the whole turn.
- `stopOnError: true` aborts the rest of the batch on first failure.
- **Default rule:** use `batch` for any operation with more than one mutation.

---

## 14. Cross-Cutting Capabilities

### Undo groups
Every mutating command is wrapped in `app.beginUndoGroup("Cubic: <command>") / endUndoGroup()` via `try/finally`. Read-only commands (the `READ_ONLY_COMMANDS` allowlist) skip the wrapper. `batch` provides one outer group covering its entire body.

### Revertibility (inverse-CRUD)
Programmatic undo is gated by AE for CEP/evalScript contexts. Instead:
- Every `set*` handler returns `previousValues` for replay.
- Every `delete*` handler returns the full snapshot of what it removed.
- Every `create*` has a matching `delete*`.
- Move/parent/select operations return prior state.

This lets the agent revert changes without relying on the user's ⌘Z.

### Structured errors
Handler errors return:
```json
{ "status": "error", "errorCode": "...", "message": "...", "line": 123, "stack": "..." }
```
`errorCode` ∈ `COMP_NOT_FOUND`, `LAYER_NOT_FOUND`, `LAYER_INDEX_OOB`, `PROPERTY_NOT_FOUND`, `INVALID_ARGS`, `TIME_OUT_OF_RANGE`, `RENDER_FAILED`, `UNKNOWN_COMMAND`, `HANDLER_UNCAUGHT`, `INTERNAL_ERROR`, `BATCH_FAILED` (a sub-command of a `batch` failed — per-command codes in `results[]`). The MCP layer surfaces these as `isError: true` + `structuredContent` for agent self-healing loops.

### Vision-in-the-loop
`saveFrameToPng` returns both the text JSON and an inline base64 PNG content block, enabling an agent to "see" the result of its mutations between turns.

### Read-only allowlist
`getProjectInfo`, `listCompositions`, `getCompositionInfo`, `getLayerInfo`, `getLayerKeyframes`, `getLayerExpressions`, `getLayerMasks`, `getLayerEffects`, `getSelectedLayers`, `getSelectionDetails`, `listProjectItems`, `listMarkers`, `getCurrentTime`, `getProjectPath`, `getLayerProperty`.

---

## 15. Architecture (one-paragraph)

Node MCP server (`src/index.ts`) hosts a WebSocket on `127.0.0.1:0` (an OS-assigned dynamic port, published with a per-launch session token to `~/.cubic/conn.json`; every client authenticates with the token in its first `hello` frame), receives MCP tool calls, and forwards `{ id, command, args }` to a CEP panel running inside After Effects. The panel runs `evalScript(handlersBundle + footer)`, where the bundle is the concatenated `.jsx` domain files plus `bridge.jsx` (which provides the dispatch switch, undo wrappers, batch loop, error envelope, and helpers). Results come back synchronously through the same WS connection. No polling, no file-watching, no `getResults` round-trip.

---

# Possible Improvements

**Top improvements based on better MVP/leverage:** 12, 11, 13, 22, 21, 19, 20, 17, 5 (audio)

Ordered roughly by leverage. None are blockers for Phase 2 — these are the things worth picking up opportunistically.

### Surface cleanup
1. **Retire `getResults`** — ✅ Done. Removed from the typed surface (results are synchronous).
2. **Retire `testAnimation`** — ✅ Done. Removed; `runBridgeTest` covers health-check needs.
3. **Single source of truth for `allowedScripts`** — ✅ Done. The registry now lives only in `src/commands.ts` (`COMMANDS`); `index.ts` imports and validates against it (no duplication with `bridge.jsx`).
4. **`getHelp` text drift** — references `createTextLayer` / `createShapeLayer` as if they're separate tools; the canonical entry point is `createLayer({type:"..."})`. Align the docstring so the agent doesn't waste tokens on stale names.

### Capability gaps worth considering
5. **Audio support** — no commands for audio levels, audio keyframes, or `valueAtTime`-based audio-reactive expressions. Out of MVP scope per the PRD, but worth flagging if SaaS launch videos ever need beat sync.
6. **Render queue / export** — explicitly out of scope per PRD §6, but if the agent ever needs to ship a final MP4, you'd add `addToRenderQueue` + `startRender`. If web-embedded launch videos ever become a target, add a Bodymovin/Lottie export path here too (`.json` out for direct web playback).
7. **Layer styles** (vs. effects) — drop shadow / inner glow / bevel as native layer styles, not effects. Currently the agent reaches these via the Effects panel equivalents, which is functionally fine but stylistically different.
8. **Essential Graphics / Master Properties** — exposing controls to the EGP would let the agent build reusable templates. Post-MVP territory.
9. **Find/replace text across layers** — useful for one-shot brand swaps; currently doable via `getLayerInfo` + `setLayerProperties` but a single helper would save tokens.
10. **Composition flowchart introspection** — list comp-of-comp dependencies. Useful for "this comp is used in 3 other comps, are you sure you want to delete it?" agent flows.
11. **Merge Paths shape operator** — add `mergePaths` (matchName `ADBE Vector Filter - Merge`) to the `addShapeOperator` type list alongside `trimPaths` / `repeater` / `roundedCorners`. Enables liquid/metaball-style circle merging in scene transitions without the four-call Composite + Blobbylize workaround. ~30 min of handler work.
12. **Vertex-count-aware path generator** — helper like `convertToParametricPath({shape, vertexCount})` that emits a Bezier path with a caller-specified vertex count for AE's parametric shapes (ellipse, rect, rounded rect, polygon). Required for *reliable* shape morphing — without matching topology between morph endpoints AE picks a default interpolation and produces a teleport, not a morph. Turns "shape morphs are theoretically possible via `setLayerKeyframe`" into "shape morphs are first-class."
13. **`setMaskKeyframe`** — `setLayerMask` writes vertices/tangents but it's a `set`, not a keyframe writer. Animated mask reveals (logo draw-on, animated iris, hand-tuned mask transitions) currently route through generic `setLayerProperty` against the Mask Path property, which is fragile and easy to get wrong. A dedicated `setMaskKeyframe` mirroring `setLayerKeyframe` would close the gap.
14. **Stop-color scripting on shape gradients** — known AE scripting limitation (documented in §5). Workaround is the Gradient Ramp effect, which covers ~95% of cases. Worth tracking in case a future AE release lifts the restriction.
15. **Puppet pin / mesh-warp** — squash-and-stretch ball deformation on impact, organic character-style motion. CEP-gated and finicky; recommend faking via anchor-at-bottom + non-uniform Scale keyframes for the squish, which is what most designers do in practice anyway. Listed here so we have a deliberate "not building this" record, not because it should be built.

### Performance / DX
16. **Batch streaming results** — currently `batch` returns one consolidated response. For long batches a streaming protocol would surface partial progress to the agent.
17. **Selective field reads** — `getLayerInfo` returns everything; a `fields?` parameter would let the agent pull only what it needs (token savings on big comps).
18. **Server-side caching of getProjectInfo / listCompositions** — invalidate on any mutation. Reduces redundant WS round-trips during a turn.

### Safety / observability
19. **Pre-mutation snapshot** — autosave the project (or write a sidecar `.json` of all mutated state) before each turn so the user has a last-known-good even if undo history is overwhelmed. Mentioned in TODO as Phase 2/3.
20. **Mutation log** — append a per-turn JSONL of every command + previousValues to `~/.cubic/log/`. Powers Cubic's own undo viewer in the Phase 4 panel.
21. **Structured warnings** — handlers occasionally encounter non-fatal weirdness (e.g. effect applied but a property name didn't match). Right now they succeed silently. Returning `{ status: "ok", warnings: [...] }` would give the self-healing loop more to chew on.

### Future expressions / motion library
22. **Expanded preset library** — beyond the 8 current presets: `SPRING`, `SETTLE`, `ROTATION_DECAY`, `SCALE_BREATHE`, `RANDOM_OFFSET`. Likely lives as system prompt content rather than handler code (per TODO Phase 2 note).
23. **`applyMotionRecipe`** — ✅ Implemented. See §8 "Recipes (macro)".
24. **`distributeLayers3D`** — ✅ Implemented. See §4 "Spatial".