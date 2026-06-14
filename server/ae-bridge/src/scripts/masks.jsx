// masks.jsx
// CRUD: C/U ✓  R ✓  D ✓

// ── Shared helpers ────────────────────────────────────────────────────────────

var MASK_MODE_LABELS = null;
function getMaskModeLabels() {
    if (!MASK_MODE_LABELS) {
        MASK_MODE_LABELS = {};
        MASK_MODE_LABELS[MaskMode.NONE]       = "none";
        MASK_MODE_LABELS[MaskMode.ADD]        = "add";
        MASK_MODE_LABELS[MaskMode.SUBTRACT]   = "subtract";
        MASK_MODE_LABELS[MaskMode.INTERSECT]  = "intersect";
        MASK_MODE_LABELS[MaskMode.LIGHTEN]    = "lighten";
        MASK_MODE_LABELS[MaskMode.DARKEN]     = "darken";
        MASK_MODE_LABELS[MaskMode.DIFFERENCE] = "difference";
    }
    return MASK_MODE_LABELS;
}

// ── R: getLayerMasks ──────────────────────────────────────────────────────────

function getLayerMasks(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;
        var modeLabels = getMaskModeLabels();

        var masksGroup = layer.property("Masks");
        var masks = [];
        for (var m = 1; m <= masksGroup.numProperties; m++) {
            var mask = masksGroup.property(m);
            var path = mask.property("Mask Path").value;
            masks.push({
                index: m,
                name: mask.name,
                mode: modeLabels[mask.maskMode] || mask.maskMode,
                vertices: path.vertices,
                closed: path.closed,
                inTangents: path.inTangents,
                outTangents: path.outTangents,
                feather: mask.property("Mask Feather").value,
                opacity: mask.property("Mask Opacity").value,
                expansion: mask.property("Mask Expansion").value
            });
        }

        return JSON.stringify({
            status: "success",
            layer: { name: layer.name, index: layer.index },
            masks: masks,
            count: masks.length
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// ── C/U: setLayerMask ─────────────────────────────────────────────────────────

function setLayerMask(args) {
    // Only set when THIS call creates a new mask (not the update branch), so the catch rolls back
    // just our own partial creation and never deletes a pre-existing mask we were only editing.
    var createdMask = null;
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp = resolved.comp;
        var layer = resolved.layer;

        var maskIndex     = args.maskIndex;
        var maskPath      = args.maskPath;
        var maskRect      = args.maskRect;
        var maskMode      = args.maskMode || "add";
        // Validate-first: reject an invalid maskMode before any mutation (the path setValue below).
        var MASK_MODES = {
            "none": MaskMode.NONE, "add": MaskMode.ADD, "subtract": MaskMode.SUBTRACT,
            "intersect": MaskMode.INTERSECT, "lighten": MaskMode.LIGHTEN,
            "darken": MaskMode.DARKEN, "difference": MaskMode.DIFFERENCE
        };
        var maskModeVal = _requireEnum(maskMode, MASK_MODES, "maskMode");
        var maskFeather   = args.maskFeather;
        var maskOpacity   = args.maskOpacity;
        var maskExpansion = args.maskExpansion;
        var maskName      = args.maskName;
        var closed        = (args.closed === false) ? false : true;
        var maskInTangents  = args.maskInTangents;
        var maskOutTangents = args.maskOutTangents;
        if (typeof maskInTangents  === "string") { try { maskInTangents  = eval("(" + maskInTangents  + ")"); } catch(e) { maskInTangents  = null; } }
        if (typeof maskOutTangents === "string") { try { maskOutTangents = eval("(" + maskOutTangents + ")"); } catch(e) { maskOutTangents = null; } }

        var shapePoints = [];
        if (maskRect) {
            var t = maskRect.top || 0;
            var l = maskRect.left || 0;
            var w = maskRect.width || comp.width;
            var h = maskRect.height || comp.height;
            shapePoints = [[l, t], [l + w, t], [l + w, t + h], [l, t + h]];
        } else if (maskPath && maskPath.length >= 3) {
            shapePoints = maskPath;
        } else {
            throw _err(ERROR_CODES.INVALID_ARGS, "Must provide either maskRect or maskPath with at least 3 points");
        }

        if (maskInTangents !== null && maskInTangents !== undefined &&
            maskInTangents.length !== shapePoints.length) {
            throw _err(ERROR_CODES.INVALID_ARGS,
                "maskInTangents length (" + maskInTangents.length + ") must match vertex count (" + shapePoints.length + ")");
        }
        if (maskOutTangents !== null && maskOutTangents !== undefined &&
            maskOutTangents.length !== shapePoints.length) {
            throw _err(ERROR_CODES.INVALID_ARGS,
                "maskOutTangents length (" + maskOutTangents.length + ") must match vertex count (" + shapePoints.length + ")");
        }

        var myShape = new Shape();
        var vertices = [];
        for (var p = 0; p < shapePoints.length; p++) { vertices.push(shapePoints[p]); }
        myShape.vertices = vertices;
        myShape.closed = closed;
        if (maskInTangents  !== null && maskInTangents  !== undefined) { myShape.inTangents  = maskInTangents; }
        if (maskOutTangents !== null && maskOutTangents !== undefined) { myShape.outTangents = maskOutTangents; }

        var changed = [];
        var mask;
        var previousValues = {};

        if (maskIndex !== undefined && maskIndex !== null) {
            if (maskIndex > 0 && maskIndex <= layer.property("Masks").numProperties) {
                mask = layer.property("Masks").property(maskIndex);
            } else {
                throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Mask index out of bounds: " + maskIndex);
            }
            // Capture prior state before mutation
            var prevPath = mask.property("Mask Path").value;
            previousValues.maskPath     = { vertices: prevPath.vertices, closed: prevPath.closed, inTangents: prevPath.inTangents, outTangents: prevPath.outTangents };
            previousValues.maskMode     = getMaskModeLabels()[mask.maskMode] || mask.maskMode;
            previousValues.maskFeather  = mask.property("Mask Feather").value;
            previousValues.maskOpacity  = mask.property("Mask Opacity").value;
            previousValues.maskExpansion = mask.property("Mask Expansion").value;
            previousValues.maskName     = mask.name;

            mask.property("Mask Path").setValue(myShape);
            changed.push("maskPath");
        } else {
            mask = layer.property("Masks").addProperty("Mask");
            createdMask = mask;  // newly created — eligible for rollback on a later failure
            mask.property("Mask Path").setValue(myShape);
            changed.push("newMask");
        }

        mask.maskMode = maskModeVal; changed.push("maskMode");
        if (maskFeather   !== undefined && maskFeather   !== null) { mask.property("Mask Feather").setValue(maskFeather);     changed.push("maskFeather"); }
        if (maskOpacity   !== undefined && maskOpacity   !== null) { mask.property("Mask Opacity").setValue(maskOpacity);     changed.push("maskOpacity"); }
        if (maskExpansion !== undefined && maskExpansion !== null) { mask.property("Mask Expansion").setValue(maskExpansion); changed.push("maskExpansion"); }
        if (maskName) { mask.name = maskName; changed.push("maskName"); }

        return JSON.stringify({
            status: "success",
            message: "Mask set successfully",
            layer: { name: layer.name, index: layer.index },
            mask: { name: mask.name, index: mask.propertyIndex, mode: maskMode, changedProperties: changed },
            previousValues: previousValues
        }, null, 2);
    } catch (error) {
        // Roll back only a mask THIS call created (never one we were editing) so a failed create
        // leaves no orphan.
        if (createdMask !== null) { try { createdMask.remove(); } catch (e2) {} }
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// ── D: deleteLayerMask ────────────────────────────────────────────────────────

function deleteLayerMask(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var masksGroup = layer.property("Masks");
        var mask = null;
        if (args.maskIndex !== undefined && args.maskIndex !== null) {
            if (args.maskIndex > 0 && args.maskIndex <= masksGroup.numProperties) {
                mask = masksGroup.property(args.maskIndex);
            } else {
                throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Mask index out of bounds: " + args.maskIndex);
            }
        } else if (args.maskName) {
            for (var m = 1; m <= masksGroup.numProperties; m++) {
                if (masksGroup.property(m).name === args.maskName) { mask = masksGroup.property(m); break; }
            }
        }
        if (!mask) { throw _err(ERROR_CODES.LAYER_NOT_FOUND, "Mask not found: " + (args.maskName || "index " + args.maskIndex)); }

        // Capture full mask state for revert before remove
        var delPath = mask.property("Mask Path").value;
        var modeLabels2 = getMaskModeLabels();
        var removedMask = {
            name:        mask.name,
            index:       mask.propertyIndex,
            mode:        modeLabels2[mask.maskMode] || mask.maskMode,
            vertices:    delPath.vertices,
            closed:      delPath.closed,
            inTangents:  delPath.inTangents,
            outTangents: delPath.outTangents,
            feather:     mask.property("Mask Feather").value,
            opacity:     mask.property("Mask Opacity").value,
            expansion:   mask.property("Mask Expansion").value
        };
        mask.remove();

        return JSON.stringify({
            status: "success",
            message: "Mask deleted successfully",
            layer: { name: layer.name, index: layer.index },
            deleted: { name: removedMask.name, index: removedMask.index },
            removedMask: removedMask
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}
