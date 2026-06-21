// shapes.jsx
// Shape layers + vector operators (Trim Paths, Repeater, Rounded Corners, gradients).
// CRUD: C ✓  R via getLayerInfo/getLayerProperty  U ✓  D via deleteLayer
// convertToShape: triggers the native AE menu command; may be gated in CEP context (see handler).

// NOTE: ADBE Vector Grad Colors (gradient color stops on shape operators) is NOT scriptable
// in AE 2026. PropertyValueType.NO_VALUE blocks all approaches: setValue, setValueAtTime,
// GradientColor constructor — all throw from AE's C++ layer. No workaround exists within
// ExtendScript. For controllable gradient colors use applyEffect("ADBE Ramp") + setEffectProperty.

// U: convertToShape — convert a text or vector layer to a shape layer via AE's native menu command.
// RISK: app.executeCommand is documented as gated from CEP/evalScript for the Undo command;
// this handler detects a no-op result and returns a structured error so the agent can report it clearly.
function convertToShape(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp  = resolved.comp;
        var layer = resolved.layer;

        // Pick menu command based on layer type
        var isText = false;
        try { isText = (layer.property("Source Text") !== null); } catch(e) {}
        var menuName = isText ? "Create Shapes from Text" : "Create Shapes from Vector Layer";

        var menuId = null;
        try { menuId = app.findMenuCommandId(menuName); } catch(e) {}
        if (!menuId) {
            throw _err(ERROR_CODES.INVALID_ARGS,
                "Menu command '" + menuName + "' not found. Layer may not be a supported type (text or vector AV layer).");
        }

        // Deselect all, select target layer — menu commands operate on selection
        for (var di = 1; di <= comp.numLayers; di++) { try { comp.layer(di).selected = false; } catch(e) {} }
        layer.selected = true;

        var layersBefore = comp.numLayers;
        app.executeCommand(menuId);
        var layersAfter = comp.numLayers;

        if (layersAfter <= layersBefore) {
            return JSON.stringify({
                status: "error",
                errorCode: ERROR_CODES.INTERNAL_ERROR,
                message: "convertToShape: app.executeCommand('" + menuName + "') was a no-op — this command may be gated from the CEP/evalScript context. Workaround: select the layer in AE and run Layer > " + menuName + " manually."
            }, null, 2);
        }

        // Find the newly added shape layer (inserted above the original)
        var newLayer = null;
        for (var ni = 1; ni <= comp.numLayers; ni++) {
            var l = comp.layer(ni);
            var isSL = false;
            try { isSL = (l instanceof ShapeLayer); } catch(e) {}
            if (isSL && l.index < layer.index) { newLayer = l; break; }
        }

        return JSON.stringify({
            status: "success",
            message: "Layer converted to shape via '" + menuName + "'.",
            originalLayer: { index: layer.index, name: layer.name },
            shapeLayer: newLayer ? { index: newLayer.index, name: newLayer.name } : null,
            configurableProperties: newLayer ? _configurableChildren(newLayer, []) : undefined,
            menuCommand: menuName,
            menuId: menuId
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: createShapeLayer
function createShapeLayer(args) {
    var shapeLayer = null;  // tracked for atomic-create rollback (see catch)
    try {
        var comp = _resolveComp(args);
        var shapeType = args.shapeType || "rectangle";
        var position = args.position;
        var size = args.size || [200, 200];
        var fillColor = args.fillColor || [1, 0, 0];
        var strokeColor = args.strokeColor || [0, 0, 0];
        var strokeWidth = args.strokeWidth || 0;
        var roundness = args.roundness || 0;
        var startTime = args.startTime || 0;
        var duration = args.duration || 5;
        var name = args.name || "Shape Layer";
        var points = args.points || 5;

        if (!position) { position = [comp.width / 2, comp.height / 2]; }
        shapeLayer = comp.layers.addShape();
        shapeLayer.name = name;
        var contents = shapeLayer.property("Contents");
        var shapeGroup = contents.addProperty("ADBE Vector Group");
        var groupContents = shapeGroup.property("Contents");
        var shapePathProperty;
        if (shapeType === "rectangle") {
            shapePathProperty = groupContents.addProperty("ADBE Vector Shape - Rect");
            shapePathProperty.property("Size").setValue(size);
            if (roundness > 0) { shapePathProperty.property("Roundness").setValue(roundness); }
        } else if (shapeType === "ellipse") {
            shapePathProperty = groupContents.addProperty("ADBE Vector Shape - Ellipse");
            shapePathProperty.property("Size").setValue(size);
        } else if (shapeType === "polygon" || shapeType === "star") {
            shapePathProperty = groupContents.addProperty("ADBE Vector Shape - Star");
            shapePathProperty.property("Type").setValue(shapeType === "polygon" ? 1 : 2);
            shapePathProperty.property("Points").setValue(points);
            // Radius props can momentarily report "hidden" right after a Type change (AE doesn't
            // refresh visibility within the same script pass), so set them defensively — the shape
            // still gets a valid default radius rather than failing creation outright.
            try { shapePathProperty.property("Outer Radius").setValue(size[0] / 2); } catch (e) {}
            if (shapeType === "star") { try { shapePathProperty.property("Inner Radius").setValue(size[0] / 3); } catch (e) {} }
        }
        var fill = groupContents.addProperty("ADBE Vector Graphic - Fill");
        fill.property("Color").setValue(fillColor);
        fill.property("Opacity").setValue(100);
        if (strokeWidth > 0) {
            var stroke = groupContents.addProperty("ADBE Vector Graphic - Stroke");
            stroke.property("Color").setValue(strokeColor);
            stroke.property("Stroke Width").setValue(strokeWidth);
            stroke.property("Opacity").setValue(100);
        }
        shapeLayer.property("Position").setValue(position);
        shapeLayer.startTime = startTime;
        if (duration > 0) { shapeLayer.outPoint = startTime + duration; }
        return JSON.stringify({
            status: "success", message: "Shape layer created successfully",
            layer: { name: shapeLayer.name, index: shapeLayer.index, type: "shape", shapeType: shapeType, inPoint: shapeLayer.inPoint, outPoint: shapeLayer.outPoint, position: shapeLayer.property("Position").value },
            configurableProperties: _configurableChildren(shapeLayer, [])
        }, null, 2);
    } catch (error) {
        // Roll back the partially-created layer so a failed create leaves no orphan.
        if (shapeLayer !== null) { try { shapeLayer.remove(); } catch (e2) {} }
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: addShapeOperator — add Trim Paths / Repeater / Rounded Corners / gradient to a shape layer's Contents
function addShapeOperator(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var type = args.type;
        var matchNames = {
            "trimPaths":      "ADBE Vector Filter - Trim",
            "repeater":       "ADBE Vector Filter - Repeater",
            "roundedCorners": "ADBE Vector Filter - RC",
            "gradientFill":   "ADBE Vector Graphic - G-Fill",
            "gradientStroke": "ADBE Vector Graphic - G-Stroke"
        };

        if (!matchNames[type]) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Invalid operator type '" + type + "'. Use: trimPaths, repeater, roundedCorners, gradientFill, gradientStroke.");
        }

        var groupContents = _resolveShapeGroupContents(layer, args.groupPath);

        var operator = groupContents.addProperty(matchNames[type]);

        var settings = args.settings;
        if (settings) {
            for (var propName in settings) {
                if (settings.hasOwnProperty(propName)) {
                    try {
                        var prop = null;
                        try { prop = operator.property(propName); } catch(e) {}
                        if (!prop) {
                            for (var pi = 1; pi <= operator.numProperties; pi++) {
                                if (operator.property(pi).name === propName) { prop = operator.property(pi); break; }
                            }
                        }
                        if (prop) {
                            var v = settings[propName];
                            if (typeof v === "string") { try { v = eval("(" + v + ")"); } catch(e) {} }
                            prop.setValue(v);
                        }
                    } catch(e2) {}
                }
            }
        }

        // Gradient color stops (args.colors) are not scriptable in AE 2026 — see file header NOTE.

        var opProps = [];
        for (var oi = 1; oi <= operator.numProperties; oi++) {
            try { opProps.push({ name: operator.property(oi).name, value: operator.property(oi).value }); } catch(e3) {}
        }

        // Round-trippable display-name path to the operator, so its child paths resolve via the
        // implicit-Contents fallback in _resolvePropertyByPath.
        var opPathPrefix;
        if (args.groupPath && args.groupPath.length > 0) {
            opPathPrefix = args.groupPath.concat([operator.name]);
        } else {
            var firstGroup0 = layer.property("Contents").property(1);
            opPathPrefix = ["Contents", firstGroup0.name, operator.name];
        }

        return JSON.stringify({
            status: "success",
            message: "Shape operator '" + type + "' added to layer '" + layer.name + "'.",
            operator: { type: type, name: operator.name, matchName: matchNames[type], properties: opProps },
            configurableProperties: _configurableChildren(operator, opPathPrefix)
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: setShapeOperatorProperty — update a property on an existing shape operator
function setShapeOperatorProperty(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var operatorPath = args.operatorPath;
        var propertyName = args.propertyName;
        var value = args.value;

        if (!operatorPath || operatorPath.length === 0) { throw _err(ERROR_CODES.INVALID_ARGS, "operatorPath must be a non-empty array."); }
        if (!propertyName) { throw _err(ERROR_CODES.INVALID_ARGS, "propertyName is required."); }

        var operator = _resolvePropertyByPath(layer, operatorPath);

        var prop = null;
        try { prop = operator.property(propertyName); } catch(e) {}
        if (!prop) {
            for (var pi = 1; pi <= operator.numProperties; pi++) {
                if (operator.property(pi).name === propertyName) { prop = operator.property(pi); break; }
            }
        }
        if (!prop) { throw _err(ERROR_CODES.PROPERTY_NOT_FOUND, "Property '" + propertyName + "' not found on operator."); }

        if (typeof value === "string") { try { value = eval("(" + value + ")"); } catch(e) {} }

        // No-op: requested value already matches the current value — nothing to mutate.
        if (_valuesEqual(value, prop.value)) {
            return JSON.stringify({ status: "noop", message: "This shape property is already set to that value." }, null, 2);
        }

        var previousValue = null;
        try { previousValue = prop.value; } catch(e) {}
        prop.setValue(value);

        return JSON.stringify({
            status: "success",
            message: "Shape operator property '" + propertyName + "' set.",
            operator: { path: operatorPath },
            property: { name: prop.name, value: prop.value },
            previousValue: previousValue
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// Shared: resolve the Contents group a shape operator/group lives in. With groupPath, walks to that
// group and returns its Contents (or the group itself); otherwise returns the first group's Contents.
// Used by addShapeOperator and animateShape so both target shape groups identically.
function _resolveShapeGroupContents(layer, groupPath) {
    if (groupPath && groupPath.length > 0) {
        var targetGroup = _resolvePropertyByPath(layer, groupPath);
        var inner = targetGroup.property("Contents");
        return inner || targetGroup;
    }
    var contents = layer.property("Contents");
    if (!contents) { throw _err(ERROR_CODES.PROPERTY_NOT_FOUND, "Layer has no Contents group — is it a shape layer?"); }
    var firstGroup = contents.property(1);
    if (!firstGroup) { throw _err(ERROR_CODES.PROPERTY_NOT_FOUND, "Contents group is empty."); }
    var firstContents = firstGroup.property("Contents");
    return firstContents || firstGroup;
}

// Count the top-level vector groups in a shape layer's Contents — every access guarded so a malformed
// or merged layer (groups that share a name) can't throw mid-scan.
function _countShapeGroups(contents) {
    var n = 0;
    for (var i = 1; i <= contents.numProperties; i++) {
        try { if (contents.property(i).matchName === "ADBE Vector Group") { n++; } } catch (e) {}
    }
    return n;
}

// C/U: animateShape — write-on / draw-on reveal via Trim Paths. Finds or adds a Trim Paths operator on
// the shape group, then keyframes Start/End over `duration` so the stroke draws on. This is the shape
// analog of animateText: one call instead of hand-keyframing trim properties.
function animateShape(args) {
    var addedTrim = null;  // tracked for atomic-create rollback when we add the Trim operator
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp  = resolved.comp;
        var layer = resolved.layer;

        var trimProperty = args.trimProperty ? String(args.trimProperty) : "end"; // start|end
        var startValue   = args.startValue !== undefined ? +args.startValue : 0;
        var endValue     = args.endValue   !== undefined ? +args.endValue   : 100;
        var startTime    = args.startTime  !== undefined ? +args.startTime  : 0;
        var duration     = args.duration   !== undefined ? +args.duration   : 1.0;
        var ease         = args.ease ? String(args.ease) : "easeOut";
        var overwrite    = args.overwriteKeyframes === true;

        if (duration <= 0) { throw _err(ERROR_CODES.INVALID_ARGS, "duration must be > 0."); }
        if (startTime + duration > comp.duration + 0.001) {
            throw _err(ERROR_CODES.TIME_OUT_OF_RANGE, "Reveal extends to " + (startTime + duration).toFixed(3) + "s, exceeding comp duration " + comp.duration.toFixed(3) + "s.");
        }
        if (trimProperty !== "start" && trimProperty !== "end") {
            throw _err(ERROR_CODES.INVALID_ARGS, "trimProperty must be 'start' or 'end'.");
        }

        var groupContents = _resolveShapeGroupContents(layer, args.groupPath);

        // Find an existing Trim Paths operator in this group; otherwise add one (atomic-create).
        var trim = null;
        for (var i = 1; i <= groupContents.numProperties; i++) {
            try { if (groupContents.property(i).matchName === "ADBE Vector Filter - Trim") { trim = groupContents.property(i); break; } } catch (e) {}
        }
        if (!trim) { trim = groupContents.addProperty("ADBE Vector Filter - Trim"); addedTrim = trim; }

        // Static Offset (rotates where the trim begins) if requested.
        if (args.offset !== undefined && args.offset !== null) {
            try { trim.property("Offset").setValue(+args.offset); } catch (e) {}
        }

        var animated = (trimProperty === "start") ? "Start" : "End";
        var prop = trim.property(animated);
        if (overwrite) { while (prop.numKeys > 0) { prop.removeKey(1); } }
        var prevValue = null; try { prevValue = prop.value; } catch (e) {}
        _recipeSetKey(prop, startTime, startValue, ease);
        _recipeSetKey(prop, startTime + duration, endValue, ease);

        // Round-trippable display-name path to the Trim operator, so Start/End/Offset resolve.
        var trimPrefix;
        if (args.groupPath && args.groupPath.length > 0) {
            trimPrefix = args.groupPath.concat([trim.name]);
        } else {
            var fg0 = layer.property("Contents").property(1);
            trimPrefix = ["Contents", fg0.name, trim.name];
        }

        return JSON.stringify({
            status: "success",
            message: "Drew on '" + layer.name + "' — Trim " + animated + " " + startValue + " to " + endValue + " over " + duration + "s.",
            layer: { name: layer.name, index: layer.index },
            trim: { animated: animated, addedTrim: (addedTrim !== null), keyframes: 2 },
            configurableProperties: _configurableChildren(trim, trimPrefix),
            previousValues: { value: prevValue, trimAdded: (addedTrim !== null) }
        }, null, 2);
    } catch (error) {
        if (addedTrim !== null) { try { addedTrim.remove(); } catch (e2) {} }
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: extractShapes — explode a shape layer's top-level groups onto separate shape layers (the shape
// analog of explodeTextLayer). Each duplicate keeps exactly one group; the source is hidden (or
// removed when deleteSource). Lets the user animate each shape independently.
function extractShapes(args) {
    var createdLayers = [];  // tracked for atomic-create rollback
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp = resolved.comp;
        var layer = resolved.layer;

        var contents = layer.property("Contents");
        if (!contents) { throw _err(ERROR_CODES.INVALID_ARGS, "Layer '" + layer.name + "' has no Contents — is it a shape layer?"); }

        // Count the top-level vector groups (every access guarded — a merged layer can hold groups that
        // share a name, so we select by ORDINAL position below, never by name).
        var groupCount = _countShapeGroups(contents);
        if (groupCount < 2) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Layer has " + groupCount + " shape group(s) — need at least 2 to extract.");
        }

        var deleteSource = args.deleteSource === true;
        var prevEnabled = layer.enabled;
        var srcName = layer.name;
        // duplicate() rebuilds the comp's layer collection and INVALIDATES this cached `layer` ref, so
        // capture a stable id now and re-resolve the source fresh before touching it after the loop.
        var srcId = null; try { srcId = layer.id; } catch (e) {}
        var out = [];

        // For each group ordinal, duplicate the layer and delete every OTHER top-level group on the dup.
        for (var g = 0; g < groupCount; g++) {
            var dup = layer.duplicate();
            createdLayers.push(dup);
            var dupContents = dup.property("Contents");
            var dupGroupIdx = [];
            for (var f = 1; f <= dupContents.numProperties; f++) {
                var isG = false; try { isG = (dupContents.property(f).matchName === "ADBE Vector Group"); } catch (e) {}
                if (isG) { dupGroupIdx.push(f); }
            }
            var keepChild = dupGroupIdx[g];
            var keepName = "Shape " + (g + 1);
            try { keepName = dupContents.property(keepChild).name; } catch (e) {}
            for (var r = dupGroupIdx.length - 1; r >= 0; r--) {
                if (dupGroupIdx[r] !== keepChild) { try { dupContents.property(dupGroupIdx[r]).remove(); } catch (e2) {} }
            }
            try { dup.name = srcName + " [" + keepName + "]"; } catch (e) {}
            out.push({ index: dup.index, name: dup.name, group: keepName });
        }

        // Re-resolve the source by its stable id (the cached `layer` ref is now stale post-duplicate),
        // then hide/remove it. Non-fatal: the extracted layers are the deliverable, so a failed cleanup
        // never fails the whole call.
        var src = null;
        if (srcId !== null) {
            for (var li = 1; li <= comp.numLayers; li++) { try { if (comp.layer(li).id === srcId) { src = comp.layer(li); break; } } catch (e) {} }
        }
        var sourceHandled = true;
        if (src) {
            if (deleteSource) { try { src.remove(); } catch (e) { try { src.enabled = false; } catch (e2) { sourceHandled = false; } } }
            else { try { src.enabled = false; } catch (e) { sourceHandled = false; } }
        } else { sourceHandled = false; }

        var resultObj = {
            status: "success",
            message: "Extracted " + out.length + " shape group(s) from '" + srcName + "'.",
            createdLayers: out,
            previousValues: { sourceEnabled: prevEnabled, sourceDeleted: deleteSource }
        };
        if (!sourceHandled) { resultObj.warning = "Extracted layers created, but couldn't hide/remove the source — remove it manually."; }
        return JSON.stringify(resultObj, null, 2);
    } catch (error) {
        for (var rb = createdLayers.length - 1; rb >= 0; rb--) { try { createdLayers[rb].remove(); } catch (e2) {} }
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// Recursively clone a vector property (group or leaf) from src into destParent by matchName, copying
// values. Handles the standard shape tree (groups, shapes, fills, strokes, operators). Anything that
// can't be re-added or set is skipped and counted as a warning — never throws.
function _cloneVectorProperty(src, destParent, warn) {
    var added = null;
    try { added = destParent.addProperty(src.matchName); } catch (e) { warn.push(src.name); return; }
    try { if (added.name !== src.name && added.canSetName !== false) { added.name = src.name; } } catch (e) {}
    if (src.numProperties && src.numProperties > 0) {
        // A group/container: AE auto-creates default children on addProperty, so recurse by clearing
        // auto-children we'll re-add only for the "Contents" group; for leaf-bearing operators, copy
        // child VALUES by matchName instead of re-adding (those children are fixed).
        if (src.matchName === "ADBE Vector Group" || src.name === "Contents") {
            var destContents = added.property("Contents") || added;
            var srcContents  = src.property("Contents") || src;
            for (var i = 1; i <= srcContents.numProperties; i++) {
                _cloneVectorProperty(srcContents.property(i), destContents, warn);
            }
        } else {
            for (var j = 1; j <= src.numProperties; j++) {
                var sc = src.property(j);
                var dc = null;
                try { dc = added.property(sc.matchName); } catch (e) {}
                if (dc && dc.setValue) { try { dc.setValue(sc.value); } catch (e) { warn.push(sc.name); } }
            }
        }
    } else if (added.setValue) {
        try { added.setValue(src.value); } catch (e) { warn.push(src.name); }
    }
}

// C: mergeShapes — combine several shape layers' groups into the first layer, then remove the others.
// Best-effort deep clone of each vector group (see _cloneVectorProperty); reports any sub-property it
// couldn't copy via a warning rather than failing the whole merge.
function mergeShapes(args) {
    try {
        var comp = _resolveComp(args);
        var layerIndices = args.layerIndices;
        if (!layerIndices || typeof layerIndices.length === "undefined" || layerIndices.length < 2) {
            throw _err(ERROR_CODES.INVALID_ARGS, "layerIndices must list at least 2 shape layers to merge.");
        }
        // Resolve target (first) + sources, validating they're shape layers, before mutating anything.
        var target = comp.layer(layerIndices[0]);
        var targetContents = target.property("Contents");
        if (!targetContents) { throw _err(ERROR_CODES.INVALID_ARGS, "Target layer is not a shape layer."); }

        var warn = [];
        var mergedFrom = [];
        // Clone each source's top-level groups onto the target (high→low source order keeps stacking).
        for (var s = 1; s < layerIndices.length; s++) {
            var src = comp.layer(layerIndices[s]);
            var srcContents = src.property("Contents");
            if (!srcContents) { warn.push(src.name + " (not a shape layer)"); continue; }
            for (var i = 1; i <= srcContents.numProperties; i++) {
                var grp = srcContents.property(i);
                var isGroup = false;
                try { isGroup = (grp.matchName === "ADBE Vector Group"); } catch (e) {}
                if (isGroup) { _cloneVectorProperty(grp, targetContents, warn); }
            }
            mergedFrom.push({ index: src.index, name: src.name });
        }
        // Remove the merged-away layers (resolve by name AFTER cloning so indices don't shift mid-clone).
        for (var m = 0; m < mergedFrom.length; m++) {
            for (var li = 1; li <= comp.numLayers; li++) {
                if (comp.layer(li).name === mergedFrom[m].name && comp.layer(li) !== target) { comp.layer(li).remove(); break; }
            }
        }

        var resultObj = {
            status: "success",
            message: "Merged " + mergedFrom.length + " shape layer(s) into '" + target.name + "'.",
            target: { name: target.name, index: target.index },
            mergedFrom: mergedFrom
        };
        if (warn.length > 0) { resultObj.warning = "Some sub-properties couldn't be copied: " + warn.join(", ") + "."; }
        return JSON.stringify(resultObj, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}
