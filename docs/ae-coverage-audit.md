# After Effects Single-Composition Verb-Coverage Audit
## POSTMVP - at some point, ensure we reach full coverage to allow all users to control basically all of after effects
Backlog of actions a human can perform on a **single composition** in After Effects, classified against Cubic's command set. Source of truth: `server/ae-bridge/src/commands.ts` (allowlist) + `server/ai/src/tools/command-params.ts` (params), cross-checked against the `.jsx` handlers.

**Scope:** Timeline + Effect Controls + property panels — layers, transforms, effects, masks, text, shapes, keyframes, expressions, time remapping, markers. Out of scope (not gaps): render/export, project/footage management, multi-comp/NLE editorial, preferences/workspace.

**On PARTIAL:** the generic escape hatches `setLayerProperty`/`getLayerProperty` (by `propertyPath`) and `setLayerKeyframe`/`removePropertyKeyframes` (by `propertyPath`) can technically reach almost any property by its raw path. Where that is the *only* route, the action is marked **PARTIAL**: reachable, but with no named verb, no catalog surfacing, no defaults, and the model must construct the exact path strings (which the catalog tells it not to guess). For non-technical users driving via the agent, an unsurfaced raw-path operation is effectively unreliable — that is what these PARTIALs flag. Note: the `configurableProperties` wave mitigates many PARTIALs *for objects a command just created* (the returned paths are exact), but not for pre-existing layers the agent didn't just touch.

---

## 1. Layer create / transform / anchor / parent / rig / 3D attributes

| Action | Status | Note |
|---|---|---|
| Create text/shape/solid/adjustment/null/camera/light | COVERED `createLayer` | Full `type` dispatcher. |
| Set position/scale/rotation/opacity/anchor | COVERED `setLayerProperties` / `setLayerProperty` | |
| Set per-axis rotation (X/Y/Z) on 3D layers | PARTIAL `setLayerProperty` | `rotation` is single-value (Z). X/Y/Orientation only via raw propertyPath. |
| Anchor to named position / center | COVERED `setAnchorPoint`, `centerAnchorPoint` | With position compensation. |
| Parent / unparent | COVERED `setLayerParent` | Preserves child transform. |
| Parent without preserving transform (jump) | MISSING | Alt-parent / "jump" option not exposed. Minor. |
| Build control-null rig | COVERED `addNullToLayers` | single / perLayer. |
| Align / distribute (2D) | COVERED `alignLayers`, `distributeLayers` | |
| Fit / fill / stretch to frame | COVERED `fitToFrame` | |
| Reorder layer in stack | COVERED `moveLayer` | |
| Enable 3D layer | COVERED `setLayerProperties` (`threeDLayer`) | |
| Material Options (Casts/Accepts Shadows, Accepts Lights, Ambient/Diffuse/Specular/Shininess/Metal) on AV/solid 3D layers | PARTIAL `setLayerProperty` | Only light layers get `lightOptions`. AV-layer material options have no named support. |
| Geometry Options (Bevel, Extrusion Depth) for C4D renderer 3D text/shapes | MISSING | Not exposed; renderer-gated. Niche. |
| Set comp camera/light options | COVERED `setLayerProperties` (`cameraOptions`/`lightOptions`) | |
| Sequence layer start times | COVERED `sequenceLayers` | |

## 2. Blend modes / track mattes / layer styles

| Action | Status | Note |
|---|---|---|
| Set blend mode | COVERED `setLayerProperties` (`blendMode`) | Full enum. |
| Set track matte (alpha/luma + inverted) | COVERED `setTrackMatte` / `setLayerProperties` (`trackMatteType`) | |
| Preserve underlying transparency | MISSING | The "T" toggle has no command. Minor. |
| Layer Styles (Drop/Inner Shadow, Outer/Inner Glow, Bevel & Emboss, Satin, Color/Gradient/Stroke overlay) — add | MISSING | No command adds `ADBE Layer Styles`. (`applyEffect` drop-shadow is the effect, not the layer style.) |
| Layer-style parameters / animate | MISSING | Blocked by the above. |

## 3. Effects: apply, configure, animate, reorder, presets

| Action | Status | Note |
|---|---|---|
| Apply known effect / raw matchName / `.ffx` preset | COVERED `applyEffect` | Any AE effect via `effectMatchName`. |
| Apply effect template bundle | COVERED `applyEffectTemplate` | |
| Color grade | COVERED `adjustColor` | Lumetri-driven. |
| Set one effect property | COVERED `setEffectProperty` | |
| Keyframe an effect property over time | PARTIAL `setLayerKeyframe` | Works via propertyPath into Effects (now eased by `configurableProperties` on apply). |
| Delete effect | COVERED `deleteEffect` | |
| Reorder effects in the stack | MISSING | No move/reorder; order fixed by application order. Matters for blur-before/after-glow. |
| Toggle effect enabled (eyeball) | PARTIAL `setLayerProperty` | No named toggle; raw path to `enabled` only. |
| Duplicate / copy effect to other layers | MISSING | No effect-copy verb. |
| Save selection as user preset (`.ffx`) | MISSING | Out-of-band; low priority. |

## 4. Masks: create, edit, mode, feather, expansion, opacity, animate path

| Action | Status | Note |
|---|---|---|
| Create mask (path or rect) | COVERED `setLayerMask` | |
| Edit mask vertices / tangents | COVERED `setLayerMask` (`maskPath`, `maskInTangents`, `maskOutTangents`) | |
| Mask mode | COVERED `setLayerMask` (`maskMode`) | |
| Feather / expansion / opacity | COVERED `setLayerMask` | |
| Delete mask | COVERED `deleteLayerMask` | |
| Animate mask path (keyframe Mask Path shape over time) | PARTIAL `setLayerKeyframe` | Technically reachable via propertyPath, but `setLayerMask` has no `timeInSeconds` and there's no named "animate mask" verb. |
| Variable-width feather (feather points) | MISSING | Not scriptable / not exposed. Niche. |
| Mask opacity / expansion keyframed | PARTIAL `setLayerKeyframe` | Raw propertyPath only. |
| Lock / mask-color | MISSING | Cosmetic; low priority. |

## 5. Text: TextDocument, animators, path options, selectors

| Action | Status | Note |
|---|---|---|
| Set text string / font / size / fill / alignment | COVERED `createLayer`, `setLayerProperties` | |
| Tracking, leading, kerning, stroke, faux bold/italic, all-caps, small-caps, baseline shift, full justification | PARTIAL `setLayerProperty` | TextDocument props with no named support — needs raw set of the Source Text TextDocument. Major gap for real typography. |
| Add text animator (any property) | COVERED `addTextAnimator` | Wide property set. |
| Set animator property | COVERED `setTextAnimatorProperty` | |
| Configure range selector | COVERED `setTextAnimatorRangeSelector` | start/end/offset/units/basedOn/shape. |
| One-call kinetic typography | COVERED `animateText` | 7 presets. |
| Explode text to per-char/word/line layers | COVERED `explodeTextLayer` | |
| Wiggly / Expression selector on a text animator | MISSING | Only Range selectors. Wiggly selector is a common jittery-text move. |
| Path Options (text on a mask path: margins, perpendicular, force alignment, reverse) | MISSING | "Type on a circle/path" impossible. Notable for titles/lower-thirds. |
| List installed fonts | COVERED `listFonts` | |

## 6. Shapes: groups, path operators, fills/strokes/gradients

| Action | Status | Note |
|---|---|---|
| Create shape layer (rect/ellipse/poly/star) | COVERED `createLayer` | |
| Add Trim Paths / Repeater / Rounded Corners / Gradient Fill/Stroke | COVERED `addShapeOperator` | |
| Set shape operator property | COVERED `setShapeOperatorProperty` | |
| Write-on / draw-on (Trim Paths animated) | COVERED `animateShape` | |
| Convert text/solid to editable shapes | PARTIAL `convertToShape` | Relies on a menu command documented as gated from CEP/evalScript — handler returns a structured no-op error in that context. Effectively unreliable. |
| Extract / merge shape groups | COVERED `extractShapes`, `mergeShapes` | |
| Wiggle Paths, Zig Zag, Offset Paths, Pucker & Bloat, Twist, Merge Paths | MISSING | `addShapeOperator` only supports 5 types; these common operators are absent. Big motion-design gap. |
| Gradient color stops on shape fills/strokes | MISSING (documented) | `ADBE Vector Grad Colors` is not scriptable in AE 2026 (NO_VALUE). Handler header says use `applyEffect("ADBE Ramp")` instead. |
| Add fill/stroke to existing group, or edit stroke dashes/caps/joins | PARTIAL | Creation bundles a fill/stroke; no verb to add/edit them afterward except raw propertyPath. |
| Edit a freeform shape path's vertices | PARTIAL `setLayerProperty` | Raw propertyPath to the Path only. |

## 7. Keyframes: set, easing, interpolation, spatial, roving

| Action | Status | Note |
|---|---|---|
| Set keyframe (scalar/array/Shape) | COVERED `setLayerKeyframe` | |
| Easing presets (easyEase/in/out/linear/hold/bezier) | COVERED `setKeyframeEasing` | |
| Custom influence/speed (graph values) | COVERED `setKeyframeEasing` (`inInfluence`/`outInfluence`/`inSpeed`/`outSpeed`) | |
| Hold interpolation | COVERED `setKeyframeEasing` (`easeType:"hold"`) | |
| Auto-bezier / continuous-bezier (temporal) | PARTIAL | `setKeyframeSpatial` exposes these for spatial tangents; temporal auto-bezier on scalars isn't a named option. Minor. |
| Spatial tangents on position | COVERED `setKeyframeSpatial` | |
| Roving keyframes | COVERED `setKeyframeSpatial` (`roving`) | |
| Copy easing/values between props | COVERED `copyKeyframeEasing` | |
| Clone / mirror keyframes | COVERED `cloneKeyframes` | |
| Snap keys to frame grid | COVERED `fixKeyframeTiming` | |
| Stagger keys across layers | COVERED `sequenceKeyframes` | |
| Remove keyframes | COVERED `removePropertyKeyframes` | |
| Move / retime an existing keyframe to a new time | MISSING | No "move keyframe" verb (only set-at-time, which creates; and clone). Editing one key's timing is awkward. |

## 8. Expressions

| Action | Status | Note |
|---|---|---|
| Set raw expression | COVERED `setLayerExpression` | |
| Remove expression | COVERED `setLayerExpression` (`""`) | |
| Preset library (bounce/elastic/wiggle/loops/auto-fade/overshoot) | COVERED `setLayerExpression` (`preset`) | |
| Read expressions | COVERED `getLayerExpressions` | |
| Enable/disable expression without deleting it | MISSING | Only set/clear; toggling `expressionEnabled` has no verb. Minor. |
| Pickwhip-style link helper | PARTIAL `setLayerExpression` | Achievable by writing the link string manually; no convenience verb. |

## 9. Time: time remap, stretch, retime, freeze, reverse

| Action | Status | Note |
|---|---|---|
| Speed up / slow down (incl. frame blend) | COVERED `retimeClip` (`mode:"speed"`) | |
| Freeze frame | COVERED `retimeClip` (`mode:"freeze"`) | |
| Reverse playback | COVERED `retimeClip` (`mode:"reverse"`) | |
| Enable/disable time remap | COVERED `setTimeRemapEnabled` | Now returns the Time Remap path via `configurableProperties`. |
| Time stretch % | COVERED `setLayerProperties` (`stretch`) | |
| Trim in/out | COVERED `trimLayer` | |
| Split / merge layer | COVERED `splitLayer`, `mergeLayer` | |
| Hand-author time-remap keyframes (variable speed ramp, hold-then-play) | PARTIAL `setLayerKeyframe` | Reachable via `["Time Remap"]` once enabled, but no named "speed ramp" verb. |

## 10. Markers, guides, comp-level timeline ops

| Action | Status | Note |
|---|---|---|
| Add / list / update / remove comp & layer markers | COVERED `addMarker`, `listMarkers`, `updateMarker`, `removeMarker` | |
| Set work area | COVERED `setCompositionProperties` | |
| Move playhead | COVERED `setCurrentTime` | |
| Precompose / decompose | COVERED `precompose`, `decomposeLayer` | |
| Crop comp to content | COVERED `cropComp` | |
| Comp motion blur / draft 3D / shutter | COVERED `setCompositionProperties` | |
| Solo / shy individual layers | COVERED `setLayerProperties` (`solo`, `shy`) | |
| Guides / snapping toggle | MISSING | No guide commands. Low priority for target users. |
| Layer lock toggle | MISSING | `locked` not exposed. Minor. |

---

## Top gaps (prioritized for video editors & motion designers)

1. **Shape path operators — Wiggle Paths, Zig Zag, Offset Paths, Pucker & Bloat, Twist, Merge Paths** (MISSING). Bread-and-butter motion design. Extend the existing verb: `addShapeOperator({ type: "wigglePaths"|"zigzag"|"offsetPaths"|"puckerBloat"|"twist"|"mergePaths", settings })` — add matchNames to the dictionary in `shapes.jsx`.
2. **Layer Styles** (MISSING). "Add a drop shadow / glow / stroke / gradient overlay" — distinct from effects. New verb: `setLayerStyle({ style, enabled, settings })`.
3. **Full text typography** — tracking, leading, stroke, faux bold/italic, all-caps, baseline (PARTIAL). New verb wrapping the Source Text TextDocument: `setTextStyle({ tracking, leading, strokeColor, strokeWidth, fauxBold, fauxItalic, allCaps, smallCaps, baselineShift, justification })`.
4. **Animate mask path over time** (PARTIAL). Reveals, shape morphs, roto. New verb: `animateMaskPath({ maskIndex, keyframes: [{ time, maskPath, inTangents?, outTangents? }] })` (or add `timeInSeconds` to `setLayerMask`).
5. **Text on a path** (MISSING). Badges, lower-thirds. New verb: `setTextPath({ maskIndex|pathName, firstMargin?, lastMargin?, reverse?, perpendicular?, forceAlignment? })`.
6. **Reorder + enable/disable effects** (MISSING/PARTIAL). Effect order changes the look; toggling to compare is routine. `moveEffect({ effectIndex, targetIndex, position })` + add `enabled:bool` to `setEffectProperty`.
7. **Shape gradient color stops** (MISSING — AE-scripting-blocked). High demand, low feasibility. Documented fallback: `setShapeGradient({ operatorPath, type, stops, shape })` implemented via a Ramp effect, surfacing a note.
8. **3D Material Options for AV/solid layers** (PARTIAL). Needed for real 3D-light scenes. New verb mirroring `lightOptions`: `setMaterialOptions({ castsShadows, acceptsShadows, acceptsLights, ambient, diffuse, specular, shininess, metal })`.
9. **Wiggly / Expression selector on text animators** (MISSING). "Make the text jitter/shake." Extend the surface: `addTextSelector({ animatorIndex, type: "wiggly"|"expression", settings })`.
10. **`convertToShape` reliability** (PARTIAL — CEP-gated no-op). Already a command but unreliable; worth a scripted reimplementation (build the shape tree directly) instead of `executeCommand`.

Lower-priority misses (note, don't prioritize): parent-without-transform, preserve underlying transparency, expression enable/disable toggle, move-single-keyframe-in-time, layer lock, ruler guides.
