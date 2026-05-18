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

// Routes by propertyPath (walks nested groups via _resolvePropertyByPath)
// or propertyName (legacy, top-level Transform/Effects/Text only via resolveProperty).
function _resolveAnimProp(layer, args) {
    if (args.propertyPath && args.propertyPath.length > 0) {
        return _resolvePropertyByPath(layer, args.propertyPath);
    }
    if (args.propertyName) {
        var prop = resolveProperty(layer, args.propertyName);
        if (!prop) {
            throw _err(ERROR_CODES.PROPERTY_NOT_FOUND,
                "Property '" + args.propertyName + "' not found on layer '" + layer.name + "'.");
        }
        return prop;
    }
    throw _err(ERROR_CODES.INVALID_ARGS, "Provide propertyPath (preferred) or propertyName.");
}

// R: getLayerExpressions
function getLayerExpressions(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

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
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: e.toString(), line: e.line }, null, 2);
    }
}

// R: getLayerKeyframes
function getLayerKeyframes(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var property = _resolveAnimProp(layer, args);

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
            property: { name: property.name, path: args.propertyPath || null, propertyName: args.propertyName || null },
            keyframes: keyframes,
            count: keyframes.length
        }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: e.toString(), line: e.line }, null, 2);
    }
}

// C: setLayerKeyframe
function setLayerKeyframe(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var property = _resolveAnimProp(layer, args);
        if (!property.canVaryOverTime) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Property '" + property.name + "' cannot be keyframed.");
        }

        var value = args.value;
        var timeInSeconds = args.timeInSeconds;

        // Capture prior state for revert
        var previousKey = { existed: false, value: null };
        for (var pk = 1; pk <= property.numKeys; pk++) {
            if (Math.abs(property.keyTime(pk) - timeInSeconds) < 0.0001) {
                previousKey = { existed: true, value: property.keyValue(pk) };
                break;
            }
        }

        // Reconstruct as a literal array so AE always gets a native ExtendScript array type.
        var currentVal = property.value;
        var finalVal;
        if (value && typeof value === "object" && value.vertices instanceof Array) {
            finalVal = new Shape();
            finalVal.vertices = value.vertices;
            finalVal.closed = (value.closed !== false);
            if (value.inTangents)  { finalVal.inTangents  = value.inTangents; }
            if (value.outTangents) { finalVal.outTangents = value.outTangents; }
        } else if (typeof currentVal === "object" && typeof currentVal.length === "number" && currentVal.length >= 1) {
            finalVal = [];
            for (var vi = 0; vi < currentVal.length; vi++) {
                var inVal = +value[vi];
                finalVal[vi] = isNaN(inVal) ? +currentVal[vi] : inVal;
            }
        } else {
            finalVal = +value;
        }

        property.setValueAtTime(timeInSeconds, finalVal);

        return JSON.stringify({
            status: "success",
            message: "Keyframe set for '" + property.name + "' on layer '" + layer.name + "' at " + timeInSeconds + "s.",
            property: { name: property.name, path: args.propertyPath || null, propertyName: args.propertyName || null },
            previousKey: previousKey
        }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: "Error setting keyframe: " + e.toString(), line: e.line }, null, 2);
    }
}

// C/U: setLayerExpression
function setLayerExpression(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var property = _resolveAnimProp(layer, args);
        if (!property.canSetExpression) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Property '" + property.name + "' does not support expressions.");
        }

        var previousValue = property.expression || "";
        property.expression = args.expressionString;

        var action = args.expressionString === "" ? "removed" : "set";
        return JSON.stringify({
            status: "success",
            message: "Expression " + action + " for '" + property.name + "' on layer '" + layer.name + "'.",
            property: { name: property.name, path: args.propertyPath || null, propertyName: args.propertyName || null },
            previousValue: previousValue
        }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: "Error setting expression: " + e.toString(), line: e.line }, null, 2);
    }
}

// U: setKeyframeEasing
function setKeyframeEasing(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var property = _resolveAnimProp(layer, args);
        if (property.numKeys === 0) {
            throw _err(ERROR_CODES.INVALID_ARGS, "No keyframes on property '" + property.name + "'.");
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
            throw _err(ERROR_CODES.INVALID_ARGS, "No matching keyframe found.");
        }

        // Capture prior easings for revert
        var previousEasings = [];
        for (var pe = 0; pe < indices.length; pe++) {
            var pki = indices[pe];
            if (pki < 1 || pki > property.numKeys) continue;
            var prevIn  = property.keyInTemporalEase(pki);
            var prevOut = property.keyOutTemporalEase(pki);
            previousEasings.push({
                keyIndex: pki,
                inInterp: property.keyInInterpolationType(pki),
                outInterp: property.keyOutInterpolationType(pki),
                inEase: prevIn,
                outEase: prevOut
            });
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
            message: "Easing set on " + changed.length + " keyframe(s) for '" + property.name + "'.",
            property: { name: property.name, path: args.propertyPath || null, propertyName: args.propertyName || null },
            keyframesModified: changed,
            easeType: easeType,
            previousEasings: previousEasings
        }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: e.toString(), line: e.line }, null, 2);
    }
}

// D: removePropertyKeyframes
function removePropertyKeyframes(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var property = _resolveAnimProp(layer, args);

        var removed = property.numKeys;
        while (property.numKeys > 0) { property.removeKey(1); }
        return JSON.stringify({
            status: "success",
            message: "Removed " + removed + " keyframe(s) from '" + property.name + "'.",
            property: { name: property.name, path: args.propertyPath || null, propertyName: args.propertyName || null },
            removed: removed
        }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: e.toString(), line: e.line }, null, 2);
    }
}
