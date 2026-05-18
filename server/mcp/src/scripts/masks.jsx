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
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp = resolved.comp;
        var layer = resolved.layer;

        var maskIndex     = args.maskIndex;
        var maskPath      = args.maskPath;
        var maskRect      = args.maskRect;
        var maskMode      = args.maskMode || "add";
        var maskFeather   = args.maskFeather;
        var maskOpacity   = args.maskOpacity;
        var maskExpansion = args.maskExpansion;
        var maskName      = args.maskName;
        var closed        = (args.closed === false) ? false : true;

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

        var myShape = new Shape();
        var vertices = [];
        for (var p = 0; p < shapePoints.length; p++) { vertices.push(shapePoints[p]); }
        myShape.vertices = vertices;
        myShape.closed = closed;

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
            previousValues.maskPath     = { vertices: prevPath.vertices, closed: prevPath.closed };
            previousValues.maskMode     = getMaskModeLabels()[mask.maskMode] || mask.maskMode;
            previousValues.maskFeather  = mask.property("Mask Feather").value;
            previousValues.maskOpacity  = mask.property("Mask Opacity").value;
            previousValues.maskExpansion = mask.property("Mask Expansion").value;
            previousValues.maskName     = mask.name;

            mask.property("Mask Path").setValue(myShape);
            changed.push("maskPath");
        } else {
            mask = layer.property("Masks").addProperty("Mask");
            mask.property("Mask Path").setValue(myShape);
            changed.push("newMask");
        }

        var modes = {
            "none": MaskMode.NONE, "add": MaskMode.ADD, "subtract": MaskMode.SUBTRACT,
            "intersect": MaskMode.INTERSECT, "lighten": MaskMode.LIGHTEN,
            "darken": MaskMode.DARKEN, "difference": MaskMode.DIFFERENCE
        };
        if (modes[maskMode] !== undefined) { mask.maskMode = modes[maskMode]; changed.push("maskMode"); }
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

        var deletedName  = mask.name;
        var deletedIndex = mask.propertyIndex;
        mask.remove();

        return JSON.stringify({
            status: "success",
            message: "Mask deleted successfully",
            layer: { name: layer.name, index: layer.index },
            deleted: { name: deletedName, index: deletedIndex }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}
