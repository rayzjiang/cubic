/**
 * COMMAND PARAMETER REGISTRY — the single source of truth for what arguments
 * each ExtendScript command accepts.
 *
 * WHY THIS EXISTS:
 *   The model drives After Effects through one `runScript({ script, parameters })`
 *   tool whose `parameters` bag is untyped. The only way the model knows what to
 *   pass is the `<command_catalog>` in the system prompt — which is GENERATED from
 *   this file by `renderCommandCatalog()` (src/prompt/renderCatalog.ts). Define a
 *   command's params here once and the always-present catalog (and, later, arg
 *   validation) derive from it. Nothing else is hand-edited.
 *
 * DRIFT GUARD:
 *   `tests/drift-guard.mjs` asserts (a) the keys here match the canonical command
 *   list in `server/ae-bridge/src/commands.ts`, and (b) every non-targeting param here
 *   matches the real `args.X` reads in the `.jsx` handlers. So this file cannot
 *   silently rot out of sync with the runtime.
 *
 * TARGETING PARAMS (compName, compIndex, layerIndex, layerName, propertyPath,
 *   propertyName, markerIndex, time) are read by shared resolver helpers, are
 *   documented once in the catalog preamble, and are EXEMPT from the drift check.
 *   They may still appear in a command's `params` here when worth surfacing.
 *
 * SPEC STRING FORMAT (compact, for the catalog): "<type> — <note>", e.g.
 *   "int 0-720", "bool", "[r,g,b] 0-255", "array of int (1-based)".
 */

export interface CommandSpec {
  /** Domain bucket used to group commands in the rendered catalog. */
  domain: string;
  /** One-line description of what the command does. */
  summary: string;
  /** param name -> compact type/range spec string. */
  params: Record<string, string>;
  /** Subset of `params` that are required (rendered without the `?` marker). */
  required?: string[];
  /** When true, the command stays in the registry (drift-checked, callable via the MCP
   *  /diagnostic surface) but is omitted from the generated <command_catalog> so the
   *  model never sees or calls it. */
  internal?: boolean;
}

export const COMMAND_PARAMS = {
  // ── Compositions / project info ──────────────────────────────────────────
  getProjectInfo: { domain: 'Compositions', summary: 'Read project metadata + comp/footage/folder/solid counts.', params: {} },
  listCompositions: { domain: 'Compositions', summary: 'List all compositions in the project.', params: {} },
  getCompositionInfo: { domain: 'Compositions', summary: 'Full metadata for a composition (compName/compIndex).', params: {} },
  createComposition: {
    domain: 'Compositions',
    summary: 'Create a new composition. (Also a typed tool.)',
    params: { name: 'string', width: 'int px', height: 'int px', pixelAspect: 'float (default 1.0)', duration: 'float seconds (default 10)', frameRate: 'float (default 30)', backgroundColor: '{r,g,b} 0-255' },
    required: ['name', 'width', 'height'],
  },
  setCompositionProperties: {
    domain: 'Compositions',
    summary: 'Update an existing comp (compName/compIndex). All params optional.',
    params: {
      name: 'string', width: 'int px (pass with height)', height: 'int px (pass with width)', duration: 'float seconds',
      frameRate: 'float', backgroundColor: '{r,g,b} 0-255', workAreaStart: 'float seconds (pass with workAreaDuration)',
      workAreaDuration: 'float seconds (>0, start+dur<=duration)', displayStartTime: 'float seconds',
      resolutionFactor: 'array e.g. [1,1] (full) / [2,2] (half)', shutterAngle: 'int 0-720', shutterPhase: 'int -360..360',
      motionBlur: 'bool', draft3d: 'bool',
    },
  },
  deleteComposition: { domain: 'Compositions', summary: 'Delete a composition (compName/compIndex).', params: {} },
  duplicateComposition: {
    domain: 'Compositions',
    summary: 'Duplicate a composition (compName/compIndex).',
    params: { newName: 'string', deep: 'bool — also duplicate nested pre-comps (default false)' },
  },

  // ── Playhead ─────────────────────────────────────────────────────────────
  getCurrentTime: { domain: 'Playhead', summary: 'Get the playhead time (seconds + frames) of a comp.', params: {} },
  setCurrentTime: {
    domain: 'Playhead',
    summary: 'Move the playhead (one of timeInSeconds/timeInFrames).',
    params: { timeInSeconds: 'float (clamped to comp)', timeInFrames: 'float (clamped to comp)' },
  },

  // ── Layers — selection & info ─────────────────────────────────────────────
  getLayerInfo: { domain: 'Layers', summary: 'Metadata + properties for all layers in a comp.', params: {} },
  getSelectedLayers: { domain: 'Layers', summary: 'List currently selected layers.', params: {} },
  getSelectionDetails: { domain: 'Layers', summary: 'Selected layers incl. selected properties.', params: {} },
  setSelectedLayers: {
    domain: 'Layers',
    summary: 'Set the layer selection (by index or name).',
    params: { layerIndices: 'array of int (1-based)', layerNames: 'array of string', clearOthers: 'bool — deselect others (default true)' },
  },

  // ── Layers — create / duplicate / delete ──────────────────────────────────
  createLayer: {
    domain: 'Layers',
    summary: 'Create a layer; `type` selects which fields apply.',
    params: {
      type: 'text|shape|solid|adjustment|null|camera|light',
      name: 'string', position: '[x,y] or [x,y,z]', startTime: 'float seconds (default 0)', duration: 'float seconds (default 5)',
      // solid / adjustment
      color: '[r,g,b] 0-1', size: '[w,h] px', isAdjustment: 'bool (solid->adjustment)',
      // text
      text: 'string', fontSize: 'float pt', fontFamily: 'string — installed font; common display names auto-resolve, see listFonts', alignment: 'left|center|right', fillColor: '[r,g,b] 0-1',
      // shape
      shapeType: 'rectangle|ellipse|polygon|star', strokeColor: '[r,g,b] 0-1', strokeWidth: 'float px', roundness: 'float px', points: 'int (polygon/star)',
      // null
      threeDLayer: 'bool',
      // camera
      zoom: 'float px (focal length)', pointOfInterest: '[x,y,z]', oneNode: 'bool', depthOfField: 'bool', focusDistance: 'float', aperture: 'float', blurLevel: 'float',
      // light
      lightType: 'parallel|spot|point|ambient', intensity: 'float', coneAngle: 'float (spot)', coneFeather: 'float (spot)',
      falloff: 'none|smooth|inverseSquare', radius: 'float', falloffDistance: 'float', castsShadows: 'bool', shadowDarkness: 'float', shadowDiffusion: 'float',
    },
    required: ['type'],
  },
  duplicateLayer: { domain: 'Layers', summary: 'Duplicate a layer (compName + layerIndex/layerName).', params: { newName: 'string' } },
  deleteLayer: { domain: 'Layers', summary: 'Delete a layer (compName + layerIndex/layerName).', params: {} },

  // ── Layers — properties ───────────────────────────────────────────────────
  setLayerProperties: {
    domain: 'Layers',
    summary: 'Set many properties on one layer (compName + layerIndex/layerName).',
    params: {
      enabled: 'bool', selected: 'bool', threeDLayer: 'bool', motionBlur: 'bool', collapseTransformation: 'bool', shy: 'bool', solo: 'bool', guideLayer: 'bool',
      blendMode: 'normal|add|multiply|screen|overlay|softLight|hardLight|colorDodge|colorBurn|darken|lighten|difference|exclusion|hue|saturation|color|luminosity',
      trackMatteType: 'none|alpha|alphaInverted|luma|lumaInverted', quality: 'best|draft|wireframe',
      autoOrient: 'off|alongPath|cameraOrPOI|charactersTowardsCamera', label: 'int (color index)', comment: 'string',
      position: '[x,y] or [x,y,z]', scale: '[x,y,z] % (100=1:1)', rotation: 'float deg', opacity: 'float 0-100', anchorPoint: '[x,y]',
      startTime: 'float seconds', duration: 'float seconds', stretch: 'float % time-stretch',
      text: 'string (text layer)', fontFamily: 'string (text layer) — installed font; common display names auto-resolve, see listFonts', fontSize: 'float pt (text layer)', fillColor: '[r,g,b] 0-1 (text layer)',
      cameraOptions: 'object {zoom,depthOfField,focusDistance,aperture,blurLevel}', lightOptions: 'object {intensity,color,coneAngle,coneFeather,falloff,radius,falloffDistance,castsShadows,shadowDarkness,shadowDiffusion}',
      overwriteKeyframes: 'bool — clear existing keys before setting transforms',
    },
  },
  batchSetLayerProperties: {
    domain: 'Layers',
    summary: 'Set properties on many layers in one comp.',
    params: { operations: 'array of {layerIndex|layerName, ...setLayerProperties fields}', overwriteKeyframes: 'bool — default for all ops' },
    required: ['operations'],
  },
  getLayerProperty: {
    domain: 'Layers',
    summary: 'Read one property value (propertyPath, optional timeInSeconds).',
    params: { propertyPath: 'array e.g. ["Transform","Position"]', timeInSeconds: 'float — read value at time' },
    required: ['propertyPath'],
  },
  setLayerProperty: {
    domain: 'Layers',
    summary: 'Set one property by path (propertyPath + value).',
    params: { propertyPath: 'array e.g. ["Transform","Opacity"]', value: 'any (matches property type)', overwriteKeyframes: 'bool — clear existing keys' },
    required: ['propertyPath', 'value'],
  },

  // ── Layers — hierarchy & transform ────────────────────────────────────────
  setLayerParent: { domain: 'Layers', summary: 'Parent a layer (parentIndex/parentName; omit both to unparent).', params: { parentIndex: 'int (1-based)', parentName: 'string' } },
  moveLayer: { domain: 'Layers', summary: 'Reorder a layer relative to a target.', params: { targetIndex: 'int (1-based)', targetName: 'string', position: 'before|after (default before)' } },
  setAnchorPoint: {
    domain: 'Layers',
    summary: 'Set anchor point to a named position.',
    params: { position: 'TOP_LEFT|TOP_CENTER|TOP_RIGHT|MIDDLE_LEFT|CENTER|MIDDLE_RIGHT|BOTTOM_LEFT|BOTTOM_CENTER|BOTTOM_RIGHT', preservePosition: 'bool — compensate Position (default true)', overwriteKeyframes: 'bool' },
  },
  centerAnchorPoint: { domain: 'Layers', summary: 'Center the anchor point (shortcut for setAnchorPoint CENTER).', params: { preservePosition: 'bool (default true)', overwriteKeyframes: 'bool' } },
  alignLayers: {
    domain: 'Layers',
    summary: 'Align layers to the comp or their selection bounds.',
    params: { layerIndices: 'array of int (1-based)', alignment: 'LEFT|HORIZONTAL_CENTER|RIGHT|TOP|VERTICAL_CENTER|BOTTOM', reference: 'COMPOSITION|SELECTION (default COMPOSITION)' },
    required: ['layerIndices'],
  },
  distributeLayers: {
    domain: 'Layers',
    summary: 'Evenly space layers along one axis (bounding-box-aware; moves only that axis). For even stacks/rows — pair with alignLayers for the cross-axis. COMPOSITION centers the run in the comp; SELECTION keeps the group\'s current center (omit gap for classic distribute: equalize gaps, extremes fixed).',
    params: { layerIndices: 'array of int (1-based)', axis: 'horizontal|vertical (default vertical)', gap: 'float px between adjacent bounding boxes (optional; omit for a comfy proportional gap)', reference: 'COMPOSITION|SELECTION (default COMPOSITION)' },
    required: ['layerIndices'],
  },
  fitToFrame: {
    domain: 'Layers',
    summary: 'Scale footage/layers to the comp frame (bounding-box-aware), then center. Use for "fit to frame", "fill the frame", "scale to fit/fill" — never hand-set Scale/Position. fit = contain (whole layer visible); fill = cover (frame filled, edges cropped); stretch = exact fit, may distort. offset nudges from center.',
    params: { layerIndices: 'array of int (1-based)', mode: 'fit|fill|stretch (default fit)', offset: '[x,y] px nudge from center (optional)' },
    required: ['layerIndices'],
  },
  sequenceLayers: {
    domain: 'Layers',
    summary: 'Stagger layer start times in sequence.',
    params: { layerIndices: 'array of int (1-based)', offsetFrames: 'float (default 1)', orderType: 'TOP_DOWN|BOTTOM_UP|RANDOM (default TOP_DOWN)', baseStartTime: 'float seconds' },
    required: ['layerIndices'],
  },

  // ── Layers — time ops ─────────────────────────────────────────────────────
  splitLayer: { domain: 'Layers', summary: 'Split a layer at a time (default playhead).', params: { time: 'float seconds' } },
  mergeLayer: { domain: 'Layers', summary: 'Merge a split layer with another (right half).', params: { mergeWithIndex: 'int (1-based)' }, required: ['mergeWithIndex'] },
  trimLayer: {
    domain: 'Layers',
    summary: 'Trim a layer in/out (mode or explicit points).',
    params: { mode: 'currentTimeIn|currentTimeOut (omit for explicit)', inPoint: 'float seconds', outPoint: 'float seconds', startTime: 'float seconds' },
  },
  retimeClip: {
    domain: 'Layers',
    summary: 'Change a clip\'s playback timing — use for "speed up / slow down / 2x / slow-mo", "freeze frame", "play in reverse". Never hand-roll time-remap keyframes. mode speed: speed>1 faster, <1 slow-mo (auto frame-blend); mode freeze: holds one frame for the whole layer (atTime = which frame, default playhead); mode reverse: plays backwards.',
    params: { mode: 'speed|freeze|reverse', speed: 'float (speed mode; 2=2x, 0.5=half)', atTime: 'float seconds (freeze mode; default playhead)' },
    required: ['mode'],
  },
  setTimeRemapEnabled: { domain: 'Layers', summary: 'Enable/disable time remapping on a layer.', params: { enabled: 'bool' }, required: ['enabled'] },

  // ── Layers — nesting / mattes ─────────────────────────────────────────────
  precompose: {
    domain: 'Nesting',
    summary: 'Pre-compose layers into a nested comp.',
    params: { layerIndices: 'array of int (1-based)', newCompName: 'string (default "Precomp")', moveAttributes: 'bool (default true)', openNewComp: 'bool (default false)' },
    required: ['layerIndices'],
  },
  decomposeLayer: { domain: 'Nesting', summary: 'Un-nest a precomp layer back into the parent comp.', params: {} },
  setTrackMatte: {
    domain: 'Nesting',
    summary: 'Set a track matte on a layer.',
    params: { matteType: 'none|alpha|alphaInverted|luma|lumaInverted', matteLayerIndex: 'int (1-based)', matteLayerName: 'string' },
    required: ['matteType'],
  },

  // ── Keyframes ─────────────────────────────────────────────────────────────
  getLayerKeyframes: { domain: 'Keyframes', summary: 'Read keyframes for a property (propertyPath/propertyName).', params: { propertyPath: 'array', propertyName: 'string' } },
  setLayerKeyframe: {
    domain: 'Keyframes',
    summary: 'Set a keyframe on a property (propertyPath/propertyName).',
    params: { propertyPath: 'array', propertyName: 'string', value: 'number|array (matches property)', timeInSeconds: 'float' },
    required: ['value', 'timeInSeconds'],
  },
  setKeyframeEasing: {
    domain: 'Keyframes',
    summary: 'Set easing on keyframes (target by keyIndices/keyIndex/keyTime).',
    params: { propertyPath: 'array', propertyName: 'string', keyIndices: 'array of int (1-based)', keyIndex: 'int (1-based)', keyTime: 'float seconds', easeType: 'easyEase|easeIn|easeOut|linear|hold|bezier', inSpeed: 'float', inInfluence: 'float 0-100', outSpeed: 'float', outInfluence: 'float 0-100' },
  },
  setKeyframeSpatial: {
    domain: 'Keyframes',
    summary: 'Set spatial tangents on position keyframes.',
    params: { propertyPath: 'array', propertyName: 'string', keyIndices: 'array of int', keyIndex: 'int', keyTime: 'float seconds', spatialIn: '[x,y(,z)]', spatialOut: '[x,y(,z)]', autoBezier: 'bool', continuous: 'bool', roving: 'bool' },
  },
  copyKeyframeEasing: {
    domain: 'Keyframes',
    summary: 'Copy keyframe easing from a source property to a target property.',
    params: { sourceCompName: 'string', sourceLayerIndex: 'int', sourceLayerName: 'string', targetCompName: 'string', targetLayerIndex: 'int', targetLayerName: 'string', propertyPath: 'array', propertyName: 'string', timeOffset: 'float seconds (default 0)' },
  },
  removePropertyKeyframes: { domain: 'Keyframes', summary: 'Remove all keyframes on a property (propertyPath/propertyName).', params: { propertyPath: 'array', propertyName: 'string' } },

  // ── Expressions ───────────────────────────────────────────────────────────
  getLayerExpressions: { domain: 'Expressions', summary: 'List expressions on a layer.', params: {} },
  setLayerExpression: {
    domain: 'Expressions',
    summary: 'Set/remove an expression (expressionString OR preset).',
    params: { propertyPath: 'array', propertyName: 'string', expressionString: 'string ("" removes)', preset: 'INERTIAL_BOUNCE|ELASTIC|OVERSHOOT|WIGGLE|AUTO_FADE|LOOP_OUT|LOOP_IN|LOOP_PINGPONG', presetParams: 'object (preset-specific: amp/freq/decay, fadeIn/fadeOut, ...)' },
  },

  // ── Masks ─────────────────────────────────────────────────────────────────
  getLayerMasks: { domain: 'Masks', summary: 'List masks on a layer.', params: {} },
  setLayerMask: {
    domain: 'Masks',
    summary: 'Create/update a mask (omit maskIndex to create).',
    params: { maskIndex: 'int (1-based; omit to create)', maskPath: 'array of [x,y] (>=3 verts)', maskRect: 'object {top,left,width,height}', maskMode: 'none|add|subtract|intersect|lighten|darken|difference', maskFeather: 'float or [x,y]', maskOpacity: 'float 0-100', maskExpansion: 'float px', maskName: 'string', closed: 'bool (default true)', maskInTangents: 'array of [x,y]', maskOutTangents: 'array of [x,y]' },
  },
  deleteLayerMask: { domain: 'Masks', summary: 'Delete a mask (maskIndex or maskName).', params: { maskIndex: 'int (1-based)', maskName: 'string' } },

  // ── Effects ───────────────────────────────────────────────────────────────
  getLayerEffects: { domain: 'Effects', summary: 'List effects on a layer.', params: {} },
  applyEffect: {
    domain: 'Effects',
    summary: 'Apply an effect. Prefer a known effectName (resolves to the right AE matchName for you; don\'t guess matchNames): gaussian-blur, directional-blur, color-balance, brightness-contrast, curves, glow, drop-shadow, vibrance. Power use: pass effectMatchName (raw AE matchName) or presetPath. Returns a "warning" if some effectSettings didn\'t apply.',
    params: { effectName: 'string (known effect or AE display name)', effectMatchName: 'string (raw AE matchName, e.g. "ADBE Ramp")', presetPath: 'string (.ffx path)', effectSettings: 'object {propertyName: value}' },
  },
  adjustColor: {
    domain: 'Effects',
    summary: 'Color correction / grade — use for "warm it up", "fix the exposure", "more contrast/saturation", "cinematic look". Knobs are signed deltas, 0 = no change (drive Lumetri Color). look applies a curated preset. Never improvise a raw effect stack for color. Returns a "warning" if a knob couldn\'t apply.',
    params: { layerIndices: 'array of int (1-based)', exposure: 'float stops (+ brighter)', contrast: 'float -100..100', saturation: 'float -100..100 (0 neutral)', temperature: 'float -100..100 (+ warmer)', tint: 'float -100..100 (+ magenta)', highlights: 'float -100..100', shadows: 'float -100..100', look: 'warm|cool|teal-orange|vintage|bw|high-contrast' },
    required: ['layerIndices'],
  },
  applyEffectTemplate: {
    domain: 'Effects',
    summary: 'Apply a preset effect template with sensible defaults.',
    params: { templateName: 'gaussian-blur|directional-blur|color-balance|brightness-contrast|curves|glow|drop-shadow|cinematic-look|text-pop', customSettings: 'object — template-specific overrides' },
    required: ['templateName'],
  },
  setEffectProperty: {
    domain: 'Effects',
    summary: 'Set one effect property (effectIndex/effectName + propertyName).',
    params: { effectIndex: 'int (1-based)', effectName: 'string', propertyName: 'string', value: 'any' },
    required: ['propertyName', 'value'],
  },
  deleteEffect: { domain: 'Effects', summary: 'Delete an effect (effectIndex or effectName).', params: { effectIndex: 'int (1-based)', effectName: 'string' } },
  // internal: ground-truth probe — asks AE for the real matchName + property names of each candidate
  // so tests/fixtures/ae-matchnames.json (and the static matchname guard) stay sourced from real AE,
  // not memory. Hidden from the model's catalog; run manually to (re)generate the fixture.
  introspectMatchNames: { domain: 'Effects', summary: 'Probe AE for the real matchName + properties of candidate effect matchNames.', params: { matchNames: 'array of string (defaults to the effect dictionary)' }, internal: true },

  // ── Text ──────────────────────────────────────────────────────────────────
  addTextAnimator: {
    domain: 'Text',
    summary: 'Add a text animator with one or more animated properties.',
    params: { properties: 'array of: Position|Scale|Skew|Rotation|Opacity|Fill Color|Stroke Color|Tracking Amount|Character Offset|Line Anchor|Line Spacing', name: 'string', initialValues: 'object {propertyName: value}' },
    required: ['properties'],
  },
  setTextAnimatorProperty: {
    domain: 'Text',
    summary: 'Set a property on an existing text animator.',
    params: { animatorIndex: 'int (1-based)', propertyName: 'string', value: 'any' },
    required: ['animatorIndex', 'propertyName', 'value'],
  },
  setTextAnimatorRangeSelector: {
    domain: 'Text',
    summary: 'Configure a text animator range selector.',
    params: { animatorIndex: 'int (1-based)', rangeSelectorIndex: 'int (default 1)', start: 'float 0-100', end: 'float 0-100', offset: 'float 0-100', units: 'percentage|index', basedOn: 'characters|charactersExcludingSpaces|words|lines', shape: 'square|rampUp|rampDown|triangle|round|smooth' },
    required: ['animatorIndex'],
  },
  explodeTextLayer: { domain: 'Text', summary: 'Split a text layer into per-unit layers.', params: { splitMethod: 'CHARACTERS|WORDS|LINES (default CHARACTERS)' } },
  animateText: {
    domain: 'Text',
    summary: 'Animate text in/out in ONE call — kinetic typography. Builds the text animator + range selector + keyframed Offset that drives the reveal across characters/words/lines. Use for "type on", "kinetic type", "words fly up", "typewriter", "reveal the title" — NEVER hand-wire addTextAnimator + setTextAnimatorRangeSelector + setLayerKeyframe. Pick a preset and override knobs as needed. Auto-enables motion blur on positional reveals + an ease-out settle unless ease=linear or motionBlur=false.',
    params: {
      preset: 'typewriter|wordByWord|lineByLine|fadeUpByWord|cascade|wave|scaleUp (presets every knob; default typewriter)',
      animateProps: 'array of: Position|Opacity|Scale|Rotation|Tracking (overrides the preset set)',
      basedOn: 'characters|charactersExcludingSpaces|words|lines',
      shape: 'square|rampUp|rampDown|triangle|round|smooth (range-selector shape)',
      easeHigh: 'float 0-100 (range-selector Ease High)', easeLow: 'float 0-100 (range-selector Ease Low)',
      startTime: 'float seconds (default 0)', duration: 'float seconds (preset default ~1.5)',
      ease: 'easyEase|easeIn|easeOut|linear|hold|bezier (default easeOut)',
      direction: 'on|off (reveal in vs out; default on)',
      positionOffset: '[x,y] px the chars travel from (default [0,-100])',
      scaleFrom: 'float % chars scale up from (default 0)', rotationAmount: 'float deg', trackingAmount: 'float',
      motionBlur: 'bool (override the auto motion-blur default)', name: 'string (animator name)',
    },
  },
  listFonts: { domain: 'Text', summary: 'List installed font families (optional substring filter). Common display names auto-resolve when you set fontFamily; call this to pick a real installed font for vague requests ("a fun font").', params: { filter: 'string — case-insensitive substring to narrow families' } },

  // ── Shapes ────────────────────────────────────────────────────────────────
  addShapeOperator: {
    domain: 'Shapes',
    summary: 'Add a shape operator to a shape layer group.',
    params: { type: 'trimPaths|repeater|roundedCorners|gradientFill|gradientStroke', groupPath: 'array e.g. ["Contents","Group 1","Contents"]', settings: 'object {propertyName: value}' },
    required: ['type'],
  },
  setShapeOperatorProperty: {
    domain: 'Shapes',
    summary: 'Set a property on a shape operator (operatorPath).',
    params: { operatorPath: 'array e.g. ["Contents","Group 1","Contents","Trim Paths 1"]', propertyName: 'string', value: 'any' },
    required: ['operatorPath', 'propertyName', 'value'],
  },
  convertToShape: { domain: 'Shapes', summary: 'Convert a text/solid/parametric layer to editable shapes.', params: {} },
  animateShape: {
    domain: 'Shapes',
    summary: 'Write-on / draw-on reveal for a shape layer — finds or adds Trim Paths and keyframes it so the stroke draws on. Use for "draw it on", "reveal the stroke/line", "write-on logo", "animate the path" — NEVER hand-keyframe Trim Paths. Defaults to a clean ease-out draw-on (End 0→100).',
    params: { trimProperty: 'start|end (which trim end animates; default end)', startValue: 'float 0-100 (default 0)', endValue: 'float 0-100 (default 100)', startTime: 'float seconds (default 0)', duration: 'float seconds (default 1.0)', ease: 'easyEase|easeIn|easeOut|linear|hold|bezier (default easeOut)', offset: 'float deg (static Trim Offset)', groupPath: 'array e.g. ["Contents","Group 1","Contents"] (default first group)', overwriteKeyframes: 'bool' },
  },
  extractShapes: {
    domain: 'Shapes',
    summary: 'Explode a shape layer\'s top-level groups onto separate shape layers (the shape analog of explodeTextLayer) so each can animate independently. Source is hidden unless deleteSource.',
    params: { deleteSource: 'bool — remove the source instead of hiding it (default false)' },
  },
  mergeShapes: {
    domain: 'Shapes',
    summary: 'Merge several shape layers into the first one (deep-clones each layer\'s groups, then removes the merged-away layers). Returns a warning for any sub-property it could not copy.',
    params: { layerIndices: 'array of int (1-based; first is the target)' },
    required: ['layerIndices'],
  },

  // ── Markers ───────────────────────────────────────────────────────────────
  addMarker: {
    domain: 'Markers',
    summary: 'Add a comp or layer marker (layerIndex/layerName -> layer marker).',
    params: { time: 'float seconds', comment: 'string', duration: 'float seconds', chapter: 'string', url: 'string', frameTarget: 'string', cuePointName: 'string', label: 'int 0-15', protectedRegion: 'bool' },
    required: ['time'],
  },
  listMarkers: { domain: 'Markers', summary: 'List comp or layer markers.', params: {} },
  updateMarker: {
    domain: 'Markers',
    summary: 'Update a marker (markerIndex or time).',
    params: { markerIndex: 'int (1-based)', time: 'float seconds', comment: 'string', duration: 'float seconds', chapter: 'string', url: 'string', frameTarget: 'string', cuePointName: 'string', label: 'int 0-15', protectedRegion: 'bool' },
  },
  removeMarker: { domain: 'Markers', summary: 'Remove a marker (markerIndex/time) or all.', params: { markerIndex: 'int (1-based)', time: 'float seconds', all: 'bool — remove all on target' } },

  // ── Footage / project panel ───────────────────────────────────────────────
  listProjectItems: { domain: 'Footage', summary: 'List project-panel items (optionally by type).', params: { type: 'footage|composition|folder|solid' } },
  importFootage: { domain: 'Footage', summary: 'Import a media file into the project panel.', params: { filePath: 'string (abs path)', sequence: 'bool — image sequence' }, required: ['filePath'] },
  addFootageToComp: {
    domain: 'Footage',
    summary: 'Add a project item to a comp as a layer (itemId/itemName/itemIndex).',
    params: { itemId: 'int', itemName: 'string', itemIndex: 'int (1-based)', position: '[x,y]', startTime: 'float seconds', duration: 'float seconds', name: 'string' },
  },
  importAssetToComp: {
    domain: 'Footage',
    summary: 'Import a file and add it to a comp in one step.',
    params: { filePath: 'string (abs path)', sequence: 'bool', position: '[x,y]', startTime: 'float seconds', duration: 'float seconds', name: 'string' },
    required: ['filePath'],
  },
  deleteProjectItem: { domain: 'Footage', summary: 'Delete a project-panel item (itemId or itemName).', params: { itemId: 'int', itemName: 'string' } },
  deleteUnusedSolids: { domain: 'Footage', summary: 'Delete solids not used by any comp.', params: {} },
  createFolder: {
    domain: 'Footage',
    summary: 'Create a folder in the project panel (at the root). Auto-numbers on a name clash ("Assets" -> "Assets (1)"); never overwrites. Returns the final name + a renamed flag.',
    params: { name: 'string — folder name' },
    required: ['name'],
  },
  updateProjectItem: {
    domain: 'Footage',
    summary: 'Rename and/or move any project item (footage, solid, folder, comp). Target by itemId (exact) or itemName (must be unique — ambiguous names error with candidate ids). Provide newName and/or a parent target. Move to the project root with parentFolderId: 0. Discover folder ids via listProjectItems (parentId/parentName).',
    params: {
      itemId: 'int — exact target',
      itemName: 'string — unique target name',
      newName: 'string — new name',
      parentFolderId: 'int — destination folder id (0 = project root)',
      parentFolderName: 'string — destination folder name (must be unique)',
      onNameConflict: 'suffix|replace — on a same-name sibling: suffix (default) auto-numbers; replace deletes a same-named footage/comp (never a folder)',
    },
  },

  // ── Project ───────────────────────────────────────────────────────────────
  getProjectPath: { domain: 'Project', summary: 'Get the project file path + dirty flag.', params: {} },
  saveProject: { domain: 'Project', summary: 'Save the project (optionally to a new path).', params: { saveAs: 'string (abs path)' } },
  restoreProject: { domain: 'Project', summary: 'Revert the whole project one turn back (undo the last change); call repeatedly to step further back. One-way — no redo. Reopens the project from disk. Omit args to undo the most recent turn; returns status "noop" when already at the earliest restore point.', params: { turnId: 'string (ms timestamp; omit for most recent)', backupPath: 'string (abs path; usually omit)' } },
  // internal: kept in the registry (drift-checked, callable via MCP/diagnostic) but hidden from
  // the model's catalog — a single still frame can't convey MOTION, so the loop never views work
  // this way. Real motion-viewing is deferred to Phase 4 (Gemini video).
  saveFrameToPng: { domain: 'Project', summary: 'Render one frame of a comp to a PNG.', params: { timeInSeconds: 'float (default playhead)', outputPath: 'string (abs path)' }, internal: true },

  // ── Motion recipes & 3D ───────────────────────────────────────────────────
  applyMotionRecipe: {
    domain: 'Motion',
    summary: 'Apply a juicy motion preset to layers.',
    params: { recipe: 'popIn|popOut|fadeIn|fadeOut|slideIn|slideOut|scaleIn|bounceIn|wiggle', layerIndices: 'array of int (1-based)', startTime: 'float seconds (default 0)', duration: 'float seconds (default 0.5)', stagger: 'float seconds (cascade)', ease: 'easyEase|easeIn|easeOut|linear|hold|bezier', bounce: 'bool — add INERTIAL_BOUNCE on Scale', intensity: 'float (default 1.0)', overwriteKeyframes: 'bool', from: '[x,y] offset (slide origin)' },
    required: ['recipe', 'layerIndices'],
  },
  distributeLayers3D: {
    domain: 'Motion',
    summary: 'Arrange layers in 3D (cylinder or grid).',
    params: { shape: 'cylinder|grid', layerIndices: 'array of int (>=2, 1-based)', center: '[x,y,z]', enable3D: 'bool (default true)', faceCamera: 'bool', overwriteKeyframes: 'bool', radius: 'float (cylinder, default 400)', depthSpacing: 'float (cylinder)', rings: 'int (cylinder)', axis: 'x|y|z (cylinder)', spacing: '[x,y,z] (grid)', rows: 'int (grid)', cols: 'int (grid)' },
    required: ['shape', 'layerIndices'],
  },
  cameraMove: {
    domain: 'Motion',
    summary: 'Create/animate a camera for a scene move in ONE call — use for "push in", "zoom in on", "orbit around", "parallax", "camera move". Creates a camera if the comp has none (createIfMissing). Keyframes are eased. NEVER hand-keyframe a camera rig for these.',
    params: { move: 'pushIn|orbit|parallax', startTime: 'float seconds (default 0)', duration: 'float seconds (default 2)', ease: 'easyEase|easeIn|easeOut|linear|hold|bezier (default easyEase)', amount: 'float (pushIn: zoom factor ~0.3; orbit: degrees ~30; parallax: pan px ~200)', layerIndices: 'array of int (parallax: the layers to spread in depth)', zoomFrom: 'float (pushIn)', zoomTo: 'float (pushIn)', createIfMissing: 'bool (default true)', overwriteKeyframes: 'bool' },
    required: ['move'],
  },
  createBackground: {
    domain: 'Motion',
    summary: 'Add a comp-sized background layer at the BOTTOM of the stack — use for "add a background/backdrop", "gradient background". Solid + optional Gradient Ramp (gradient stop colors via the Ramp effect, the scriptable path). Optional subtle animated drift.',
    params: { color: '[r,g,b] 0-1 (solid base; default dark)', gradient: 'bool — add a Gradient Ramp (default true)', startColor: '[r,g,b] 0-1', endColor: '[r,g,b] 0-1', gradientShape: 'linear|radial (default linear)', animate: 'bool — subtle drift (default false)', driftAmount: 'float (drift amplitude)', name: 'string (default "Background")' },
  },

  // ── Multi-command ─────────────────────────────────────────────────────────
  batch: {
    domain: 'Batch',
    summary: 'Run multiple commands in one undo group (also a typed tool).',
    params: { commands: 'array of {script, parameters}', groupLabel: 'string — undo-group label', stopOnError: 'bool — abort on first error' },
    required: ['commands'],
  },
} satisfies Record<string, CommandSpec>;

export type CommandName = keyof typeof COMMAND_PARAMS;

/**
 * Canonical command-name list, DERIVED from the registry keys. The drift guard
 * asserts this equals `server/ae-bridge/src/commands.ts`. Consumed by the runScript /
 * batch tool enum in `definitions.ts`.
 */
export const COMMAND_NAMES = Object.keys(COMMAND_PARAMS) as [CommandName, ...CommandName[]];
