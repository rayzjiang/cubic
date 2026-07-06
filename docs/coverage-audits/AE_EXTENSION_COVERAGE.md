# Cubic vs. the After Effects Extension Landscape

> **Basis:** codebase at commit `3828cd1` · **Date:** 2026-06-20
> **Question answered:** Does Cubic have enough functionality to replace the
> extensions a typical motion designer keeps on their AE panel — and which
> industry-standard tools fall inside vs. outside what Cubic can ever do?
>
> Note: the bounce/overshoot expression presets were corrected the same day
> (see [Appendix: bounce/overshoot preset fix](#appendix-bounceovershoot-preset-fix));
> those edits sit on top of `3828cd1` and are reflected below.

---

## The gaps (read this first)

Cubic covers the large majority of the *script-based* daily-driver toolset, and a
specific real-world panel (BOUNCr + Motion Tools + Presetify + Align + TextExploder)
is ~fully covered. The honest gaps fall into three buckets:

### 1. Permanent boundary — native render/sim plugins (NOT scriptable, ever)
ExtendScript has no pixel/GPU/render API, so Cubic can never reproduce these by
scripting. They are bought as separate compiled plugins, not "panel scripts":

| Gap | Representative tools |
|---|---|
| Particles / generative 3D geometry | Trapcode Particular/Form, Stardust, Element 3D, Plexus |
| Glow / light / lens FX | Deep Glow, Saber, Optical Flares, Starglow, Shine |
| Optical-flow retime / motion blur | Twixtor, ReelSmart Motion Blur, Cartoon Moblur |
| Broad FX / color suites | Sapphire, Continuum, Magic Bullet, Red Giant Universe |
| Multi-body physics **solving** | Newton (its *baked keyframes* are editable; the solve is not) |
| Compiled effect utilities | TextBox 2, Sound Keys, Auto Crop 3, Repeater (Plugin Everything) |

### 2. Reachable but not built yet (scriptable — a roadmap decision)
These are pure native-layers-plus-expressions, so they *could* be built on Cubic's
existing bridge, but no commands exist today:

| Gap | Representative tools | Why it's reachable |
|---|---|---|
| **Character rigging / IK** | DUIK Ángela, Limber, Joysticks 'n Sliders, RubberHose | Rigs are nulls + shape layers + expressions — no render engine |
| **Responsive auto-layout** | Pins & Boxes (mamoworld) | Bounds-driven expressions on layout |
| **Live vector bridge** | Overlord, AEUX | AE-side shape construction is scriptable; the live Illustrator/Figma link is not |
| **Deep project-org automation** | True Comp Duplicator, pt_ tools | Cubic has `extractShapes` + `duplicateComposition(deep)` but not the full set |

### 3. Capability exists, but the *value moat* is a curated asset library
Cubic has the mechanism; the competing product's edge is its preset/asset catalog,
not its mechanics. Worth a conscious decision on whether to compete on a library:

- Animation Composer (Mister Horse) — 1000+ drag-drop presets/transitions
- Type Builder, AC text presets — kinetic-typography preset libraries
- Ray Dynamic Color — centralized swappable palette

---

## The one distinction that governs everything

After Effects extends in exactly two ways:

- **Scripts** (`.jsx`/`.jsxbin`, CEP/UXP panels) only manipulate the project
  model — layers, keyframes, expressions, transforms, comp structure. **Anything a
  script does, Cubic's ExtendScript bridge can reproduce in principle.** The moat of
  the good ones is a curated asset library or polished UX, not a render engine.
- **Plugins** (compiled `.aex`, C++/GPU) render *new pixels*. ExtendScript has no
  pixel/GPU API, so **these are categorically impossible to script.**

By count, the overwhelming majority of the "daily driver" panel toolset is scripts.
The non-replicable plugins cluster in particles/3D, glow/light/lens, retime/motion
blur, physics solving, and a handful of compiled effect utilities.

---

## Coverage: the reference panel (from the source screenshot)

| Panel tool | What it does | Cubic capability | Verdict |
|---|---|---|---|
| **BOUNCr** | Overshoot / bounce-back expressions | `setLayerExpression` presets `INERTIAL_BOUNCE` / `ELASTIC` / `OVERSHOOT`; `applyMotionRecipe(bounce)` | Covered |
| **Motion Tools Classic** | Elastic, Bounce, Clone, Sequence (offset/step), Extract, Merge, Add Null, Convert to Shape | `cloneKeyframes`, `sequenceLayers` / `sequenceKeyframes`, `extractShapes`, `mergeShapes`, `addNullToLayers`, `convertToShape`, `fixKeyframeTiming`, `copyKeyframeEasing` | Mostly covered (core moves present) |
| **Presetify** | Quick fit / anchor / align presets (1-1, align glyphs, W↑/W←) | `fitToFrame` (fit/fill/stretch), `setAnchorPoint`, `alignLayers` | Covered (button set inferred from icons) |
| **Align** | Align / distribute vs. comp or selection | `alignLayers` + `distributeLayers` with `COMPOSITION` / `SELECTION` reference, bbox-aware | Fully covered |
| **TextExploder** | Split text into chars / words / lines | `explodeTextLayer` (`CHARACTERS\|WORDS\|LINES`) | Fully covered |
| Properties panel | Native AE readout | `getLayerInfo` / `getSelectionDetails` | N/A (native) |

**For this exact panel, Cubic already replaces essentially all of it.**

---

## Coverage: the broader industry-standard landscape

Legend: **Covered** = Cubic does it today · **Partial** = mechanism exists, not the
full feature set · **Gap (reachable)** = scriptable but unbuilt · **Boundary** =
native render/sim, not scriptable.

| Category | Dominant tools | Type | Cubic | Notes |
|---|---|---|---|---|
| Easing / interpolation | Flow, Ease and Wizz, EaseCopy, Motion v3 | Script | **Covered** | `setKeyframeEasing` (influence/speed), `copyKeyframeEasing`. No *visual* curve editor — the AI sets the curve. |
| Bounce / overshoot scripts | BOUNCr, Excite, EZ Inertia | Script | **Covered** | Thin expression wrappers — see appendix. |
| Physics solving | Newton | Plugin | **Boundary** | Box2D native solver; baked keyframe output is editable. |
| Align / distribute / layout | Align panel, GridGuide | Script/native | **Covered** | `alignLayers`, `distributeLayers`. |
| Text split / kinetic | TextExploder, Type Builder, AC text presets | Script | **Covered** | `explodeTextLayer` + `animateText` (7 kinetic presets). Preset *libraries* are an asset moat. |
| TextBox-style live box | TextBox 2 (Plugin Everything) | Plugin | **Boundary** | Compiled live effect. (Free Motion Boutique TextBox is a script.) |
| Workflow accelerators / launchers | Motion Tools Pro, KBar, FX Console, Labels | Script | **Mostly covered** | These run scripts/effects; Cubic *is* the runner. |
| Vector bridge | Overlord, AEUX | Script | **Gap (reachable)** | AE-side shape build is scriptable; live app link is not. |
| Project org | Explode Shape Layers, True Comp Duplicator, pt_ tools | Script | **Partial** | `extractShapes`, `duplicateComposition(deep:true)`. |
| Expression / layout mgmt | Expressionist, iExpressions, Pins & Boxes | Script | **Partial** | Cubic writes expressions; no responsive auto-layout. |
| Character rigging / IK | DUIK Ángela, Limber, Joysticks 'n Sliders, RubberHose | Script | **Gap (reachable)** | Pure nulls + expressions; biggest addressable gap. |
| Particles / 3D | Trapcode, Element 3D, Stardust, Plexus | Plugin | **Boundary** | GPU render engines. |
| Glow / light / lens | Deep Glow, Saber, Optical Flares | Plugin | **Boundary** | GPU render. |
| Retime / motion blur | Twixtor, RSMB, Cartoon Moblur | Plugin | **Boundary** | Optical-flow / compiled. |
| Broad FX / color suites | Sapphire, Continuum, Magic Bullet, Universe | Plugin | **Boundary** | GPU effects. Cubic has `adjustColor` (Lumetri-based) for grading basics. |

---

## What Cubic actually does today (capability summary)

Cubic exposes **~89 AE operations** to the model through a bounded tool surface
(`runScript` + `batch` + `createComposition`) — no arbitrary-script escape hatch.
Source of truth: `server/ai/src/tools/command-params.ts` (params) and
`server/ae-bridge/src/commands.ts` (names); handlers live in
`server/ae-bridge/src/scripts/*.jsx`.

| Domain | Representative capabilities |
|---|---|
| Compositions | create, list, info, set props, delete, duplicate, crop-to-content |
| Layers — create | text, shape, solid, adjustment, null, camera, light (unified `createLayer`) |
| Layers — transform/hierarchy | parent/unparent, add nulls, move, **align**, **distribute**, **fit-to-frame**, anchor presets, sequence |
| Layers — time | split, merge, trim, retime (speed/freeze/reverse), time-remap |
| Layers — nesting | precompose, decompose, track mattes |
| Keyframes & easing | set, **easing (influence/speed)**, spatial tangents, **copy easing**, sequence, **clone**, fix-timing |
| Expressions | `setLayerExpression` — custom string or 12 presets (INERTIAL_BOUNCE, ELASTIC, OVERSHOOT, WIGGLE, AUTO_FADE, LOOP_*) |
| Masks | get, set (path/rect/mode/feather), delete |
| Effects | apply (friendly names → matchNames), **color grading** (`adjustColor`), templates, set/delete |
| Text | create, animators, range selectors, **explode** (chars/words/lines), **`animateText`** (7 kinetic presets), fonts |
| Shapes | create, operators (trim/repeater/round), **convert-to-shape**, **animate (write-on)**, **extract/merge** |
| Motion / 3D | `applyMotionRecipe` (popIn/Out, fade, slide, scaleIn, bounceIn, wiggle + stagger), `distributeLayers3D`, `cameraMove`, `createBackground` |
| Footage / project | import, add-to-comp, list, folders, save, restore (filesystem-backed undo) |

---

## Bottom line

For the **script-based daily-driver panel** a typical motion designer keeps open —
easing, bounce/overshoot, align/distribute, sequence/stagger, text-split,
anchor/null, convert-to-shape, motion presets — **Cubic already covers the large
majority, and the specific reference panel is effectively fully covered.**

Three honest caveats:
1. **Character rigging** (DUIK/Limber/Joysticks) is the main *reachable* category
   Cubic does not touch yet — worth a roadmap decision since it is all expressions
   plus nulls.
2. **Native plugins** (particles/3D/glow/optical-flow retime) are a hard wall — but
   those are separate compiled plugins, not the panel scripts in question, so they
   do not undercut the thesis.
3. The value moat of tools like Animation Composer / Type Builder is a **curated
   preset/asset library**, not mechanics — a conscious build-or-skip decision.

---

## Appendix: bounce/overshoot preset fix

The expression presets in `server/ae-bridge/src/scripts/animation.jsx` were
corrected on 2026-06-20, modeled on the BOUNCr documentation:

- **OVERSHOOT** values were off (`amp 0.05, freq 1.5, decay 8` → over-damped, barely
  visible). Now BOUNCr-aligned: `amp 0.1, freq 2, decay 4` (its documented good
  defaults for the motionscripts.com "Overshoot+" decaying-sine).
- **Structural fix:** all three bounce presets previously used one decaying-**sine**
  template (symmetric over/undershoot — a pendulum, not a ball). BOUNCr ships two
  distinct expressions, so Cubic now mirrors that:
  - `OVERSHOOT` / `ELASTIC` — decaying sine (`amp`/`freq`/`decay`), settle past the target.
  - `INERTIAL_BOUNCE` — Dan Ebberts' realistic bounce (`elasticity`/`gravity`/`maxBounces`),
    a ball-on-floor bounce that never crosses the target. Re-based from the old
    sine form.
- `applyMotionRecipe`'s expression-style Scale pop now bakes `OVERSHOOT` (correct
  for a scale settle) instead of the floor-bounce form.

Param docs (`command-params.ts`) and prompt rules (`rules.ts`) were updated to match;
the static drift guard (`npm run test:drift`) passes (93 commands in sync).
