// animation.jsx
// Keyframes  — CRUD: C ✓  R ✓  U ✓  D ✓
// Expressions — CRUD: C/U ✓  R ✓  D ✓ (via empty string)

// ── Expression preset library ──────────────────────────────────────────────
// Each entry: { defaults: {...}, template: "..." }
// Template uses ${paramName} placeholders substituted at apply-time.
var EXPRESSION_PRESETS = (function() {
    var _bounceTpl = [
        "var amp=${amp};var freq=${freq};var decay=${decay};",
        "var n=0;",
        "if(numKeys>0){n=nearestKey(time).index;if(nearestKey(time).time>time)n--;}",
        "var t=(n===0)?0:time-key(n).time;",
        "if(n>0){var v=velocityAtTime(key(n).time-thisComp.frameDuration/10);",
        "value+v*amp*Math.sin(freq*2*Math.PI*t)/Math.exp(decay*t);}else{value;}"
    ].join("\n");
    return {
        INERTIAL_BOUNCE: { defaults: { amp: 0.1,  freq: 2.5, decay: 4 }, template: _bounceTpl },
        ELASTIC:         { defaults: { amp: 0.1,  freq: 4,   decay: 3 }, template: _bounceTpl },
        OVERSHOOT:       { defaults: { amp: 0.05, freq: 1.5, decay: 8 }, template: _bounceTpl },
        WIGGLE: {
            defaults: { freq: 3, amp: 25 },
            template: "wiggle(${freq},${amp});"
        },
        AUTO_FADE: {
            defaults: { fadeIn: 0.5, fadeOut: 0.5 },
            template: [
                "var fadeIn=${fadeIn};var fadeOut=${fadeOut};",
                "var t=time-inPoint;var t2=outPoint-time;",
                "if(t<fadeIn){linear(t,0,fadeIn,0,value);}",
                "else if(t2<fadeOut){linear(t2,0,fadeOut,0,value);}",
                "else{value;}"
            ].join("\n")
        },
        LOOP_OUT:     { defaults: {}, template: 'loopOut("cycle");' },
        LOOP_IN:      { defaults: {}, template: 'loopIn("cycle");' },
        LOOP_PINGPONG:{ defaults: {}, template: 'loopOut("pingpong");' }
    };
}());

function _buildPresetExpression(presetName, params) {
    var preset = EXPRESSION_PRESETS[presetName];
    if (!preset) throw _err(ERROR_CODES.INVALID_ARGS, "Unknown expression preset: '" + presetName + "'. Valid: INERTIAL_BOUNCE, ELASTIC, OVERSHOOT, WIGGLE, AUTO_FADE, LOOP_OUT, LOOP_IN, LOOP_PINGPONG");
    var p = {};
    for (var k in preset.defaults) { if (preset.defaults.hasOwnProperty(k)) p[k] = preset.defaults[k]; }
    if (params) { for (var pk in params) { if (params.hasOwnProperty(pk)) p[pk] = params[pk]; } }
    var result = preset.template;
    for (var v in p) { if (p.hasOwnProperty(v)) { result = result.split("${" + v + "}").join(String(p[v])); } }
    return result;
}

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
            var kData = {
                keyIndex: k,
                time: property.keyTime(k),
                value: property.keyValue(k),
                inInterpolationType: inType,
                inInterpolationLabel: interpLabels[inType] || "unknown",
                outInterpolationType: outType,
                outInterpolationLabel: interpLabels[outType] || "unknown"
            };
            // Temporal ease (try/catch: not all properties support it)
            try {
                var inEaseArr = property.keyInTemporalEase(k);
                var outEaseArr = property.keyOutTemporalEase(k);
                var inEaseData = [], outEaseData = [];
                for (var ei = 0; ei < inEaseArr.length; ei++) inEaseData.push({ speed: inEaseArr[ei].speed, influence: inEaseArr[ei].influence });
                for (var eo = 0; eo < outEaseArr.length; eo++) outEaseData.push({ speed: outEaseArr[eo].speed, influence: outEaseArr[eo].influence });
                kData.inTemporalEase = inEaseData;
                kData.outTemporalEase = outEaseData;
            } catch(easeErr) {}
            // Spatial tangents (only on spatial properties)
            try {
                kData.inSpatialTangent  = property.keyInSpatialTangent(k);
                kData.outSpatialTangent = property.keyOutSpatialTangent(k);
                kData.spatialAutoBezier = property.keySpatialAutoBezier(k);
                kData.spatialContinuous = property.keySpatialContinuous(k);
                kData.roving            = property.keyRoving(k);
            } catch(spatialErr) {}
            keyframes.push(kData);
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

        // noop: a keyframe already exists at this exact time and already holds the requested value.
        // Skip the Shape case (vertices aren't a flat numeric array _valuesEqual can compare).
        if (previousKey.existed && !(finalVal instanceof Shape) && _valuesEqual(finalVal, previousKey.value)) {
            return JSON.stringify({ status: "noop", message: "Keyframe already set to that value at that time." }, null, 2);
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

// C/U: setLayerExpression — set a raw expression string or a named preset.
// When args.preset is set (e.g. 'INERTIAL_BOUNCE'), the preset template is used.
// args.presetParams overrides individual preset default values.
// Raw args.expressionString takes precedence when both are supplied.
function setLayerExpression(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var property = _resolveAnimProp(layer, args);
        if (!property.canSetExpression) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Property '" + property.name + "' does not support expressions.");
        }

        var expressionStr = args.expressionString;
        var preset = null;
        if (!expressionStr && args.preset) {
            preset = (args.preset + "").toUpperCase();
            expressionStr = _buildPresetExpression(preset, args.presetParams || {});
        }
        if (expressionStr === undefined || expressionStr === null) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Provide expressionString or preset.");
        }

        var previousValue = property.expression || "";

        // noop: the property already holds exactly this expression (covers both setting the same
        // string and clearing an already-empty expression — "" === "" -> "No expression to remove.").
        if (expressionStr === previousValue) {
            return JSON.stringify({ status: "noop", message: expressionStr === "" ? "No expression to remove." : "Expression already set to that." }, null, 2);
        }

        property.expression = expressionStr;

        var action = expressionStr === "" ? "removed" : "set";
        return JSON.stringify({
            status: "success",
            message: "Expression " + action + " for '" + property.name + "' on layer '" + layer.name + "'" + (preset ? " (preset: " + preset + ")" : "") + ".",
            property: { name: property.name, path: args.propertyPath || null, propertyName: args.propertyName || null },
            preset: preset,
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

            // Set interpolation types LAST: setTemporalEaseAtKey (above) forces BEZIER on both
            // tangents it touches, so an intended LINEAR side (easeIn/easeOut) must be applied AFTER
            // the ease, or it silently reverts to bezier (i.e. easeIn/easeOut behaved like easyEase).
            property.setInterpolationTypeAtKey(ki, types[0], types[1]);
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

// U: setKeyframeSpatial — set spatial tangents, auto-bezier, continuous bezier, or roving on position keyframes
function setKeyframeSpatial(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var property = _resolveAnimProp(layer, args);
        if (property.numKeys === 0) {
            throw _err(ERROR_CODES.INVALID_ARGS, "No keyframes on property '" + property.name + "'.");
        }
        var isSpat = false;
        try { isSpat = property.isSpatial; } catch(e2) {}
        if (!isSpat) {
            throw _err(ERROR_CODES.INVALID_ARGS,
                "Property '" + property.name + "' is not a spatial property. Spatial tangents only apply to position-type properties (isSpatial=false).");
        }

        // Resolve which keyframe(s) to target — same logic as setKeyframeEasing
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

        // Capture prior spatial state for revert
        var previousSpatial = [];
        for (var pe = 0; pe < indices.length; pe++) {
            var pki = indices[pe];
            if (pki < 1 || pki > property.numKeys) continue;
            previousSpatial.push({
                keyIndex:   pki,
                inTangent:  property.keyInSpatialTangent(pki),
                outTangent: property.keyOutSpatialTangent(pki),
                autoBezier: property.keySpatialAutoBezier(pki),
                continuous: property.keySpatialContinuous(pki),
                roving:     property.keyRoving(pki)
            });
        }

        var hasSpatialIn  = (args.spatialIn  !== undefined && args.spatialIn  !== null);
        var hasSpatialOut = (args.spatialOut  !== undefined && args.spatialOut !== null);
        var hasAutoBezier = (args.autoBezier  !== undefined && args.autoBezier !== null);
        var hasContinuous = (args.continuous  !== undefined && args.continuous !== null);
        var hasRoving     = (args.roving      !== undefined && args.roving     !== null);

        var inTangentArg  = hasSpatialIn  ? (typeof args.spatialIn  === "string" ? eval("(" + args.spatialIn  + ")") : args.spatialIn)  : null;
        var outTangentArg = hasSpatialOut ? (typeof args.spatialOut === "string" ? eval("(" + args.spatialOut + ")") : args.spatialOut) : null;

        var changed = [];
        var warnings = [];
        for (var i = 0; i < indices.length; i++) {
            var ki = indices[i];
            if (ki < 1 || ki > property.numKeys) continue;

            if (hasSpatialIn || hasSpatialOut) {
                var currentIn  = property.keyInSpatialTangent(ki);
                var currentOut = property.keyOutSpatialTangent(ki);
                var dim = currentIn.length;
                var newIn  = hasSpatialIn  ? inTangentArg  : currentIn;
                var newOut = hasSpatialOut ? outTangentArg : currentOut;
                var finalIn = [], finalOut = [];
                for (var d = 0; d < dim; d++) {
                    finalIn[d]  = (newIn  && newIn[d]  !== undefined) ? +newIn[d]  : +currentIn[d];
                    finalOut[d] = (newOut && newOut[d] !== undefined) ? +newOut[d] : +currentOut[d];
                }
                property.setSpatialTangentsAtKey(ki, finalIn, finalOut);
            }

            if (hasAutoBezier) { property.setSpatialAutoBezierAtKey(ki, !!args.autoBezier); }
            if (hasContinuous) { property.setSpatialContinuousAtKey(ki, !!args.continuous); }

            if (hasRoving) {
                if (ki === 1 || ki === property.numKeys) {
                    warnings.push("keyIndex " + ki + ": roving cannot be set on the first or last keyframe — skipped.");
                } else {
                    property.setRovingAtKey(ki, !!args.roving);
                }
            }

            changed.push(ki);
        }

        var resultObj = {
            status: "success",
            message: "Spatial properties set on " + changed.length + " keyframe(s) for '" + property.name + "'.",
            property: { name: property.name, path: args.propertyPath || null, propertyName: args.propertyName || null },
            keysModified: changed,
            previousSpatial: previousSpatial
        };
        if (warnings.length > 0) { resultObj.warnings = warnings; }
        return JSON.stringify(resultObj, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: e.toString(), line: e.line }, null, 2);
    }
}

// U: copyKeyframeEasing — copy temporal ease, interpolation type, and spatial tangents
// from all keyframes on a source property to matching keyframes on a target property.
// Only the easing shape is copied; keyframe values are untouched.
// source/target: each { compName, layerIndex/layerName }; propertyPath/propertyName selects the property.
// timeOffset (seconds, default 0): shift source keyframe times before matching against target.
function copyKeyframeEasing(args) {
    try {
        var srcResolved = _resolveCompAndLayer({
            compName: args.sourceCompName, layerIndex: args.sourceLayerIndex, layerName: args.sourceLayerName
        });
        var tgtResolved = _resolveCompAndLayer({
            compName: args.targetCompName, layerIndex: args.targetLayerIndex, layerName: args.targetLayerName
        });
        var srcLayer = srcResolved.layer;
        var tgtLayer = tgtResolved.layer;
        var tgtComp  = tgtResolved.comp;

        var propArgs = { propertyPath: args.propertyPath, propertyName: args.propertyName };
        var srcProp = _resolveAnimProp(srcLayer, propArgs);
        var tgtProp = _resolveAnimProp(tgtLayer, propArgs);

        if (srcProp.numKeys === 0) throw _err(ERROR_CODES.INVALID_ARGS, "Source property has no keyframes.");
        if (tgtProp.numKeys === 0) throw _err(ERROR_CODES.INVALID_ARGS, "Target property has no keyframes.");

        var timeOffset = args.timeOffset || 0;
        var tolerance  = tgtComp.frameDuration / 2;
        var isSpatial  = false;
        try { isSpatial = srcProp.isSpatial && tgtProp.isSpatial; } catch(e) {}

        var previousEasings = [];
        var pairsCopied = 0;
        var warnings = [];

        for (var sk = 1; sk <= srcProp.numKeys; sk++) {
            var tgtTime = srcProp.keyTime(sk) + timeOffset;

            // Find matching target keyframe within tolerance
            var tk = -1;
            for (var t = 1; t <= tgtProp.numKeys; t++) {
                if (Math.abs(tgtProp.keyTime(t) - tgtTime) <= tolerance) { tk = t; break; }
            }
            if (tk === -1) {
                warnings.push("No target keyframe near t=" + tgtTime.toFixed(3) + "s (source key " + sk + ").");
                continue;
            }

            // Snapshot target keyframe's prior easing for revert
            var prev = { keyIndex: tk, keyTime: tgtProp.keyTime(tk) };
            try { prev.inInterp = tgtProp.keyInInterpolationType(tk); prev.outInterp = tgtProp.keyOutInterpolationType(tk); } catch(e) {}
            try {
                var pi = tgtProp.keyInTemporalEase(tk);
                var po = tgtProp.keyOutTemporalEase(tk);
                prev.inEase = []; prev.outEase = [];
                for (var i = 0; i < pi.length; i++) prev.inEase.push({ speed: pi[i].speed, influence: pi[i].influence });
                for (var o = 0; o < po.length; o++) prev.outEase.push({ speed: po[o].speed, influence: po[o].influence });
            } catch(e) {}
            try {
                prev.inSpatialTangent  = tgtProp.keyInSpatialTangent(tk);
                prev.outSpatialTangent = tgtProp.keyOutSpatialTangent(tk);
                prev.autoBezier = tgtProp.keySpatialAutoBezier(tk);
                prev.continuous = tgtProp.keySpatialContinuous(tk);
                prev.roving     = tgtProp.keyRoving(tk);
            } catch(e) {}
            previousEasings.push(prev);

            // Copy interpolation type
            try {
                tgtProp.setInterpolationTypeAtKey(tk, srcProp.keyInInterpolationType(sk), srcProp.keyOutInterpolationType(sk));
            } catch(e) {}

            // Copy temporal ease (rebuild KeyframeEase objects)
            try {
                var srcIn  = srcProp.keyInTemporalEase(sk);
                var srcOut = srcProp.keyOutTemporalEase(sk);
                var newIn = [], newOut = [];
                for (var d = 0; d < srcIn.length; d++) newIn.push(new KeyframeEase(srcIn[d].speed, srcIn[d].influence));
                for (var e2 = 0; e2 < srcOut.length; e2++) newOut.push(new KeyframeEase(srcOut[e2].speed, srcOut[e2].influence));
                tgtProp.setTemporalEaseAtKey(tk, newIn, newOut);
            } catch(e) {}

            // Copy spatial tangents when both properties are spatial
            if (isSpatial) {
                try {
                    tgtProp.setSpatialTangentsAtKey(tk, srcProp.keyInSpatialTangent(sk), srcProp.keyOutSpatialTangent(sk));
                    tgtProp.setSpatialAutoBezierAtKey(tk, srcProp.keySpatialAutoBezier(sk));
                    tgtProp.setSpatialContinuousAtKey(tk, srcProp.keySpatialContinuous(sk));
                    if (tk > 1 && tk < tgtProp.numKeys) {
                        tgtProp.setRovingAtKey(tk, srcProp.keyRoving(sk));
                    }
                } catch(e) {}
            }

            pairsCopied++;
        }

        var resultObj = {
            status: "success",
            message: "Copied easing for " + pairsCopied + " keyframe pair(s).",
            pairsCopied: pairsCopied,
            previousEasings: previousEasings
        };
        if (warnings.length > 0) resultObj.warnings = warnings;
        return JSON.stringify(resultObj, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: e.toString(), line: e.line }, null, 2);
    }
}

// ── Motion Recipe Library ──────────────────────────────────────────────────────

var _VALID_RECIPES = {
    popIn: 1, popOut: 1, fadeIn: 1, fadeOut: 1,
    slideIn: 1, slideOut: 1, scaleIn: 1, bounceIn: 1, wiggle: 1
};

// Internal: set one keyframe at `time` with easing applied.
// rawVal must already be the correctly-typed value for the property (scalar or array).
function _recipeSetKey(prop, time, rawVal, easeType) {
    prop.setValueAtTime(time, rawVal);
    var ki = -1;
    for (var k = 1; k <= prop.numKeys; k++) {
        if (Math.abs(prop.keyTime(k) - time) < 0.002) { ki = k; break; }
    }
    if (ki === -1) return;
    var typeMap = {
        easyEase: [KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER],
        easeIn:   [KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.LINEAR],
        easeOut:  [KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.BEZIER],
        linear:   [KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR],
        hold:     [KeyframeInterpolationType.HOLD,   KeyframeInterpolationType.HOLD],
        bezier:   [KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER]
    };
    var tp = typeMap[easeType] || typeMap.easyEase;
    prop.setInterpolationTypeAtKey(ki, tp[0], tp[1]);
    try {
        var curIn  = prop.keyInTemporalEase(ki);
        var curOut = prop.keyOutTemporalEase(ki);
        var dim = curIn.length;
        if (easeType !== "linear" && easeType !== "hold") {
            var defArr = [];
            for (var d = 0; d < dim; d++) { defArr.push(new KeyframeEase(0, 33.33)); }
            var inArr  = (easeType === "easeOut") ? curIn  : defArr;
            var outArr = (easeType === "easeIn")  ? curOut : defArr;
            prop.setTemporalEaseAtKey(ki, inArr, outArr);
        }
    } catch (easeErr) {}
}

// Internal: apply a motion recipe to one layer. Returns per-layer result object.
// Called directly from applyMotionRecipe — NOT through dispatchCommand, to stay
// inside the single outer undo group that dispatchCommand already opened.
function _applyRecipeToLayer(layer, recipeName, t0, duration, opts) {
    var easeType  = opts.easeType || "easyEase";
    var bounce    = !!opts.bounce;
    var intensity = (opts.intensity !== undefined) ? +opts.intensity : 1.0;
    var overwrite = opts.overwriteKeyframes === true;
    var fromArg   = opts.from;
    var appliedKfs   = 0;
    var exprsApplied = [];
    var prevVals     = {};

    function getTransformProp(name) {
        var tf = layer.property("Transform");
        return tf ? tf.property(name) : null;
    }

    // Set start + end keyframes on a property; respects overwriteKeyframes guard.
    function applyTwoKeys(prop, name, startVal, endVal) {
        if (!prop || !prop.canVaryOverTime) return;
        try { prevVals[name] = prop.value; } catch (e) {}
        if (overwrite) { while (prop.numKeys > 0) { prop.removeKey(1); } }
        _recipeSetKey(prop, t0, startVal, easeType);
        _recipeSetKey(prop, t0 + duration, endVal, easeType);
        appliedKfs += 2;
    }

    // Build a native array from `source` with the same length as `template`.
    function nativeArr(source) {
        var out = [];
        for (var i = 0; i < source.length; i++) { out[i] = +source[i]; }
        return out;
    }

    if (recipeName === "popIn" || recipeName === "bounceIn" || recipeName === "scaleIn") {
        if (recipeName === "bounceIn") { bounce = true; }
        var scaleProp = getTransformProp("Scale");
        if (scaleProp) {
            var curSc  = scaleProp.value;
            var zeroSc = [];
            for (var si = 0; si < curSc.length; si++) { zeroSc[si] = (si < 2) ? 0 : +curSc[si]; }
            applyTwoKeys(scaleProp, "Scale", zeroSc, nativeArr(curSc));
            if (bounce) {
                try { prevVals.ScaleExpression = scaleProp.expression || ""; } catch (e) {}
                scaleProp.expression = _buildPresetExpression("INERTIAL_BOUNCE", { amp: 0.1 * intensity, freq: 2.5, decay: 4 });
                exprsApplied.push("Scale: INERTIAL_BOUNCE");
            }
        }
        if (recipeName !== "scaleIn") {
            var opaProp = getTransformProp("Opacity");
            if (opaProp) { applyTwoKeys(opaProp, "Opacity", 0, 100); }
        }

    } else if (recipeName === "popOut") {
        var scaleProp = getTransformProp("Scale");
        if (scaleProp) {
            var curSc  = scaleProp.value;
            var zeroSc = [];
            for (var si = 0; si < curSc.length; si++) { zeroSc[si] = (si < 2) ? 0 : +curSc[si]; }
            applyTwoKeys(scaleProp, "Scale", nativeArr(curSc), zeroSc);
        }
        var opaProp = getTransformProp("Opacity");
        if (opaProp) { applyTwoKeys(opaProp, "Opacity", 100, 0); }

    } else if (recipeName === "fadeIn") {
        var opaProp = getTransformProp("Opacity");
        if (opaProp) { applyTwoKeys(opaProp, "Opacity", 0, 100); }

    } else if (recipeName === "fadeOut") {
        var opaProp = getTransformProp("Opacity");
        if (opaProp) { applyTwoKeys(opaProp, "Opacity", 100, 0); }

    } else if (recipeName === "slideIn" || recipeName === "slideOut") {
        var posProp = getTransformProp("Position");
        if (posProp) {
            var curPos = posProp.value;
            var offset = fromArg;
            if (!offset) {
                offset = [-200 * intensity, 0, 0];
            } else if (typeof offset === "string") {
                try { offset = eval("(" + offset + ")"); } catch (e2) {}
            }
            var offPos = [];
            for (var oi = 0; oi < curPos.length; oi++) {
                offPos[oi] = +curPos[oi] + (offset[oi] !== undefined ? +offset[oi] : 0);
            }
            if (recipeName === "slideIn") {
                applyTwoKeys(posProp, "Position", offPos, nativeArr(curPos));
            } else {
                applyTwoKeys(posProp, "Position", nativeArr(curPos), offPos);
            }
        }

    } else if (recipeName === "wiggle") {
        var posProp = getTransformProp("Position");
        if (posProp) {
            try { prevVals.PositionExpression = posProp.expression || ""; } catch (e) {}
            posProp.expression = _buildPresetExpression("WIGGLE", { freq: 3, amp: 25 * intensity });
            exprsApplied.push("Position: WIGGLE");
        }
    }

    return {
        layerIndex:          layer.index,
        layerName:           layer.name,
        startTime:           t0,
        keyframesAdded:      appliedKfs,
        expressionsApplied:  exprsApplied,
        previousValues:      prevVals
    };
}

// C/U: applyMotionRecipe — apply a named motion recipe to an array of layers with optional stagger.
// One call can animate 20+ layers with cascading delays; all mutations run inside the single
// outer undo group opened by dispatchCommand, so one ⌘Z reverts the entire call.
function applyMotionRecipe(args) {
    try {
        var comp = _resolveComp(args);

        var recipe = args.recipe;
        if (!recipe || !_VALID_RECIPES[recipe]) {
            throw _err(ERROR_CODES.INVALID_ARGS,
                "Unknown recipe: '" + recipe + "'. Valid: popIn, popOut, fadeIn, fadeOut, slideIn, slideOut, scaleIn, bounceIn, wiggle");
        }

        var layerIndices = args.layerIndices;
        if (!layerIndices || typeof layerIndices.length === "undefined" || layerIndices.length === 0) {
            throw _err(ERROR_CODES.INVALID_ARGS, "layerIndices must be a non-empty array.");
        }

        var t0       = (args.startTime !== undefined && args.startTime !== null) ? +args.startTime : 0;
        var duration = (args.duration  !== undefined && args.duration  !== null) ? +args.duration  : 0.5;
        var stagger  = (args.stagger   !== undefined && args.stagger   !== null) ? +args.stagger   : 0;

        if (duration <= 0) {
            throw _err(ERROR_CODES.INVALID_ARGS, "duration must be > 0.");
        }

        var lastStart = t0 + (layerIndices.length - 1) * stagger;
        if (lastStart + duration > comp.duration + 0.001) {
            throw _err(ERROR_CODES.TIME_OUT_OF_RANGE,
                "Recipe extends to " + (lastStart + duration).toFixed(3) + "s, exceeding comp duration " + comp.duration.toFixed(3) + "s.");
        }

        var opts = {
            easeType:           args.ease || "easyEase",
            bounce:             !!args.bounce,
            intensity:          (args.intensity !== undefined) ? +args.intensity : 1.0,
            overwriteKeyframes: args.overwriteKeyframes === true,
            from:               args.from
        };

        var results = [];
        for (var i = 0; i < layerIndices.length; i++) {
            var idx = layerIndices[i];
            if (idx < 1 || idx > comp.numLayers) {
                throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Layer index out of bounds: " + idx);
            }
            var layer   = comp.layer(idx);
            var layerT0 = t0 + i * stagger;
            results.push(_applyRecipeToLayer(layer, recipe, layerT0, duration, opts));
        }

        return JSON.stringify({
            status:        "success",
            recipe:        recipe,
            layersAffected: results.length,
            results:       results
        }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: e.toString(), line: e.line }, null, 2);
    }
}

// U: applyTransition — editorial transitions without hand-rolling opacity keyframes.
// type: crossDissolve (fade clip A out + clip B in over an overlap) |
//       fadeToBlack | fadeFromBlack | dipToColor (a color solid keyframed over the clip).
// layerIndices: [A, B] for crossDissolve (A fades out, B fades in); [clip] for the fades.
// durationSeconds: transition length (default 0.5). atTime: where the transition sits.
// color: [r,g,b] 0-1 for the fade/dip solid (default black).
function applyTransition(args) {
    var createdSolid = null;  // tracked for atomic-create rollback (see catch)
    try {
        var comp = _resolveComp(args);
        var type = (args.type || "");
        var layerIndices = args.layerIndices;
        var duration = (args.durationSeconds !== undefined && args.durationSeconds !== null) ? parseFloat(args.durationSeconds) : 0.5;

        var validTypes = { crossDissolve: true, fadeToBlack: true, fadeFromBlack: true, dipToColor: true };
        if (!validTypes[type]) {
            throw _err(ERROR_CODES.INVALID_ARGS, "type must be crossDissolve, fadeToBlack, fadeFromBlack, or dipToColor.");
        }
        if (!layerIndices || typeof layerIndices.length === "undefined" || layerIndices.length === 0) {
            throw _err(ERROR_CODES.INVALID_ARGS, "layerIndices must be a non-empty array.");
        }
        if (isNaN(duration) || duration <= 0) {
            throw _err(ERROR_CODES.INVALID_ARGS, "durationSeconds must be a positive number.");
        }
        for (var v = 0; v < layerIndices.length; v++) {
            if (layerIndices[v] < 1 || layerIndices[v] > comp.numLayers) throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Layer index out of bounds: " + layerIndices[v]);
        }

        // Set a fade between two opacity keys (linear — editorial dissolves read cleanest un-eased).
        function fadeOpacity(layer, tStart, vStart, tEnd, vEnd) {
            var op = layer.property("Transform").property("Opacity");
            _recipeSetKey(op, tStart, vStart, "linear");
            _recipeSetKey(op, tEnd, vEnd, "linear");
        }

        if (type === "crossDissolve") {
            if (layerIndices.length < 2) {
                throw _err(ERROR_CODES.INVALID_ARGS, "crossDissolve needs two layers: [outgoing, incoming].");
            }
            var outgoing = comp.layer(layerIndices[0]);
            var incoming = comp.layer(layerIndices[1]);
            // Default: the dissolve lands right as the outgoing clip ends.
            var endT = (args.atTime !== undefined && args.atTime !== null) ? (parseFloat(args.atTime) + duration) : outgoing.outPoint;
            var startT = endT - duration;

            fadeOpacity(outgoing, startT, 100, endT, 0);
            fadeOpacity(incoming, startT, 0, endT, 100);

            var warning;
            if (incoming.inPoint > startT + 0.001 || incoming.outPoint < endT - 0.001) {
                warning = "The incoming clip isn't active across the whole dissolve — overlap the two clips so both cover " + startT.toFixed(2) + "–" + endT.toFixed(2) + "s.";
            }
            var result = {
                status: "success",
                message: "Cross-dissolved over " + duration + "s (" + startT.toFixed(2) + "–" + endT.toFixed(2) + "s).",
                type: type,
                outgoing: { index: outgoing.index, name: outgoing.name },
                incoming: { index: incoming.index, name: incoming.name }
            };
            if (warning) { result.warning = warning; }
            return JSON.stringify(result, null, 2);
        }

        // Fades / dip use a color solid keyframed over the target clip.
        var target = comp.layer(layerIndices[0]);
        var color = args.color || [0, 0, 0];
        var col = [
            (color.length > 0) ? parseFloat(color[0]) : 0,
            (color.length > 1) ? parseFloat(color[1]) : 0,
            (color.length > 2) ? parseFloat(color[2]) : 0
        ];
        var solidName = (type === "fadeToBlack") ? "Fade to Black" : (type === "fadeFromBlack") ? "Fade from Black" : "Dip to Color";
        createdSolid = comp.layers.addSolid(col, solidName, comp.width, comp.height, 1);
        // Solid covers the whole frame, sitting on top of everything.
        createdSolid.moveToBeginning();

        var sStart, sEnd, solidIn, solidOut;
        if (type === "fadeFromBlack") {
            sStart = (args.atTime !== undefined && args.atTime !== null) ? parseFloat(args.atTime) : target.inPoint;
            sEnd = sStart + duration;
            fadeOpacity(createdSolid, sStart, 100, sEnd, 0);
            solidIn = sStart; solidOut = sEnd;
        } else if (type === "fadeToBlack") {
            sEnd = (args.atTime !== undefined && args.atTime !== null) ? (parseFloat(args.atTime) + duration) : target.outPoint;
            sStart = sEnd - duration;
            fadeOpacity(createdSolid, sStart, 0, sEnd, 100);
            solidIn = sStart; solidOut = target.outPoint; // stay on the color through the clip's end
        } else { // dipToColor — fade in to full color and back out, centered on atTime
            var center = (args.atTime !== undefined && args.atTime !== null) ? parseFloat(args.atTime) : comp.time;
            sStart = center - duration / 2;
            sEnd = center + duration / 2;
            var op = createdSolid.property("Transform").property("Opacity");
            _recipeSetKey(op, sStart, 0, "linear");
            _recipeSetKey(op, center, 100, "linear");
            _recipeSetKey(op, sEnd, 0, "linear");
            solidIn = sStart; solidOut = sEnd;
        }
        // Trim the solid to just its transition window so it isn't a persistent layer.
        createdSolid.startTime = solidIn;
        createdSolid.inPoint = solidIn;
        createdSolid.outPoint = solidOut;

        return JSON.stringify({
            status: "success",
            message: solidName + " over " + duration + "s.",
            type: type,
            solid: { index: createdSolid.index, name: createdSolid.name, inPoint: createdSolid.inPoint, outPoint: createdSolid.outPoint }
        }, null, 2);
    } catch (error) {
        // Roll back the partially-created solid so a failed transition leaves no orphan.
        if (createdSolid !== null) { try { createdSolid.remove(); } catch (e2) {} }
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// D: removePropertyKeyframes
function removePropertyKeyframes(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var property = _resolveAnimProp(layer, args);

        // noop: nothing to remove if the property has no keyframes.
        if (property.numKeys === 0) {
            return JSON.stringify({ status: "noop", message: "No keyframes to remove." }, null, 2);
        }

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
