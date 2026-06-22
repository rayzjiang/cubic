// animation.jsx
// Keyframes  — CRUD: C ✓  R ✓  U ✓  D ✓
// Expressions — CRUD: C/U ✓  R ✓  D ✓ (via empty string)

// ── Expression preset library ──────────────────────────────────────────────
// Each entry: { defaults: {...}, template: "..." }
// Template uses ${paramName} placeholders substituted at apply-time.
var EXPRESSION_PRESETS = (function() {
    // Decaying-sine overshoot (motionscripts.com / BOUNCr "Overshoot+"). Value-delta-driven:
    // amplitude comes from how far the property moved into the settle key (key(n).value-key(n-1).value),
    // NOT the keyframe's temporal velocity — so it survives any later easing edit (easing the settle key
    // to a stop can't zero the bounce). Settles past the target with a symmetric over/under oscillation;
    // amp is the heavy-lifting knob (~0.1 = overshoot ~10% of the distance traveled), freq 2 + decay 4 are
    // the BOUNCr-documented good defaults. Use for pendulum/spring overshoot and springy settles — NOT a
    // ball hitting a floor (that's INERTIAL_BOUNCE).
    var _overshootTpl = [
        "var amp=${amp};var freq=${freq};var decay=${decay};",
        "var n=0;",
        "if(numKeys>0){n=nearestKey(time).index;if(nearestKey(time).time>time)n--;}",
        "if(n>1){var t=time-key(n).time;",
        "var d=key(n).value-key(n-1).value;",
        "value+d*amp*Math.sin(freq*2*Math.PI*t)/Math.exp(decay*t);}else{value;}"
    ].join("\n");
    // Realistic bounce (Dan Ebberts / BOUNCr "Bounce Back"). Velocity-driven ballistic bounce
    // that never crosses the target — like a ball bouncing on a floor — losing energy each
    // bounce. elasticity = bounciness (0-1), gravity = stopping force, maxBounces caps it.
    var _bounceTpl = [
        "var e=${elasticity};var g=${gravity};var nMax=${maxBounces};",
        "var n=0;",
        "if(numKeys>0){n=nearestKey(time).index;if(nearestKey(time).time>time)n--;}",
        "if(n>0){var t=time-key(n).time;",
        "var v=-velocityAtTime(key(n).time-thisComp.frameDuration/10)*e;var vl=length(v);",
        "var vu=(value instanceof Array)?((vl>0)?normalize(v):[0,0,0]):((v<0)?-1:1);",
        "var tCur=0;var segDur=2*vl/g;var tNext=segDur;var nb=1;",
        "while(tNext<t&&nb<=nMax){vl*=e;segDur*=e;tCur=tNext;tNext+=segDur;nb++;}",
        "if(nb<=nMax){var delta=t-tCur;value+vu*delta*(vl-g*delta/2);}else{value;}",
        "}else{value;}"
    ].join("\n");
    return {
        INERTIAL_BOUNCE: { defaults: { elasticity: 0.7, gravity: 5000, maxBounces: 9 }, template: _bounceTpl },
        ELASTIC:         { defaults: { amp: 0.1,  freq: 4,   decay: 3 }, template: _overshootTpl },
        OVERSHOOT:       { defaults: { amp: 0.1,  freq: 2,   decay: 4 }, template: _overshootTpl },
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
        LOOP_OUT:          { defaults: {}, template: 'loopOut("cycle");' },
        LOOP_IN:           { defaults: {}, template: 'loopIn("cycle");' },
        LOOP_PINGPONG:     { defaults: {}, template: 'loopOut("pingpong");' },
        LOOP_OUT_CONTINUE: { defaults: {}, template: 'loopOut("continue");' },
        LOOP_IN_CONTINUE:  { defaults: {}, template: 'loopIn("continue");' },
        LOOP_OUT_OFFSET:   { defaults: {}, template: 'loopOut("offset");' },
        LOOP_IN_OFFSET:    { defaults: {}, template: 'loopIn("offset");' }
    };
}());

function _buildPresetExpression(presetName, params) {
    var preset = EXPRESSION_PRESETS[presetName];
    if (!preset) throw _err(ERROR_CODES.INVALID_ARGS, "Unknown expression preset: '" + presetName + "'. Valid: INERTIAL_BOUNCE, ELASTIC, OVERSHOOT, WIGGLE, AUTO_FADE, LOOP_OUT, LOOP_IN, LOOP_PINGPONG, LOOP_OUT_CONTINUE, LOOP_IN_CONTINUE, LOOP_OUT_OFFSET, LOOP_IN_OFFSET");
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

        // Auto-ease the key we just set (easyEase by default) so manual moves are never linear-ugly —
        // linear is opt-in via easeType:"linear". An explicit curve (easeType/influence) lands in the
        // same call. Mirrors the "easing is the default" rule so the model can't forget a separate step.
        var kfEaseType = args.easeType || "easyEase";
        if (kfEaseType !== "linear") {
            var easedKey = 0;
            for (var fk = 1; fk <= property.numKeys; fk++) {
                if (Math.abs(property.keyTime(fk) - timeInSeconds) < 0.0001) { easedKey = fk; break; }
            }
            if (easedKey > 0) {
                _applyKeyEase(property, easedKey, {
                    easeType: args.easeType,
                    inInfluence: args.inInfluence, outInfluence: args.outInfluence,
                    inSpeed: args.inSpeed, outSpeed: args.outSpeed
                });
            }
        }

        return JSON.stringify({
            status: "success",
            message: "Keyframe set for '" + property.name + "' on layer '" + layer.name + "' at " + timeInSeconds + "s.",
            property: { name: property.name, path: args.propertyPath || null, propertyName: args.propertyName || null },
            easeType: kfEaseType,
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

// Shared per-key easing application (used by setKeyframeEasing AND setLayerKeyframe's auto-ease).
// opts: { easeType, inInfluence, outInfluence, inSpeed, outSpeed }. Returns true if the key was eased.
function _applyKeyEase(property, ki, opts) {
    if (ki < 1 || ki > property.numKeys) return false;

    var easeType = opts.easeType || "easyEase";
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

    var curIn  = property.keyInTemporalEase(ki);
    var curOut = property.keyOutTemporalEase(ki);
    var dim = curIn.length; // 1=scalar, 2=2D, 3=3D

    var hasExplicit = opts.inInfluence !== undefined || opts.outInfluence !== undefined ||
                      opts.inSpeed !== undefined || opts.outSpeed !== undefined;
    var applyDefaultEase = (easeType === "easyEase" || easeType === "easeIn" || easeType === "easeOut") && !hasExplicit;

    if (applyDefaultEase) {
        var defArr = [];
        for (var d = 0; d < dim; d++) { defArr.push(new KeyframeEase(0, 33.33)); }
        var easeInArr  = (easeType === "easeOut") ? curIn  : defArr;
        var easeOutArr = (easeType === "easeIn")  ? curOut : defArr;
        property.setTemporalEaseAtKey(ki, easeInArr, easeOutArr);
    } else if (hasExplicit) {
        var newInArr = [], newOutArr = [];
        for (var d = 0; d < dim; d++) {
            var inSpd  = (opts.inSpeed      !== undefined) ? opts.inSpeed      : curIn[d].speed;
            var inInf  = (opts.inInfluence  !== undefined) ? opts.inInfluence  : curIn[d].influence;
            var outSpd = (opts.outSpeed     !== undefined) ? opts.outSpeed     : curOut[d].speed;
            var outInf = (opts.outInfluence !== undefined) ? opts.outInfluence : curOut[d].influence;
            newInArr.push(new KeyframeEase(inSpd, inInf));
            newOutArr.push(new KeyframeEase(outSpd, outInf));
        }
        property.setTemporalEaseAtKey(ki, newInArr, newOutArr);
    }

    // Set interpolation types LAST: setTemporalEaseAtKey (above) forces BEZIER on both tangents it
    // touches, so an intended LINEAR side (easeIn/easeOut) must be applied AFTER the ease, or it
    // silently reverts to bezier (i.e. easeIn/easeOut behaved like easyEase).
    property.setInterpolationTypeAtKey(ki, types[0], types[1]);
    return true;
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
        var easeOpts = {
            easeType: args.easeType,
            inInfluence: args.inInfluence, outInfluence: args.outInfluence,
            inSpeed: args.inSpeed, outSpeed: args.outSpeed
        };

        var changed = [];
        for (var i = 0; i < indices.length; i++) {
            if (_applyKeyEase(property, indices[i], easeOpts)) changed.push(indices[i]);
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

            // Optionally copy the VALUE too (Easings-Manager "paste values + easing"), not just the curve.
            if (args.copyValues === true) {
                try { tgtProp.setValueAtTime(tgtProp.keyTime(tk), srcProp.keyValue(sk)); } catch(e) {}
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

// Internal: set one keyframe at `time` with explicit bezier in/out influence (0-100).
// The graph-editor primitive behind keyframed overshoot — shapes each key by hand so the
// curve is editable in the graph editor (vs. a baked expression).
function _recipeSetKeyInfluence(prop, time, rawVal, inInf, outInf) {
    prop.setValueAtTime(time, rawVal);
    var ki = -1;
    for (var k = 1; k <= prop.numKeys; k++) {
        if (Math.abs(prop.keyTime(k) - time) < 0.002) { ki = k; break; }
    }
    if (ki === -1) return;
    prop.setInterpolationTypeAtKey(ki, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
    try {
        var dim = prop.keyInTemporalEase(ki).length;
        var inArr = [], outArr = [];
        for (var d = 0; d < dim; d++) {
            inArr.push(new KeyframeEase(0, inInf));
            outArr.push(new KeyframeEase(0, outInf));
        }
        prop.setTemporalEaseAtKey(ki, inArr, outArr);
    } catch (easeErr) {}
}

// Internal: apply a motion recipe to one layer. Returns per-layer result object.
// Called directly from applyMotionRecipe — NOT through dispatchCommand, to stay
// inside the single outer undo group that dispatchCommand already opened.
function _applyRecipeToLayer(layer, recipeName, t0, duration, opts) {
    var easeType  = opts.easeType || "easyEase";
    var bounce    = !!opts.bounce;
    // Where a pop's overshoot lives: keyframes (default — editable in the graph editor) or an
    // INERTIAL_BOUNCE expression (legacy — convenient but baked). Only consulted when bounce is on.
    var bounceStyle = (opts.bounceStyle === "expression") ? "expression" : "keyframes";
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
            var curSc   = scaleProp.value;
            var targetSc = nativeArr(curSc);
            var zeroSc  = [];
            for (var si = 0; si < curSc.length; si++) { zeroSc[si] = (si < 2) ? 0 : +curSc[si]; }
            if (bounce && bounceStyle === "keyframes") {
                // Keyframed overshoot: 0 -> peak (~109% at intensity 1) -> settle to target.
                // Three shaped keys (snappy launch, rounded peak, decelerating settle) so the
                // bounce reads as designed AND stays editable in the graph editor.
                try { prevVals.Scale = scaleProp.value; } catch (e) {}
                if (overwrite) { while (scaleProp.numKeys > 0) { scaleProp.removeKey(1); } }
                var peakSc = [];
                for (var pi = 0; pi < targetSc.length; pi++) {
                    peakSc[pi] = (pi < 2) ? targetSc[pi] * (1 + 0.09 * intensity) : targetSc[pi];
                }
                _recipeSetKeyInfluence(scaleProp, t0,                zeroSc,   33.33, 85);    // fast launch out of 0
                _recipeSetKeyInfluence(scaleProp, t0 + duration * 0.62, peakSc, 70, 55);     // round over the top
                _recipeSetKeyInfluence(scaleProp, t0 + duration,    targetSc, 75,    33.33); // decelerate into rest
                appliedKfs += 3;
            } else {
                applyTwoKeys(scaleProp, "Scale", zeroSc, targetSc);
                if (bounce) {
                    // bounceStyle === "expression": legacy baked overshoot on top of the 2-key scale.
                    // OVERSHOOT (decaying sine) is correct for a scale pop — it settles past 100%
                    // and back; INERTIAL_BOUNCE is a floor-bounce that would never cross the target.
                    try { prevVals.ScaleExpression = scaleProp.expression || ""; } catch (e) {}
                    scaleProp.expression = _buildPresetExpression("OVERSHOOT", { amp: 0.1 * intensity, freq: 2, decay: 4 });
                    exprsApplied.push("Scale: OVERSHOOT");
                }
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

        // orderType controls the stagger order across layers (default: the given layerIndices order).
        if (args.orderType) {
            var ot = String(args.orderType).toUpperCase();
            layerIndices = layerIndices.slice(0);
            if (ot === "TOP_DOWN")       { layerIndices.sort(function(a, b) { return a - b; }); }
            else if (ot === "BOTTOM_UP") { layerIndices.sort(function(a, b) { return b - a; }); }
            else if (ot === "RANDOM")    { for (var sh = layerIndices.length - 1; sh > 0; sh--) { var rk = Math.floor(Math.random() * (sh + 1)); var tmp = layerIndices[sh]; layerIndices[sh] = layerIndices[rk]; layerIndices[rk] = tmp; } }
            else { throw _err(ERROR_CODES.INVALID_ARGS, "orderType must be TOP_DOWN, BOTTOM_UP, or RANDOM."); }
        }

        var lastStart = t0 + (layerIndices.length - 1) * stagger;
        if (lastStart + duration > comp.duration + 0.001) {
            throw _err(ERROR_CODES.TIME_OUT_OF_RANGE,
                "Recipe extends to " + (lastStart + duration).toFixed(3) + "s, exceeding comp duration " + comp.duration.toFixed(3) + "s.");
        }

        var opts = {
            easeType:           args.ease || "easyEase",
            bounce:             !!args.bounce,
            bounceStyle:        args.bounceStyle,
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

// ── Keyframe pro-tools (Motion-Tools-style) ─────────────────────────────────────

// Read every keyframe on a property into a portable array (time, value, interp, eases, spatial).
// Pairs with _writeKey to clone / re-time / shift keys while preserving their easing exactly.
function _readKeys(prop) {
    var spatial = false; try { spatial = prop.isSpatial; } catch (e) {}
    var keys = [];
    for (var k = 1; k <= prop.numKeys; k++) {
        var rec = { time: prop.keyTime(k), value: prop.keyValue(k),
                    inInterp: prop.keyInInterpolationType(k), outInterp: prop.keyOutInterpolationType(k) };
        try { rec.inEase = prop.keyInTemporalEase(k); rec.outEase = prop.keyOutTemporalEase(k); } catch (e) {}
        if (spatial) {
            try { rec.inTan = prop.keyInSpatialTangent(k); rec.outTan = prop.keyOutSpatialTangent(k);
                  rec.autoBez = prop.keySpatialAutoBezier(k); rec.cont = prop.keySpatialContinuous(k); } catch (e) {}
        }
        keys.push(rec);
    }
    return { spatial: spatial, keys: keys };
}

// Write one key record at a (possibly remapped) time, restoring value + easing + spatial tangents.
// Interp type is applied LAST because setTemporalEaseAtKey forces bezier on the tangents it touches.
function _writeKey(prop, rec, atTime, spatial) {
    prop.setValueAtTime(atTime, rec.value);
    var ki = -1;
    for (var k = 1; k <= prop.numKeys; k++) { if (Math.abs(prop.keyTime(k) - atTime) < 0.0005) { ki = k; break; } }
    if (ki === -1) { return; }
    if (rec.inEase && rec.outEase) {
        try {
            var ni = [], no = [];
            for (var a = 0; a < rec.inEase.length; a++) { ni.push(new KeyframeEase(rec.inEase[a].speed, rec.inEase[a].influence)); }
            for (var b = 0; b < rec.outEase.length; b++) { no.push(new KeyframeEase(rec.outEase[b].speed, rec.outEase[b].influence)); }
            prop.setTemporalEaseAtKey(ki, ni, no);
        } catch (e) {}
    }
    if (spatial && rec.inTan && rec.outTan) {
        try { prop.setSpatialTangentsAtKey(ki, rec.inTan, rec.outTan); } catch (e) {}
        try { prop.setSpatialAutoBezierAtKey(ki, rec.autoBez); prop.setSpatialContinuousAtKey(ki, rec.cont); } catch (e) {}
    }
    try { prop.setInterpolationTypeAtKey(ki, rec.inInterp, rec.outInterp); } catch (e) {}
}

// C: cloneKeyframes — copy a property's keyframes (all, or keyIndices) to the playhead (or targetTime),
// preserving values + easing. reverse mirrors their order in time. The Motion-Tools "Clone" move.
function cloneKeyframes(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp = resolved.comp;
        var layer = resolved.layer;
        var prop = _resolveAnimProp(layer, args);
        if (prop.numKeys === 0) { throw _err(ERROR_CODES.INVALID_ARGS, "Property '" + prop.name + "' has no keyframes to clone."); }

        var snap = _readKeys(prop);
        var src = [];
        if (args.keyIndices && args.keyIndices.length) {
            for (var i = 0; i < args.keyIndices.length; i++) {
                var idx = args.keyIndices[i];
                if (idx >= 1 && idx <= snap.keys.length) { src.push(snap.keys[idx - 1]); }
            }
        } else { src = snap.keys; }
        if (src.length === 0) { throw _err(ERROR_CODES.INVALID_ARGS, "No source keyframes selected."); }

        var minT = src[0].time, maxT = src[0].time;
        for (var s = 1; s < src.length; s++) { if (src[s].time < minT) { minT = src[s].time; } if (src[s].time > maxT) { maxT = src[s].time; } }
        var targetTime = (args.targetTime !== undefined && args.targetTime !== null) ? +args.targetTime : comp.time;
        var reverse = args.reverse === true;

        var created = [];
        for (var c = 0; c < src.length; c++) {
            var rec = src[c];
            var nt = reverse ? (targetTime + (maxT - rec.time)) : (targetTime + (rec.time - minT));
            if (nt > comp.duration + 0.001 || nt < 0) { continue; }
            _writeKey(prop, rec, nt, snap.spatial);
            created.push(nt);
        }

        return JSON.stringify({
            status: "success",
            message: "Cloned " + created.length + " keyframe(s) to " + targetTime.toFixed(3) + "s" + (reverse ? " (reversed)" : "") + ".",
            property: { name: prop.name, path: args.propertyPath || null, propertyName: args.propertyName || null },
            clonedTimes: created, reverse: reverse
        }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: e.toString(), line: e.line }, null, 2);
    }
}

// U: fixKeyframeTiming — snap every keyframe on a property to the comp's frame grid (preserving value
// + easing). The Motion-Tools "Fix Keys Time" move — cleans up sub-frame keys after retiming/scaling.
function fixKeyframeTiming(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp = resolved.comp;
        var layer = resolved.layer;
        var prop = _resolveAnimProp(layer, args);
        if (prop.numKeys === 0) { return JSON.stringify({ status: "noop", message: "No keyframes to snap." }, null, 2); }

        var fd = comp.frameDuration;
        var snap = _readKeys(prop);
        var changed = false;
        for (var c = 0; c < snap.keys.length; c++) {
            var snapped = Math.round(snap.keys[c].time / fd) * fd;
            if (Math.abs(snapped - snap.keys[c].time) > 0.0005) { changed = true; }
            snap.keys[c].newTime = snapped;
        }
        if (!changed) { return JSON.stringify({ status: "noop", message: "Keyframes already sit on the frame grid." }, null, 2); }

        while (prop.numKeys > 0) { prop.removeKey(1); }
        for (var w = 0; w < snap.keys.length; w++) { _writeKey(prop, snap.keys[w], snap.keys[w].newTime, snap.spatial); }

        return JSON.stringify({
            status: "success",
            message: "Snapped " + snap.keys.length + " keyframe(s) to the frame grid.",
            property: { name: prop.name, path: args.propertyPath || null, propertyName: args.propertyName || null },
            keyframes: snap.keys.length
        }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: e.toString(), line: e.line }, null, 2);
    }
}

// U: sequenceKeyframes — stagger the EXISTING keyframes of a property across several layers (layer n's
// whole key-set shifts by n*stagger). Distinct from sequenceLayers (which moves layer START times).
function sequenceKeyframes(args) {
    try {
        var comp = _resolveComp(args);
        var layerIndices = args.layerIndices;
        if (!layerIndices || typeof layerIndices.length === "undefined" || layerIndices.length === 0) {
            throw _err(ERROR_CODES.INVALID_ARGS, "layerIndices must be a non-empty array.");
        }
        var stagger = (args.stagger !== undefined && args.stagger !== null) ? +args.stagger : 0.1;
        var orderType = (args.orderType || "TOP_DOWN").toUpperCase();
        var ordered = layerIndices.slice(0);
        if (orderType === "TOP_DOWN")       { ordered.sort(function(a, b) { return a - b; }); }
        else if (orderType === "BOTTOM_UP") { ordered.sort(function(a, b) { return b - a; }); }
        else if (orderType === "RANDOM")    { for (var sh = ordered.length - 1; sh > 0; sh--) { var rk = Math.floor(Math.random() * (sh + 1)); var tmp = ordered[sh]; ordered[sh] = ordered[rk]; ordered[rk] = tmp; } }
        else { throw _err(ERROR_CODES.INVALID_ARGS, "orderType must be TOP_DOWN, BOTTOM_UP, or RANDOM."); }

        var shifted = [];
        var warnings = [];
        for (var n = 0; n < ordered.length; n++) {
            var idx = ordered[n];
            if (idx < 1 || idx > comp.numLayers) { throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Layer index out of bounds: " + idx); }
            var layer = comp.layer(idx);
            var prop;
            try { prop = _resolveAnimProp(layer, args); } catch (e) { warnings.push("Layer " + idx + ": " + e.message); continue; }
            if (prop.numKeys === 0) { warnings.push("Layer " + idx + " has no keyframes on that property."); continue; }
            var offset = n * stagger;
            if (offset === 0) { shifted.push({ index: idx, offset: 0 }); continue; }
            var snap = _readKeys(prop);
            while (prop.numKeys > 0) { prop.removeKey(1); }
            for (var w = 0; w < snap.keys.length; w++) { _writeKey(prop, snap.keys[w], snap.keys[w].time + offset, snap.spatial); }
            shifted.push({ index: idx, offset: offset });
        }

        var resultObj = {
            status: "success",
            message: "Sequenced keyframes across " + shifted.length + " layer(s) by " + stagger + "s (" + orderType + ").",
            orderType: orderType, stagger: stagger, layers: shifted
        };
        if (warnings.length > 0) { resultObj.warning = warnings.join(" "); }
        return JSON.stringify(resultObj, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: e.toString(), line: e.line }, null, 2);
    }
}
