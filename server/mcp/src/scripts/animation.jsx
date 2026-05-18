// animation.jsx
// Keyframes  — CRUD: C ✓  R ✓  U ✓  D ✓
// Expressions — CRUD: C/U ✓  R ✓  D ✓ (via empty string)

// Shared helper: resolve a property by name across Transform, Effects (flat + nested), and Text
function resolveProperty(layer, propertyName) {
    var transformGroup = layer.property("Transform");
    var prop = transformGroup ? transformGroup.property(propertyName) : null;
    if (prop) return prop;

    if (layer.property("Effects")) {
        var effects = layer.property("Effects");
        // Direct child of Effects (e.g. effect name or matchName)
        prop = effects.property(propertyName);
        if (prop) return prop;
        // Nested: search sub-properties of each effect
        for (var ei = 1; ei <= effects.numProperties; ei++) {
            var eff = effects.property(ei);
            try {
                var sub = eff.property(propertyName);
                if (sub) return sub;
            } catch (e2) {}
        }
    }

    if (layer.property("Text")) {
        prop = layer.property("Text").property(propertyName);
        if (prop) return prop;
    }

    return null;
}

// R: getLayerExpressions
function getLayerExpressions(args) {
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

        var layerIndex = args.layerIndex;
        var layer = null;
        if (layerIndex !== undefined && layerIndex !== null) {
            if (layerIndex > 0 && layerIndex <= comp.numLayers) { layer = comp.layer(layerIndex); }
            else { throw new Error("Layer index out of bounds: " + layerIndex); }
        } else if (args.layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === args.layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found"); }

        var expressions = [];

        function scanGroup(group, path) {
            for (var i = 1; i <= group.numProperties; i++) {
                var prop = group.property(i);
                var propPath = path ? path + " > " + prop.name : prop.name;
                if (prop.numProperties !== undefined && prop.numProperties > 0) {
                    scanGroup(prop, propPath);
                } else if (prop.canSetExpression && prop.expressionEnabled && prop.expression !== "") {
                    expressions.push({ property: propPath, expression: prop.expression });
                }
            }
        }

        scanGroup(layer, "");

        return JSON.stringify({
            status: "success",
            layer: { name: layer.name, index: layer.index },
            expressions: expressions,
            count: expressions.length
        }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || "INTERNAL_ERROR", message: e.toString(), line: e.line });
    }
}

// R: getLayerKeyframes
function getLayerKeyframes(args) {
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

        var layerIndex = args.layerIndex;
        var layer = null;
        if (layerIndex !== undefined && layerIndex !== null) {
            if (layerIndex > 0 && layerIndex <= comp.numLayers) { layer = comp.layer(layerIndex); }
            else { throw new Error("Layer index out of bounds: " + layerIndex); }
        } else if (args.layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === args.layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found"); }

        var property = resolveProperty(layer, args.propertyName);
        if (!property) {
            throw new Error("Property '" + args.propertyName + "' not found on layer '" + layer.name + "'.");
        }

        var interpLabels = {};
        interpLabels[KeyframeInterpolationType.LINEAR] = "linear";
        interpLabels[KeyframeInterpolationType.BEZIER] = "bezier";
        interpLabels[KeyframeInterpolationType.HOLD]   = "hold";

        var keyframes = [];
        for (var k = 1; k <= property.numKeys; k++) {
            var inType  = property.keyInInterpolationType(k);
            var outType = property.keyOutInterpolationType(k);
            keyframes.push({
                keyIndex: k,
                time: property.keyTime(k),
                value: property.keyValue(k),
                inInterpolationType: inType,
                inInterpolationLabel: interpLabels[inType] || "unknown",
                outInterpolationType: outType,
                outInterpolationLabel: interpLabels[outType] || "unknown"
            });
        }

        return JSON.stringify({
            status: "success",
            layer: { name: layer.name, index: layer.index },
            property: args.propertyName,
            keyframes: keyframes,
            count: keyframes.length
        }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || "INTERNAL_ERROR", message: e.toString(), line: e.line });
    }
}

// C: setLayerKeyframe
function setLayerKeyframe(args) {
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

        var layerIndex = args.layerIndex;
        var layer = null;
        if (layerIndex !== undefined && layerIndex !== null) {
            if (layerIndex > 0 && layerIndex <= comp.numLayers) { layer = comp.layer(layerIndex); }
            else { throw new Error("Layer index out of bounds: " + layerIndex); }
        } else if (args.layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === args.layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found"); }

        var property = resolveProperty(layer, args.propertyName);
        if (!property) {
            throw new Error("Property '" + args.propertyName + "' not found on layer '" + layer.name + "'.");
        }
        if (!property.canVaryOverTime) {
            throw new Error("Property '" + args.propertyName + "' cannot be keyframed.");
        }

        var value = args.value;
        var timeInSeconds = args.timeInSeconds;

        // Value arrives as a string (e.g. "[0, 0]") due to z.unknown() in the MCP schema — parse it
        if (typeof value === "string") {
            try { value = eval("(" + value + ")"); } catch(e) { value = parseFloat(value); }
        }

        // Reconstruct as a literal array so AE always gets a native ExtendScript array type.
        var currentVal = property.value;
        var finalVal;
        if (typeof currentVal === "object" && typeof currentVal.length === "number" && currentVal.length >= 1) {
            finalVal = [];
            for (var vi = 0; vi < currentVal.length; vi++) {
                var inVal = +value[vi];
                finalVal[vi] = isNaN(inVal) ? +currentVal[vi] : inVal;
            }
        } else {
            finalVal = +value;
        }

        property.setValueAtTime(timeInSeconds, finalVal);

        return JSON.stringify({ status: "success", message: "Keyframe set for '" + args.propertyName + "' on layer '" + layer.name + "' at " + timeInSeconds + "s." });
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || "INTERNAL_ERROR", message: "Error setting keyframe: " + e.toString(), line: e.line });
    }
}

// C/U: setLayerExpression
function setLayerExpression(args) {
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

        var layerIndex = args.layerIndex;
        var layer = null;
        if (layerIndex !== undefined && layerIndex !== null) {
            if (layerIndex > 0 && layerIndex <= comp.numLayers) { layer = comp.layer(layerIndex); }
            else { throw new Error("Layer index out of bounds: " + layerIndex); }
        } else if (args.layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === args.layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found"); }

        var property = resolveProperty(layer, args.propertyName);
        if (!property) {
            throw new Error("Property '" + args.propertyName + "' not found on layer '" + layer.name + "'.");
        }
        if (!property.canSetExpression) {
            throw new Error("Property '" + args.propertyName + "' does not support expressions.");
        }

        property.expression = args.expressionString;

        var action = args.expressionString === "" ? "removed" : "set";
        return JSON.stringify({ status: "success", message: "Expression " + action + " for '" + args.propertyName + "' on layer '" + layer.name + "'." });
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || "INTERNAL_ERROR", message: "Error setting expression: " + e.toString(), line: e.line });
    }
}

// U: setKeyframeEasing
function setKeyframeEasing(args) {
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

        var layerIndex = args.layerIndex;
        var layer = null;
        if (layerIndex !== undefined && layerIndex !== null) {
            if (layerIndex > 0 && layerIndex <= comp.numLayers) { layer = comp.layer(layerIndex); }
            else { throw new Error("Layer index out of bounds: " + layerIndex); }
        } else if (args.layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === args.layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found"); }

        var property = resolveProperty(layer, args.propertyName);
        if (!property) {
            throw new Error("Property '" + args.propertyName + "' not found on layer '" + layer.name + "'.");
        }
        if (property.numKeys === 0) {
            throw new Error("No keyframes on property '" + args.propertyName + "'.");
        }

        // Resolve which keyframe(s) to target
        var indices = [];
        if (args.keyIndices) {
            indices = args.keyIndices;
        } else if (args.keyIndex !== undefined) {
            indices = [args.keyIndex];
        } else if (args.keyTime !== undefined) {
            for (var k = 1; k <= property.numKeys; k++) {
                if (Math.abs(property.keyTime(k) - args.keyTime) < 0.002) { indices = [k]; break; }
            }
        } else {
            for (var k = 1; k <= property.numKeys; k++) { indices.push(k); }
        }

        if (indices.length === 0) {
            throw new Error("No matching keyframe found.");
        }

        var easeType = args.easeType || "easyEase";
        // EASY_EASE doesn't exist as a constant — Easy Ease is BEZIER with speed=0, influence=33.33
        var typeMap = {
            "easyEase": [KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER],
            "easeIn":   [KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.LINEAR],
            "easeOut":  [KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.BEZIER],
            "linear":   [KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR],
            "hold":     [KeyframeInterpolationType.HOLD,   KeyframeInterpolationType.HOLD],
            "bezier":   [KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER]
        };
        var types = typeMap[easeType] || typeMap["easyEase"];

        var changed = [];
        for (var i = 0; i < indices.length; i++) {
            var ki = indices[i];
            if (ki < 1 || ki > property.numKeys) continue;

            property.setInterpolationTypeAtKey(ki, types[0], types[1]);

            var curIn  = property.keyInTemporalEase(ki);
            var curOut = property.keyOutTemporalEase(ki);
            var dim = curIn.length; // 1=scalar, 2=2D, 3=3D

            var applyDefaultEase = (easeType === "easyEase" || easeType === "easeIn" || easeType === "easeOut") &&
                                   args.inInfluence === undefined && args.outInfluence === undefined &&
                                   args.inSpeed === undefined && args.outSpeed === undefined;
            if (applyDefaultEase) {
                var defArr = [];
                for (var d = 0; d < dim; d++) { defArr.push(new KeyframeEase(0, 33.33)); }
                var easeInArr  = (easeType === "easeOut") ? curIn  : defArr;
                var easeOutArr = (easeType === "easeIn")  ? curOut : defArr;
                property.setTemporalEaseAtKey(ki, easeInArr, easeOutArr);
            } else if (args.inInfluence !== undefined || args.outInfluence !== undefined ||
                       args.inSpeed !== undefined || args.outSpeed !== undefined) {
                var newInArr = [], newOutArr = [];
                for (var d = 0; d < dim; d++) {
                    var inSpd  = (args.inSpeed      !== undefined) ? args.inSpeed      : curIn[d].speed;
                    var inInf  = (args.inInfluence  !== undefined) ? args.inInfluence  : curIn[d].influence;
                    var outSpd = (args.outSpeed     !== undefined) ? args.outSpeed     : curOut[d].speed;
                    var outInf = (args.outInfluence !== undefined) ? args.outInfluence : curOut[d].influence;
                    newInArr.push(new KeyframeEase(inSpd, inInf));
                    newOutArr.push(new KeyframeEase(outSpd, outInf));
                }
                property.setTemporalEaseAtKey(ki, newInArr, newOutArr);
            }
            changed.push(ki);
        }

        return JSON.stringify({
            status: "success",
            message: "Easing set on " + changed.length + " keyframe(s) for '" + args.propertyName + "'.",
            keyframesModified: changed,
            easeType: easeType
        });
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || "INTERNAL_ERROR", message: e.toString(), line: e.line });
    }
}

// R: getLayerProperty — read a property value at optional time via path array
function getLayerProperty(args) {
    try {
        var compName = args.compName || "";
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (!compName && app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "'"); }
        }

        var layerIndex = args.layerIndex;
        var layer = null;
        if (layerIndex !== undefined && layerIndex !== null) {
            if (layerIndex > 0 && layerIndex <= comp.numLayers) { layer = comp.layer(layerIndex); }
            else { throw new Error("Layer index out of bounds: " + layerIndex); }
        } else if (args.layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === args.layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found"); }

        var propertyPath = args.propertyPath;
        if (!propertyPath || typeof propertyPath.length === "undefined" || propertyPath.length === 0) {
            throw new Error("propertyPath must be a non-empty array.");
        }

        var property = _resolvePropertyByPath(layer, propertyPath);

        var propInfo = {
            name: property.name,
            path: propertyPath,
            value: property.value,
            numKeys: property.numKeys || 0,
            isTimeVarying: (property.numKeys || 0) > 0
        };

        if (args.timeInSeconds !== undefined) {
            propInfo.valueAtTime = property.valueAtTime(args.timeInSeconds, false);
            propInfo.timeInSeconds = args.timeInSeconds;
        }

        if (property.canSetExpression !== undefined) {
            propInfo.canSetExpression = property.canSetExpression;
            propInfo.hasExpression = property.canSetExpression && property.expressionEnabled;
            propInfo.expression = (property.canSetExpression && property.expressionEnabled) ? property.expression : "";
            if (propInfo.hasExpression) { propInfo.isTimeVarying = true; }
        }

        return JSON.stringify({ status: "success", property: propInfo }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || "INTERNAL_ERROR", message: e.toString(), line: e.line });
    }
}

// U: setLayerProperty — generic path-based setter (mirror of getLayerProperty)
function setLayerProperty(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var propertyPath = args.propertyPath;
        if (!propertyPath || typeof propertyPath.length === "undefined" || propertyPath.length === 0) {
            throw _err(ERROR_CODES.INVALID_ARGS, "propertyPath must be a non-empty array.");
        }

        var property = _resolvePropertyByPath(layer, propertyPath);

        if (property.numKeys !== undefined && property.numKeys > 0) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Property '" + property.name + "' has " + property.numKeys + " keyframe(s) — use setLayerKeyframe to target individual keyframes.");
        }

        if (!property.setValue) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Property '" + property.name + "' is a group or read-only and cannot be set directly.");
        }

        var value = args.value;
        if (typeof value === "string") { try { value = eval("(" + value + ")"); } catch(e) {} }

        // Reconstruct as a literal array so AE always gets a native ExtendScript array type (same
        // pattern as setLayerKeyframe:194).
        var currentVal = property.value;
        var finalVal;
        if (typeof currentVal === "object" && typeof currentVal.length === "number" && currentVal.length >= 1 && value instanceof Array) {
            finalVal = [];
            for (var vi = 0; vi < currentVal.length; vi++) {
                var inVal = +value[vi];
                finalVal[vi] = isNaN(inVal) ? +currentVal[vi] : inVal;
            }
        } else {
            finalVal = value;
        }

        property.setValue(finalVal);

        return JSON.stringify({
            status: "success",
            message: "Property '" + property.name + "' updated.",
            property: { path: propertyPath, name: property.name, value: property.value }
        }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || "INTERNAL_ERROR", message: e.toString(), line: e.line });
    }
}

// D: removePropertyKeyframes
function removePropertyKeyframes(args) {
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

        var layerIndex = args.layerIndex;
        var layer = null;
        if (layerIndex !== undefined && layerIndex !== null) {
            if (layerIndex > 0 && layerIndex <= comp.numLayers) { layer = comp.layer(layerIndex); }
            else { throw new Error("Layer index out of bounds: " + layerIndex); }
        } else if (args.layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === args.layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found"); }

        var property = resolveProperty(layer, args.propertyName);
        if (!property) {
            throw new Error("Property '" + args.propertyName + "' not found on layer '" + layer.name + "'.");
        }

        var removed = property.numKeys;
        while (property.numKeys > 0) { property.removeKey(1); }
        return JSON.stringify({ status: "success", message: "Removed " + removed + " keyframe(s) from '" + args.propertyName + "'.", removed: removed });
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || "INTERNAL_ERROR", message: e.toString(), line: e.line });
    }
}
