// keyframes.jsx
// Keyframes  — CRUD: C ✓  R ✗ missing  U ✓  D ✓
// Expressions — CRUD: C/U ✓  R ✓  D ✓ (via empty string)

// R: getLayerExpressions
function getLayerExpressions(args) {
    try {
        var comp = app.project.items[args.compIndex];
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ success: false, message: "Composition not found at index " + args.compIndex });
        }
        var layer = comp.layers[args.layerIndex];
        if (!layer) {
            return JSON.stringify({ success: false, message: "Layer not found at index " + args.layerIndex });
        }

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
            success: true,
            layer: { name: layer.name, index: layer.index },
            expressions: expressions,
            count: expressions.length
        }, null, 2);
    } catch (e) {
        return JSON.stringify({ success: false, message: e.toString() });
    }
}

// R: getLayerKeyframes — MISSING
// TODO: Return all keyframes for a given property on a layer.
//       Args: compIndex, layerIndex, propertyName.
//       For each keyframe return: keyIndex (1-based), time (seconds), value, interpolationType (in/out).
//       Use property.numKeys, property.keyTime(k), property.keyValue(k),
//       property.keyInInterpolationType(k), property.keyOutInterpolationType(k).

// C: setLayerKeyframe
function setLayerKeyframe(compIndex, layerIndex, propertyName, timeInSeconds, value) {
    try {
        var comp = app.project.items[compIndex];
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ success: false, message: "Composition not found at index " + compIndex });
        }
        var layer = comp.layers[layerIndex];
        if (!layer) {
            return JSON.stringify({ success: false, message: "Layer not found at index " + layerIndex + " in composition '" + comp.name + "'"});
        }

        var transformGroup = layer.property("Transform");
        if (!transformGroup) {
             return JSON.stringify({ success: false, message: "Transform properties not found for layer '" + layer.name + "' (type: " + layer.matchName + ")." });
        }

        var property = transformGroup.property(propertyName);
        if (!property) {
             if (layer.property("Effects") && layer.property("Effects").property(propertyName)) {
                 property = layer.property("Effects").property(propertyName);
             } else if (layer.property("Text") && layer.property("Text").property(propertyName)) {
                 property = layer.property("Text").property(propertyName);
            }

            if (!property) {
                 return JSON.stringify({ success: false, message: "Property '" + propertyName + "' not found on layer '" + layer.name + "'." });
            }
        }

        if (!property.canVaryOverTime) {
             return JSON.stringify({ success: false, message: "Property '" + propertyName + "' cannot be keyframed." });
        }

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

        return JSON.stringify({ success: true, message: "Keyframe set for '" + propertyName + "' on layer '" + layer.name + "' at " + timeInSeconds + "s." });
    } catch (e) {
        return JSON.stringify({ success: false, message: "Error setting keyframe: " + e.toString() + " (Line: " + e.line + ")" });
    }
}

// C/U: setLayerExpression
function setLayerExpression(compIndex, layerIndex, propertyName, expressionString) {
    try {
        var comp = app.project.items[compIndex];
         if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ success: false, message: "Composition not found at index " + compIndex });
        }
        var layer = comp.layers[layerIndex];
         if (!layer) {
            return JSON.stringify({ success: false, message: "Layer not found at index " + layerIndex + " in composition '" + comp.name + "'"});
        }

        var transformGroup = layer.property("Transform");

        var property = transformGroup ? transformGroup.property(propertyName) : null;
         if (!property) {
             if (layer.property("Effects") && layer.property("Effects").property(propertyName)) {
                 property = layer.property("Effects").property(propertyName);
             } else if (layer.property("Text") && layer.property("Text").property(propertyName)) {
                 property = layer.property("Text").property(propertyName);
             }

            if (!property && layer.property("Effects")) {
                var effects = layer.property("Effects");
                for (var ei = 1; ei <= effects.numProperties; ei++) {
                    var eff = effects.property(ei);
                    try {
                        var subProp = eff.property(propertyName);
                        if (subProp) { property = subProp; break; }
                    } catch (e2) {}
                }
            }

            if (!property) {
                 return JSON.stringify({ success: false, message: "Property '" + propertyName + "' not found on layer '" + layer.name + "'." });
            }
        }

        if (!property.canSetExpression) {
            return JSON.stringify({ success: false, message: "Property '" + propertyName + "' does not support expressions." });
        }

        property.expression = expressionString;

        var action = expressionString === "" ? "removed" : "set";
        return JSON.stringify({ success: true, message: "Expression " + action + " for '" + propertyName + "' on layer '" + layer.name + "'." });
    } catch (e) {
        return JSON.stringify({ success: false, message: "Error setting expression: " + e.toString() + " (Line: " + e.line + ")" });
    }
}

// U: setKeyframeEasing
function setKeyframeEasing(args) {
    try {
        var comp = app.project.items[args.compIndex];
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ success: false, message: "Composition not found at index " + args.compIndex });
        }
        var layer = comp.layers[args.layerIndex];
        if (!layer) {
            return JSON.stringify({ success: false, message: "Layer not found at index " + args.layerIndex });
        }

        var transformGroup = layer.property("Transform");
        var property = transformGroup ? transformGroup.property(args.propertyName) : null;
        if (!property) {
            return JSON.stringify({ success: false, message: "Property '" + args.propertyName + "' not found on layer." });
        }
        if (property.numKeys === 0) {
            return JSON.stringify({ success: false, message: "No keyframes on property '" + args.propertyName + "'." });
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
            return JSON.stringify({ success: false, message: "No matching keyframe found." });
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
                    var inSpd = (args.inSpeed      !== undefined) ? args.inSpeed      : curIn[d].speed;
                    var inInf = (args.inInfluence  !== undefined) ? args.inInfluence  : curIn[d].influence;
                    var outSpd = (args.outSpeed    !== undefined) ? args.outSpeed     : curOut[d].speed;
                    var outInf = (args.outInfluence !== undefined) ? args.outInfluence : curOut[d].influence;
                    newInArr.push(new KeyframeEase(inSpd, inInf));
                    newOutArr.push(new KeyframeEase(outSpd, outInf));
                }
                property.setTemporalEaseAtKey(ki, newInArr, newOutArr);
            }
            changed.push(ki);
        }

        return JSON.stringify({
            success: true,
            message: "Easing set on " + changed.length + " keyframe(s) for '" + args.propertyName + "'.",
            keyframesModified: changed,
            easeType: easeType
        });
    } catch (e) {
        return JSON.stringify({ success: false, message: e.toString() });
    }
}

// D: removePropertyKeyframes
function removePropertyKeyframes(args) {
    try {
        var comp = app.project.items[args.compIndex];
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ success: false, message: "Composition not found at index " + args.compIndex });
        }
        var layer = comp.layers[args.layerIndex];
        if (!layer) {
            return JSON.stringify({ success: false, message: "Layer not found at index " + args.layerIndex });
        }
        var transformGroup = layer.property("Transform");
        var property = transformGroup ? transformGroup.property(args.propertyName) : null;
        if (!property) {
            return JSON.stringify({ success: false, message: "Property '" + args.propertyName + "' not found." });
        }
        var removed = property.numKeys;
        while (property.numKeys > 0) { property.removeKey(1); }
        return JSON.stringify({ success: true, message: "Removed " + removed + " keyframe(s) from '" + args.propertyName + "'.", removed: removed });
    } catch (e) {
        return JSON.stringify({ success: false, message: e.toString() });
    }
}
