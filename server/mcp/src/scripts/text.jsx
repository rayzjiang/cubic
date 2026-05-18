// text.jsx
// Text layers + text animators.
// CRUD: C ✓  R via getLayerInfo/getLayerProperty  U ✓  D via deleteLayer

// C: createTextLayer
function createTextLayer(args) {
    try {
        var comp = _resolveComp(args);
        var text = args.text || "Text Layer";
        var position = args.position;
        var fontSize = args.fontSize || 72;
        var color = args.color || [1, 1, 1];
        var startTime = args.startTime || 0;
        var duration = args.duration || 5;
        var fontFamily = args.fontFamily || "Arial";
        var alignment = args.alignment || "center";

        if (!position) { position = [comp.width / 2, comp.height / 2]; }
        var textLayer = comp.layers.addText(text);
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
            if (args.units !== undefined) {
                var unitMap = { "percentage": 1, "index": 2 };
                if (unitMap[args.units] !== undefined) {
                    advanced.property("ADBE Text Range Units").setValue(unitMap[args.units]);
                    changed.push("units");
                }
            }
            if (args.basedOn !== undefined) {
                var basedOnMap = { "characters": 1, "charactersExcludingSpaces": 2, "words": 3, "lines": 4 };
                if (basedOnMap[args.basedOn] !== undefined) {
                    // AE uses "ADBE Text Selector Based On" (not "Range") — inconsistent naming; scan by display name as fallback.
                    var basedOnProp = null;
                    try { basedOnProp = advanced.property("ADBE Text Selector Based On"); } catch(e) {}
                    if (!basedOnProp) { try { basedOnProp = advanced.property("ADBE Text Range Based On"); } catch(e) {} }
                    if (!basedOnProp) {
                        for (var bi = 1; bi <= advanced.numProperties; bi++) {
                            try { if (advanced.property(bi).name === "Based On") { basedOnProp = advanced.property(bi); break; } } catch(e) {}
                        }
                    }
                    if (basedOnProp) { basedOnProp.setValue(basedOnMap[args.basedOn]); changed.push("basedOn"); }
                }
            }
            if (args.shape !== undefined) {
                var shapeMap = { "square": 1, "rampUp": 2, "rampDown": 3, "triangle": 4, "round": 5, "smooth": 6 };
                if (shapeMap[args.shape] !== undefined) {
                    advanced.property("ADBE Text Range Shape").setValue(shapeMap[args.shape]);
                    changed.push("shape");
                }
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
