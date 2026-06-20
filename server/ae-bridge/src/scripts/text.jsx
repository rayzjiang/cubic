// text.jsx
// Text layers + text animators.
// CRUD: C ✓  R via getLayerInfo/getLayerProperty  U ✓  D via deleteLayer
// explodeTextLayer: C ✓  (inverse: delete created layers + re-enable original)

// C: createTextLayer
function createTextLayer(args) {
    // Tracked across the try so the catch can roll back a half-created layer. addText() creates
    // the layer up front, but a later step (e.g. an unavailable font name) can still throw — without
    // rollback the failed call leaves an orphan, and the self-heal retry then stacks a second
    // overlapping layer. Atomic create: on any failure, leave no trace.
    var textLayer = null;
    try {
        var comp = _resolveComp(args);
        var text = args.text || "Text Layer";
        var position = args.position;
        var fontSize = args.fontSize || 72;
        var color = args.color || [1, 1, 1];
        var startTime = args.startTime || 0;
        var duration = args.duration || 5;
        // Resolve to a real PostScript name BEFORE creating the layer, so a bad font name
        // fails here (textLayer still null → no orphan) rather than after addText.
        var fontFamily = _resolveFont(args.fontFamily || "Arial");
        var alignment = args.alignment || "center";

        if (!position) { position = [comp.width / 2, comp.height / 2]; }
        textLayer = comp.layers.addText(text);
        var textProp = textLayer.property("ADBE Text Properties").property("ADBE Text Document");
        var textDocument = textProp.value;
        textDocument.fontSize = fontSize;
        textDocument.fillColor = color;
        textDocument.font = fontFamily;
        if (alignment === "left") { textDocument.justification = ParagraphJustification.LEFT_JUSTIFY; }
        else if (alignment === "center") { textDocument.justification = ParagraphJustification.CENTER_JUSTIFY; }
        else if (alignment === "right") { textDocument.justification = ParagraphJustification.RIGHT_JUSTIFY; }
        textProp.setValue(textDocument);
        textLayer.property("Position").setValue(position);
        textLayer.startTime = startTime;
        if (duration > 0) { textLayer.outPoint = startTime + duration; }
        return JSON.stringify({
            status: "success", message: "Text layer created successfully",
            layer: { name: textLayer.name, index: textLayer.index, type: "text", inPoint: textLayer.inPoint, outPoint: textLayer.outPoint, position: textLayer.property("Position").value }
        }, null, 2);
    } catch (error) {
        // Roll back the partially-created layer so a failed create leaves no orphan.
        if (textLayer !== null) { try { textLayer.remove(); } catch (e2) {} }
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: addTextAnimator — add a text animator with one or more animated properties
function addTextAnimator(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var textProp = layer.property("Text");
        if (!textProp) { throw _err(ERROR_CODES.INVALID_ARGS, "Layer '" + layer.name + "' is not a text layer."); }

        var animators = textProp.property("Animators");
        if (!animators) { throw _err(ERROR_CODES.PROPERTY_NOT_FOUND, "Text layer has no Animators group."); }

        var properties = args.properties;
        if (!properties || typeof properties.length === "undefined" || properties.length === 0) {
            throw _err(ERROR_CODES.INVALID_ARGS, "properties must be a non-empty array of property names.");
        }

        var animator = animators.addProperty("ADBE Text Animator");
        if (args.name) { animator.name = args.name; }

        // AE's UI auto-creates Range Selector 1 when adding an animator; scripting doesn't.
        try {
            var selectorsGroup = animator.property("ADBE Text Selectors");
            if (selectorsGroup && selectorsGroup.numProperties === 0) {
                selectorsGroup.addProperty("ADBE Text Selector");
            }
        } catch (selErr) {}

        var propMatchNames = {
            "Position":        "ADBE Text Position 3D",
            "Scale":           "ADBE Text Scale 3D",
            "Skew":            "ADBE Text Skew",
            "Rotation":        "ADBE Text Rotation",
            "Opacity":         "ADBE Text Opacity",
            "Fill Color":      "ADBE Text Fill Color",
            "Stroke Color":    "ADBE Text Stroke Color",
            "Tracking Amount": "ADBE Text Tracking Amount",
            "Character Offset":"ADBE Text Character Offset",
            "Line Anchor":     "ADBE Text Line Anchor",
            "Line Spacing":    "ADBE Text Line Spacing"
        };

        var animatorProps = animator.property("ADBE Text Animator Properties");
        var addedProperties = [];

        for (var i = 0; i < properties.length; i++) {
            var propName = properties[i];
            var matchName = propMatchNames[propName] || propName;
            try {
                var addedProp = animatorProps.addProperty(matchName);
                addedProperties.push({ name: propName, matchName: matchName });

                if (args.initialValues && args.initialValues[propName] !== undefined) {
                    var initVal = args.initialValues[propName];
                    if (typeof initVal === "string") { try { initVal = eval("(" + initVal + ")"); } catch(e) {} }
                    var curVal = addedProp.value;
                    var finalVal;
                    if (typeof curVal === "object" && typeof curVal.length === "number" && curVal.length >= 1) {
                        finalVal = [];
                        for (var vi = 0; vi < curVal.length; vi++) {
                            finalVal[vi] = (initVal[vi] !== undefined) ? +initVal[vi] : +curVal[vi];
                        }
                    } else {
                        finalVal = +initVal;
                    }
                    addedProp.setValue(finalVal);
                }
            } catch(propErr) {
                addedProperties.push({ name: propName, matchName: matchName, error: propErr.toString() });
            }
        }

        var animatorIndex = animators.numProperties;

        return JSON.stringify({
            status: "success",
            message: "Text animator '" + animator.name + "' added to layer '" + layer.name + "'.",
            animator: {
                index: animatorIndex,
                name: animator.name,
                propertyPath: ["Text", "Animators", animator.name],
                properties: addedProperties
            }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: setTextAnimatorProperty — update an animated property value on a text animator
function setTextAnimatorProperty(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var animatorIndex = args.animatorIndex;
        var propertyName = args.propertyName;
        var value = args.value;

        if (!animatorIndex) { throw _err(ERROR_CODES.INVALID_ARGS, "animatorIndex is required."); }
        if (!propertyName)  { throw _err(ERROR_CODES.INVALID_ARGS, "propertyName is required."); }

        var textProp = layer.property("Text");
        if (!textProp) { throw _err(ERROR_CODES.INVALID_ARGS, "Layer is not a text layer."); }

        var animators = textProp.property("Animators");
        if (animatorIndex > animators.numProperties) {
            throw _err(ERROR_CODES.LAYER_INDEX_OOB, "animatorIndex " + animatorIndex + " out of bounds (" + animators.numProperties + " animators).");
        }

        var animator = animators.property(animatorIndex);
        var animatorProps = animator.property("ADBE Text Animator Properties");

        var prop = null;
        try { prop = animatorProps.property(propertyName); } catch(e) {}
        if (!prop) {
            for (var pi = 1; pi <= animatorProps.numProperties; pi++) {
                if (animatorProps.property(pi).name === propertyName) { prop = animatorProps.property(pi); break; }
            }
        }
        if (!prop) { throw _err(ERROR_CODES.PROPERTY_NOT_FOUND, "Property '" + propertyName + "' not found on animator " + animatorIndex + "."); }

        if (typeof value === "string") { try { value = eval("(" + value + ")"); } catch(e) {} }
        var curVal = prop.value;
        var previousValue = curVal;
        var finalVal;
        if (typeof curVal === "object" && typeof curVal.length === "number" && curVal.length >= 1) {
            finalVal = [];
            for (var vi = 0; vi < curVal.length; vi++) {
                finalVal[vi] = (value[vi] !== undefined) ? +value[vi] : +curVal[vi];
            }
        } else {
            finalVal = +value;
        }

        // No-op: requested value already matches the current value — nothing to mutate.
        if (_valuesEqual(finalVal, prop.value)) {
            return JSON.stringify({ status: "noop", message: "This text animator property is already set to that value." }, null, 2);
        }

        prop.setValue(finalVal);

        return JSON.stringify({
            status: "success",
            message: "Text animator property '" + propertyName + "' set.",
            animator: { index: animatorIndex, name: animator.name },
            property: { name: prop.name, value: prop.value },
            previousValue: previousValue
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: explodeTextLayer — split a text layer into N per-token layers that preserve original layout.
// Strategy: each duplicate keeps the full text; two stacked text animators hide all tokens except the
// target one (Animator1 Opacity=0 for all, Animator2 Opacity=100 for token i — later animator wins).
// splitMethod: CHARACTERS | WORDS | LINES
function explodeTextLayer(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var textProp = layer.property("Text");
        if (!textProp) throw _err(ERROR_CODES.INVALID_ARGS, "Layer '" + layer.name + "' is not a text layer.");

        var splitMethod = (args.splitMethod || "CHARACTERS").toUpperCase();
        var methodMap = { "CHARACTERS": true, "WORDS": true, "LINES": true };
        if (!methodMap[splitMethod]) throw _err(ERROR_CODES.INVALID_ARGS, "splitMethod must be CHARACTERS, WORDS, or LINES.");

        var textDocProp = textProp.property("ADBE Text Document");
        var srcText = textDocProp.value.text;
        if (!srcText || srcText.length === 0) throw _err(ERROR_CODES.INVALID_ARGS, "Source text layer is empty.");

        // Tokenize — store string position for characters (for percentage calc), sequential index otherwise
        var tokens = [];
        if (splitMethod === "CHARACTERS") {
            for (var c = 0; c < srcText.length; c++) {
                tokens.push({ text: srcText.charAt(c), idx: c, total: srcText.length });
            }
        } else if (splitMethod === "WORDS") {
            var wordParts = srcText.replace(/\r/g, " ").split(/\s+/);
            var wCount = 0;
            for (var w = 0; w < wordParts.length; w++) {
                if (wordParts[w].length > 0) { tokens.push({ text: wordParts[w], idx: wCount, total: null }); wCount++; }
            }
            for (var tw = 0; tw < tokens.length; tw++) tokens[tw].total = wCount;
        } else {
            var lineParts = srcText.split("\r");
            var lCount = 0;
            for (var l = 0; l < lineParts.length; l++) {
                if (lineParts[l].length > 0) { tokens.push({ text: lineParts[l], idx: lCount, total: null }); lCount++; }
            }
            for (var tl = 0; tl < tokens.length; tl++) tokens[tl].total = lCount;
        }

        if (tokens.length === 0) throw _err(ERROR_CODES.INVALID_ARGS, "No tokens found in the text.");

        var basedOnValue = (splitMethod === "CHARACTERS") ? 1 : (splitMethod === "WORDS" ? 3 : 4);
        // AE basedOn: 1=characters, 2=charactersExcludingSpaces, 3=words, 4=lines

        function _configureSelector(selector, startPct, endPct, basedOn) {
            try { selector.property("Start").setValue(startPct); } catch(e) {}
            try { selector.property("End").setValue(endPct); } catch(e) {}
            var adv = null;
            try { adv = selector.property("ADBE Text Range Advanced"); } catch(e) {}
            if (!adv) { try { adv = selector.property("Advanced"); } catch(e) {} }
            if (adv) {
                var boProp = null;
                try { boProp = adv.property("ADBE Text Selector Based On"); } catch(e) {}
                if (!boProp) { try { boProp = adv.property("ADBE Text Range Based On"); } catch(e) {} }
                if (!boProp) {
                    for (var bi = 1; bi <= adv.numProperties; bi++) {
                        try { if (adv.property(bi).name === "Based On") { boProp = adv.property(bi); break; } } catch(e) {}
                    }
                }
                if (boProp) { try { boProp.setValue(basedOn); } catch(e) {} }
            }
        }

        var N = tokens.length;
        var sourceLayerIndex = layer.index;
        var prevEnabled = layer.enabled;
        var createdLayers = [];

        for (var i = 0; i < N; i++) {
            var token = tokens[i];
            var startPct = (token.idx / token.total) * 100;
            var endPct   = ((token.idx + 1) / token.total) * 100;

            var dup = layer.duplicate();
            dup.name = layer.name + " [" + token.text + "]";

            var dupAnimators = dup.property("Text").property("Animators");

            // Animator 1: Opacity=0 covering ALL tokens (hides everything)
            var hideAnim = dupAnimators.addProperty("ADBE Text Animator");
            var hideAnimProps = hideAnim.property("ADBE Text Animator Properties");
            var hideOpacity = hideAnimProps.addProperty("ADBE Text Opacity");
            hideOpacity.setValue(0);
            var hideSelectors = hideAnim.property("ADBE Text Selectors");
            if (hideSelectors.numProperties === 0) hideSelectors.addProperty("ADBE Text Selector");
            _configureSelector(hideSelectors.property(1), 0, 100, basedOnValue);

            // Animator 2: Opacity=100 covering only token i (restores visibility for this token)
            // Being added AFTER Animator 1 gives it higher priority in AE's stacking order.
            var showAnim = dupAnimators.addProperty("ADBE Text Animator");
            var showAnimProps = showAnim.property("ADBE Text Animator Properties");
            var showOpacity = showAnimProps.addProperty("ADBE Text Opacity");
            showOpacity.setValue(100);
            var showSelectors = showAnim.property("ADBE Text Selectors");
            if (showSelectors.numProperties === 0) showSelectors.addProperty("ADBE Text Selector");
            _configureSelector(showSelectors.property(1), startPct, endPct, basedOnValue);

            createdLayers.push({ index: dup.index, name: dup.name, token: token.text });
        }

        // Hide source layer
        layer.enabled = false;

        return JSON.stringify({
            status: "success",
            message: "Text layer '" + layer.name + "' exploded into " + N + " layers by " + splitMethod + ".",
            splitMethod: splitMethod,
            tokenCount: N,
            createdLayers: createdLayers,
            hiddenSourceIndex: sourceLayerIndex,
            previousValues: { sourceEnabled: prevEnabled }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: setTextAnimatorRangeSelector — configure the Range Selector on a text animator
function setTextAnimatorRangeSelector(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var animatorIndex = args.animatorIndex;
        var rangeSelectorIndex = args.rangeSelectorIndex || 1;

        if (!animatorIndex) { throw _err(ERROR_CODES.INVALID_ARGS, "animatorIndex is required."); }

        var textProp = layer.property("Text");
        if (!textProp) { throw _err(ERROR_CODES.INVALID_ARGS, "Layer is not a text layer."); }

        var animators = textProp.property("Animators");
        if (animatorIndex > animators.numProperties) { throw _err(ERROR_CODES.LAYER_INDEX_OOB, "animatorIndex out of bounds."); }

        var animator = animators.property(animatorIndex);
        var selectors = animator.property("ADBE Text Selectors");
        if (rangeSelectorIndex > selectors.numProperties) {
            throw _err(ERROR_CODES.LAYER_INDEX_OOB, "rangeSelectorIndex " + rangeSelectorIndex + " out of bounds (" + selectors.numProperties + " selectors).");
        }

        var selector = selectors.property(rangeSelectorIndex);

        // Validate-first: reject invalid units/basedOn/shape BEFORE mutating any selector property.
        var UNIT_MAP = { "percentage": 1, "index": 2 };
        var BASED_ON_MAP = { "characters": 1, "charactersExcludingSpaces": 2, "words": 3, "lines": 4 };
        var SHAPE_MAP = { "square": 1, "rampUp": 2, "rampDown": 3, "triangle": 4, "round": 5, "smooth": 6 };
        var unitsVal = null, basedOnVal = null, shapeVal = null;
        if (args.units !== undefined && args.units !== null)     { unitsVal   = _requireEnum(args.units, UNIT_MAP, "units"); }
        if (args.basedOn !== undefined && args.basedOn !== null) { basedOnVal = _requireEnum(args.basedOn, BASED_ON_MAP, "basedOn"); }
        if (args.shape !== undefined && args.shape !== null)     { shapeVal   = _requireEnum(args.shape, SHAPE_MAP, "shape"); }

        // Capture prior state for revert (only for fields the args touch)
        var previousValues = {};
        if (args.start !== undefined)  { previousValues.start  = selector.property("Start").value;  }
        if (args.end !== undefined)    { previousValues.end    = selector.property("End").value;    }
        if (args.offset !== undefined) { previousValues.offset = selector.property("Offset").value; }
        var advancedSnap = null;
        try { advancedSnap = selector.property("ADBE Text Range Advanced"); } catch(e) {}
        if (advancedSnap) {
            if (args.units !== undefined) { try { previousValues.units = advancedSnap.property("ADBE Text Range Units").value; } catch(e) {} }
            if (args.shape !== undefined) { try { previousValues.shape = advancedSnap.property("ADBE Text Range Shape").value; } catch(e) {} }
        }

        var changed = [];

        if (args.start !== undefined)  { selector.property("Start").setValue(args.start);   changed.push("start");  }
        if (args.end !== undefined)    { selector.property("End").setValue(args.end);         changed.push("end");    }
        if (args.offset !== undefined) { selector.property("Offset").setValue(args.offset); changed.push("offset"); }

        var advanced = null;
        try { advanced = selector.property("ADBE Text Range Advanced"); } catch(e) {}
        if (advanced) {
            if (unitsVal !== null) {
                advanced.property("ADBE Text Range Units").setValue(unitsVal);
                changed.push("units");
            }
            if (basedOnVal !== null) {
                // AE uses "ADBE Text Selector Based On" (not "Range") — inconsistent naming; scan by display name as fallback.
                var basedOnProp = null;
                try { basedOnProp = advanced.property("ADBE Text Selector Based On"); } catch(e) {}
                if (!basedOnProp) { try { basedOnProp = advanced.property("ADBE Text Range Based On"); } catch(e) {} }
                if (!basedOnProp) {
                    for (var bi = 1; bi <= advanced.numProperties; bi++) {
                        try { if (advanced.property(bi).name === "Based On") { basedOnProp = advanced.property(bi); break; } } catch(e) {}
                    }
                }
                if (basedOnProp) { basedOnProp.setValue(basedOnVal); changed.push("basedOn"); }
            }
            if (shapeVal !== null) {
                advanced.property("ADBE Text Range Shape").setValue(shapeVal);
                changed.push("shape");
            }
        }

        return JSON.stringify({
            status: "success",
            message: "Range selector updated: " + (changed.length ? changed.join(", ") : "no fields changed") + ".",
            animator: { index: animatorIndex, name: animator.name },
            selector: {
                index: rangeSelectorIndex,
                name: selector.name,
                start: selector.property("Start").value,
                end: selector.property("End").value,
                offset: selector.property("Offset").value
            },
            previousValues: previousValues
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// ── Kinetic typography ──────────────────────────────────────────────────────
// animateText builds a complete, reliable text-reveal rig in one call: a Text Animator with the
// chosen animated properties, a Range Selector (basedOn / shape / Ease High / Ease Low), and the
// KEYFRAMED selector Offset that actually drives the reveal across the characters. This replaces
// hand-wiring addTextAnimator + setTextAnimatorRangeSelector + setLayerKeyframe (the error-prone path).
//
// How the reveal works: the animator holds the "hidden" state (Opacity 0, a Position offset, a small
// Scale). The Range Selector (Start=0 End=100, percentage units) selects characters, and Offset is
// keyframed 0 -> 100 so the selection sweeps OFF the text over `duration` — characters settle from the
// animated state to their base state left-to-right. Offset=0 = all selected (hidden); Offset=100 =
// none selected (fully visible at rest). direction "off" reverses it (100 -> 0) for an exit.

// Preset → knob defaults. Caller knobs override any of these (each read as a literal args.X below).
var TEXT_PRESETS = {
    typewriter:   { animateProps: ["Opacity"],                       basedOn: "characters", shape: "square", easeHigh: 0,   easeLow: 0,   duration: 1.5 },
    wordByWord:   { animateProps: ["Opacity", "Position"],           basedOn: "words",      shape: "rampUp", easeHigh: 100, easeLow: 0,   positionOffset: [0, -50], duration: 1.2 },
    lineByLine:   { animateProps: ["Opacity", "Position"],           basedOn: "lines",      shape: "rampUp", easeHigh: 100, easeLow: 0,   positionOffset: [0, -60], duration: 1.2 },
    fadeUpByWord: { animateProps: ["Opacity", "Position"],           basedOn: "words",      shape: "smooth", easeHigh: 100, easeLow: 100, positionOffset: [0, -40], duration: 1.5 },
    cascade:      { animateProps: ["Opacity", "Position", "Scale"],  basedOn: "characters", shape: "smooth", easeHigh: 100, easeLow: 0,   positionOffset: [0, -80], scaleFrom: 60, duration: 1.5 },
    wave:         { animateProps: ["Position"],                      basedOn: "characters", shape: "smooth", easeHigh: 100, easeLow: 100, positionOffset: [0, -30], duration: 2.0 },
    scaleUp:      { animateProps: ["Opacity", "Scale"],              basedOn: "characters", shape: "rampUp", easeHigh: 100, easeLow: 0,   scaleFrom: 0,  duration: 1.2 }
};

// C: animateText — one-call kinetic-typography reveal (preset + overridable knobs).
function animateText(args) {
    var animator = null;  // tracked for atomic-create rollback (see catch)
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp  = resolved.comp;
        var layer = resolved.layer;

        var textProp = layer.property("Text");
        if (!textProp) { throw _err(ERROR_CODES.INVALID_ARGS, "Layer '" + layer.name + "' is not a text layer."); }

        // Resolve preset (default typewriter when neither preset nor animateProps given), then let
        // explicit args override each knob. Every arg is read literally (args.X) for the drift guard.
        var presetName = args.preset ? String(args.preset) : (args.animateProps ? null : "typewriter");
        var preset = presetName ? TEXT_PRESETS[presetName] : null;
        if (presetName && !preset) {
            var names = [];
            for (var pn in TEXT_PRESETS) { if (TEXT_PRESETS.hasOwnProperty(pn)) names.push(pn); }
            throw _err(ERROR_CODES.INVALID_ARGS, "Unknown text preset '" + presetName + "'. Valid: " + names.join(", ") + ".");
        }
        var base = preset || {};

        var animateProps   = args.animateProps   !== undefined ? args.animateProps   : (base.animateProps || ["Opacity"]);
        var basedOn        = args.basedOn         !== undefined ? args.basedOn         : (base.basedOn || "characters");
        var shape          = args.shape           !== undefined ? args.shape           : (base.shape || "rampUp");
        var easeHigh       = args.easeHigh        !== undefined ? +args.easeHigh       : (base.easeHigh !== undefined ? base.easeHigh : 0);
        var easeLow        = args.easeLow         !== undefined ? +args.easeLow        : (base.easeLow !== undefined ? base.easeLow : 0);
        var startTime      = args.startTime       !== undefined ? +args.startTime      : 0;
        var duration       = args.duration        !== undefined ? +args.duration       : (base.duration !== undefined ? base.duration : 1.5);
        var direction      = args.direction       !== undefined ? String(args.direction) : "on";
        var positionOffset = args.positionOffset  !== undefined ? args.positionOffset  : (base.positionOffset || [0, -100]);
        var scaleFrom      = args.scaleFrom       !== undefined ? +args.scaleFrom      : (base.scaleFrom !== undefined ? base.scaleFrom : 0);
        var rotationAmount = args.rotationAmount  !== undefined ? +args.rotationAmount : 0;
        var trackingAmount = args.trackingAmount  !== undefined ? +args.trackingAmount : 0;

        if (typeof positionOffset === "string") { try { positionOffset = eval("(" + positionOffset + ")"); } catch (e) {} }
        if (!animateProps || typeof animateProps.length === "undefined" || animateProps.length === 0) {
            throw _err(ERROR_CODES.INVALID_ARGS, "animateProps must be a non-empty array (e.g. [\"Opacity\",\"Position\"]).");
        }
        if (duration <= 0) { throw _err(ERROR_CODES.INVALID_ARGS, "duration must be > 0."); }
        if (startTime + duration > comp.duration + 0.001) {
            throw _err(ERROR_CODES.TIME_OUT_OF_RANGE, "Reveal extends to " + (startTime + duration).toFixed(3) + "s, exceeding comp duration " + comp.duration.toFixed(3) + "s.");
        }

        // Auto-juice: enable motion blur on positional/scale reveals (unless caller says linear/false),
        // and default the Offset sweep to a snappy ease-out settle. Honors the literal/linear escape hatch.
        var ease = args.ease !== undefined ? String(args.ease) : "easeOut";
        var animatesMotion = false;
        for (var ap = 0; ap < animateProps.length; ap++) {
            if (animateProps[ap] === "Position" || animateProps[ap] === "Scale" || animateProps[ap] === "Rotation") { animatesMotion = true; }
        }
        var motionBlur = (args.motionBlur !== undefined) ? !!args.motionBlur : (animatesMotion && ease !== "linear");

        var animators = textProp.property("Animators");
        animator = animators.addProperty("ADBE Text Animator");
        if (args.name) { animator.name = args.name; }

        // AE's UI auto-creates Range Selector 1 when adding an animator; scripting doesn't.
        var selectors = animator.property("ADBE Text Selectors");
        if (selectors.numProperties === 0) { selectors.addProperty("ADBE Text Selector"); }
        var selector = selectors.property(1);

        var animatorProps = animator.property("ADBE Text Animator Properties");
        var propMatchNames = {
            "Position": "ADBE Text Position 3D",
            "Scale":    "ADBE Text Scale 3D",
            "Rotation": "ADBE Text Rotation",
            "Opacity":  "ADBE Text Opacity",
            "Tracking": "ADBE Text Tracking Amount"
        };
        var addedProps = [];
        for (var i = 0; i < animateProps.length; i++) {
            var pName = animateProps[i];
            var mn = propMatchNames[pName];
            if (!mn) { continue; }  // skip unknown props rather than fail the whole reveal
            var p = animatorProps.addProperty(mn);
            if (pName === "Opacity")       { p.setValue(0); }
            else if (pName === "Position") { p.setValue([+positionOffset[0] || 0, (positionOffset[1] !== undefined ? +positionOffset[1] : 0), 0]); }
            else if (pName === "Scale")    { p.setValue([scaleFrom, scaleFrom, 100]); }
            else if (pName === "Rotation") { p.setValue(rotationAmount); }
            else if (pName === "Tracking") { p.setValue(trackingAmount); }
            addedProps.push(pName);
        }

        // Configure the Range Selector: full range, percentage units, basedOn / shape / Ease High / Low.
        var BASED_ON_MAP = { "characters": 1, "charactersExcludingSpaces": 2, "words": 3, "lines": 4 };
        var SHAPE_MAP    = { "square": 1, "rampUp": 2, "rampDown": 3, "triangle": 4, "round": 5, "smooth": 6 };
        var basedOnVal = _requireEnum(basedOn, BASED_ON_MAP, "basedOn");
        var shapeVal   = _requireEnum(shape, SHAPE_MAP, "shape");
        try { selector.property("Start").setValue(0); } catch (e) {}
        try { selector.property("End").setValue(100); } catch (e) {}
        var advanced = null;
        try { advanced = selector.property("ADBE Text Range Advanced"); } catch (e) {}
        if (advanced) {
            try { advanced.property("ADBE Text Range Units").setValue(1); } catch (e) {}  // 1 = percentage
            try { advanced.property("ADBE Text Range Shape").setValue(shapeVal); } catch (e) {}
            // Based On — AE's matchName is inconsistent; scan by display name as a fallback.
            var boProp = null;
            try { boProp = advanced.property("ADBE Text Selector Based On"); } catch (e) {}
            if (!boProp) { try { boProp = advanced.property("ADBE Text Range Based On"); } catch (e) {} }
            if (!boProp) {
                for (var bi = 1; bi <= advanced.numProperties; bi++) {
                    try { if (advanced.property(bi).name === "Based On") { boProp = advanced.property(bi); break; } } catch (e) {}
                }
            }
            if (boProp) { try { boProp.setValue(basedOnVal); } catch (e) {} }
            // Ease High / Ease Low live under Advanced; reach them by display name (matchName varies by AE).
            var ehProp = _findAdvancedProp(advanced, "Ease High");
            var elProp = _findAdvancedProp(advanced, "Ease Low");
            if (ehProp) { try { ehProp.setValue(easeHigh); } catch (e) {} }
            if (elProp) { try { elProp.setValue(easeLow); } catch (e) {} }
        }

        // Drive the reveal: keyframe Offset 0 -> 100 (direction "on") so the selection sweeps off the text.
        var fromOffset = (direction === "off") ? 100 : 0;
        var toOffset   = (direction === "off") ? 0   : 100;
        var offsetProp = selector.property("Offset");
        _recipeSetKey(offsetProp, startTime, fromOffset, ease);
        _recipeSetKey(offsetProp, startTime + duration, toOffset, ease);

        var prevMotionBlur = layer.motionBlur;
        if (motionBlur) { layer.motionBlur = true; }

        return JSON.stringify({
            status: "success",
            message: "Animated text on '" + layer.name + "'" + (presetName ? " (" + presetName + ")" : "") + " — " + addedProps.join(" + ") + ", " + duration + "s.",
            preset: presetName,
            animator: { index: animators.numProperties, name: animator.name, propertyPath: ["Text", "Animators", animator.name] },
            animatedProperties: addedProps,
            motionBlur: !!motionBlur,
            previousValues: { motionBlur: prevMotionBlur }
        }, null, 2);
    } catch (error) {
        // Roll back the partially-built animator so a failed reveal leaves no orphan rig.
        if (animator !== null) { try { animator.remove(); } catch (e2) {} }
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// Find a Range Selector Advanced property (e.g. "Ease High", "Ease Low") by display name. AE's
// matchNames for these vary by version, so a display-name scan is the robust handle.
function _findAdvancedProp(advanced, displayName) {
    var p = null;
    try { p = advanced.property(displayName); } catch (e) {}
    if (p) { return p; }
    for (var i = 1; i <= advanced.numProperties; i++) {
        try { if (advanced.property(i).name === displayName) { return advanced.property(i); } } catch (e) {}
    }
    return null;
}
