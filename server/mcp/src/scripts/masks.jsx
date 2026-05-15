// masks.jsx
// CRUD: C/U ✓  R ✓  D ✓

// R: getLayerMasks
function getLayerMasks(args) {
    try {
        var compName = args.compName || "";
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }

        var layer = null;
        if (args.layerIndex !== undefined && args.layerIndex !== null) {
            if (args.layerIndex > 0 && args.layerIndex <= comp.numLayers) { layer = comp.layer(args.layerIndex); }
            else { throw new Error("Layer index out of bounds: " + args.layerIndex); }
        } else if (args.layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === args.layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found: " + (args.layerName || "index " + args.layerIndex)); }

        var modeLabels = {};
        modeLabels[MaskMode.NONE]       = "none";
        modeLabels[MaskMode.ADD]        = "add";
        modeLabels[MaskMode.SUBTRACT]   = "subtract";
        modeLabels[MaskMode.INTERSECT]  = "intersect";
        modeLabels[MaskMode.LIGHTEN]    = "lighten";
        modeLabels[MaskMode.DARKEN]     = "darken";
        modeLabels[MaskMode.DIFFERENCE] = "difference";

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
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// C/U: setLayerMask
function setLayerMask(args) {
    try {
        var compName = args.compName || "";
        var layerIndex = args.layerIndex;
        var layerName = args.layerName || "";
        var maskIndex = args.maskIndex; // optional — if provided, modify existing mask
        var maskPath = args.maskPath; // array of [x, y] points defining the mask shape
        var maskRect = args.maskRect; // shorthand: {top, left, width, height} for rectangular masks
        var maskMode = args.maskMode || "add"; // "add", "subtract", "intersect", "none"
        var maskFeather = args.maskFeather; // optional [x, y] feather
        var maskOpacity = args.maskOpacity; // optional 0-100
        var maskExpansion = args.maskExpansion; // optional pixels
        var maskName = args.maskName; // optional rename

        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }

        var layer = null;
        if (layerIndex !== undefined && layerIndex !== null) {
            if (layerIndex > 0 && layerIndex <= comp.numLayers) { layer = comp.layer(layerIndex); }
            else { throw new Error("Layer index out of bounds: " + layerIndex); }
        } else if (layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found: " + (layerName || "index " + layerIndex)); }

        // Build the mask shape
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
            throw new Error("Must provide either maskRect or maskPath with at least 3 points");
        }

        var myShape = new Shape();
        var vertices = [];
        for (var p = 0; p < shapePoints.length; p++) {
            vertices.push(shapePoints[p]);
        }
        myShape.vertices = vertices;
        myShape.closed = true;

        var changed = [];
        var mask;

        if (maskIndex !== undefined && maskIndex !== null) {
            if (maskIndex > 0 && maskIndex <= layer.property("Masks").numProperties) {
                mask = layer.property("Masks").property(maskIndex);
            } else {
                throw new Error("Mask index out of bounds: " + maskIndex);
            }
            mask.property("Mask Path").setValue(myShape);
            changed.push("maskPath");
        } else {
            mask = layer.property("Masks").addProperty("Mask");
            mask.property("Mask Path").setValue(myShape);
            changed.push("newMask");
        }

        var modes = {
            "none": MaskMode.NONE,
            "add": MaskMode.ADD,
            "subtract": MaskMode.SUBTRACT,
            "intersect": MaskMode.INTERSECT,
            "lighten": MaskMode.LIGHTEN,
            "darken": MaskMode.DARKEN,
            "difference": MaskMode.DIFFERENCE
        };
        if (modes[maskMode] !== undefined) {
            mask.maskMode = modes[maskMode];
            changed.push("maskMode");
        }

        if (maskFeather !== undefined && maskFeather !== null) {
            mask.property("Mask Feather").setValue(maskFeather);
            changed.push("maskFeather");
        }
        if (maskOpacity !== undefined && maskOpacity !== null) {
            mask.property("Mask Opacity").setValue(maskOpacity);
            changed.push("maskOpacity");
        }
        if (maskExpansion !== undefined && maskExpansion !== null) {
            mask.property("Mask Expansion").setValue(maskExpansion);
            changed.push("maskExpansion");
        }
        if (maskName) {
            mask.name = maskName;
            changed.push("maskName");
        }

        return JSON.stringify({
            status: "success",
            message: "Mask set successfully",
            layer: { name: layer.name, index: layer.index },
            mask: {
                name: mask.name,
                index: mask.propertyIndex,
                mode: maskMode,
                changedProperties: changed
            }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// D: deleteLayerMask
function deleteLayerMask(args) {
    try {
        var compName = args.compName || "";
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }

        var layer = null;
        if (args.layerIndex !== undefined && args.layerIndex !== null) {
            if (args.layerIndex > 0 && args.layerIndex <= comp.numLayers) { layer = comp.layer(args.layerIndex); }
            else { throw new Error("Layer index out of bounds: " + args.layerIndex); }
        } else if (args.layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === args.layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found: " + (args.layerName || "index " + args.layerIndex)); }

        var masksGroup = layer.property("Masks");
        var mask = null;
        if (args.maskIndex !== undefined && args.maskIndex !== null) {
            if (args.maskIndex > 0 && args.maskIndex <= masksGroup.numProperties) {
                mask = masksGroup.property(args.maskIndex);
            } else {
                throw new Error("Mask index out of bounds: " + args.maskIndex);
            }
        } else if (args.maskName) {
            for (var m = 1; m <= masksGroup.numProperties; m++) {
                if (masksGroup.property(m).name === args.maskName) { mask = masksGroup.property(m); break; }
            }
        }
        if (!mask) { throw new Error("Mask not found: " + (args.maskName || "index " + args.maskIndex)); }

        var deletedName = mask.name;
        var deletedIndex = mask.propertyIndex;
        mask.remove();

        return JSON.stringify({
            status: "success",
            message: "Mask deleted successfully",
            layer: { name: layer.name, index: layer.index },
            deleted: { name: deletedName, index: deletedIndex }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}
