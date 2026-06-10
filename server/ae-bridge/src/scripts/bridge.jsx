// bridge.jsx
// Pure-function dispatch module — no UI, no file I/O, no polling.
// Concatenated with domain files by build-uxp-plugin.mjs at build time.
// Called by the UXP plugin via app.executeScript.


// ============================================================
// JSON POLYFILL (ExtendScript / ES3)
// ============================================================

if (typeof JSON === "undefined") {
    JSON = {};
}
if (typeof JSON.parse !== "function") {
    JSON.parse = function (text) {
        return eval("(" + text + ")");
    };
}
if (typeof JSON.stringify !== "function") {
    (function () {
        function esc(str) {
            return (str + "")
                .replace(/\\/g, "\\\\")
                .replace(/"/g, '\\"')
                .replace(/\n/g, "\\n")
                .replace(/\r/g, "\\r")
                .replace(/\t/g, "\\t");
        }
        function toJSON(val) {
            if (val === null) return "null";
            var t = typeof val;
            if (t === "number" || t === "boolean") return String(val);
            if (t === "string") return '"' + esc(val) + '"';
            if (val instanceof Array) {
                var a = [];
                for (var i = 0; i < val.length; i++) a.push(toJSON(val[i]));
                return "[" + a.join(",") + "]";
            }
            if (t === "object") {
                var props = [];
                for (var k in val) {
                    if (val.hasOwnProperty(k) && typeof val[k] !== "function" && typeof val[k] !== "undefined") {
                        props.push('"' + esc(k) + '":' + toJSON(val[k]));
                    }
                }
                return "{" + props.join(",") + "}";
            }
            return "null";
        }
        JSON.stringify = function (value, _replacer, _space) {
            return toJSON(value);
        };
    })();
}


// ============================================================
// ERROR CODES
// ============================================================

var ERROR_CODES = {
    COMP_NOT_FOUND:     "COMP_NOT_FOUND",
    LAYER_NOT_FOUND:    "LAYER_NOT_FOUND",
    LAYER_INDEX_OOB:    "LAYER_INDEX_OOB",
    PROPERTY_NOT_FOUND: "PROPERTY_NOT_FOUND",
    INVALID_ARGS:       "INVALID_ARGS",
    TIME_OUT_OF_RANGE:  "TIME_OUT_OF_RANGE",
    RENDER_FAILED:      "RENDER_FAILED",
    UNKNOWN_COMMAND:    "UNKNOWN_COMMAND",
    HANDLER_UNCAUGHT:   "HANDLER_UNCAUGHT",
    INTERNAL_ERROR:     "INTERNAL_ERROR",
    BATCH_FAILED:       "BATCH_FAILED"
};

function _err(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
}


// ============================================================
// SHARED HELPERS
// ============================================================

// Resolves comp + layer from args { compName, layerIndex, layerName }.
// Throws on not found. Returns { comp, layer }.
function _resolveCompAndLayer(args) {
    var compName = args.compName || "";
    var comp = null;
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof CompItem && item.name === compName) { comp = item; break; }
    }
    if (!comp) {
        if (!compName && app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
        else { throw _err(ERROR_CODES.COMP_NOT_FOUND, "No composition found with name '" + compName + "'"); }
    }
    var layerIndex = args.layerIndex;
    var layer = null;
    if (layerIndex !== undefined && layerIndex !== null) {
        if (layerIndex > 0 && layerIndex <= comp.numLayers) { layer = comp.layer(layerIndex); }
        else { throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Layer index out of bounds: " + layerIndex); }
    } else if (args.layerName) {
        for (var j = 1; j <= comp.numLayers; j++) {
            if (comp.layer(j).name === args.layerName) { layer = comp.layer(j); break; }
        }
    }
    if (!layer) { throw _err(ERROR_CODES.LAYER_NOT_FOUND, "Layer not found: " + (args.layerName || "index " + layerIndex)); }
    return { comp: comp, layer: layer };
}

// Comp-only resolver — for handlers that don't take a layer argument.
// Accepts compName (preferred), compIndex (1-based project item index), or active comp fallback.
function _resolveComp(args) {
    var compIndex = (args.compIndex !== undefined && args.compIndex !== null) ? parseInt(args.compIndex) : null;
    if (compIndex !== null && compIndex > 0 && compIndex <= app.project.numItems) {
        var candidate = app.project.item(compIndex);
        if (candidate instanceof CompItem) { return candidate; }
        throw _err(ERROR_CODES.COMP_NOT_FOUND, "Item at compIndex " + compIndex + " is not a composition.");
    }
    var compName = args.compName || "";
    var comp = null;
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof CompItem && item.name === compName) { comp = item; break; }
    }
    if (!comp) {
        if (!compName && app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
        else { throw _err(ERROR_CODES.COMP_NOT_FOUND, "No composition found with name '" + compName + "'"); }
    }
    return comp;
}

// Walks a property path array on a layer (e.g. ["Contents","Group 1","Trim Paths 1","Start"]).
// Throws with path context on missing step.
function _resolvePropertyByPath(layer, propertyPath) {
    if (!propertyPath || propertyPath.length === 0) {
        throw _err(ERROR_CODES.INVALID_ARGS, "propertyPath must be a non-empty array.");
    }
    // AE's UI flattens certain container groups; transparent fallback matches UI-level paths.
    var IMPLICIT_CONTAINERS = ["Contents", "ADBE Text Animator Properties", "ADBE Text Selectors"];
    var current = layer;
    for (var i = 0; i < propertyPath.length; i++) {
        var step = propertyPath[i];
        var next = null;
        try { next = current.property(step); } catch (e) {}
        if (!next) {
            for (var c = 0; c < IMPLICIT_CONTAINERS.length; c++) {
                var container = null;
                try { container = current.property(IMPLICIT_CONTAINERS[c]); } catch (e2) {}
                if (container) {
                    var via = null;
                    try { via = container.property(step); } catch (e3) {}
                    if (via) { next = via; break; }
                }
            }
        }
        if (!next) {
            throw _err(ERROR_CODES.PROPERTY_NOT_FOUND, "Property path not found at '" + step + "' (path so far: " + propertyPath.slice(0, i + 1).join(" > ") + ")");
        }
        current = next;
    }
    return current;
}


// ============================================================
// BATCH & DISPATCH
// ============================================================

var READ_ONLY_COMMANDS = {
    getProjectInfo: 1, listCompositions: 1, getLayerInfo: 1,
    getLayerKeyframes: 1, getLayerExpressions: 1,
    getLayerMasks: 1, getLayerEffects: 1,
    getSelectedLayers: 1, getSelectionDetails: 1, listProjectItems: 1,
    getLayerProperty: 1,
    listMarkers: 1, getCurrentTime: 1, getProjectPath: 1,
    getCompositionInfo: 1
};

// Routes a command name + args to the correct handler function.
// Domain handler functions are defined in the files concatenated above this one.
function dispatchCommand(command, args) {
    // Read-only commands and batch (which owns its own outer group) skip the wrapper.
    if (READ_ONLY_COMMANDS[command] === 1 || command === "batch") {
        return _dispatchSwitch(command, args);
    }
    app.beginUndoGroup("Cubic: " + command);
    try {
        return _dispatchSwitch(command, args);
    } finally {
        app.endUndoGroup();
    }
}

function _dispatchSwitch(command, args) {
    switch (command) {
        // compositions.jsx
        case "getProjectInfo":           return getProjectInfo();
        case "listCompositions":         return listCompositions();
        case "createComposition":        return createComposition(args);
        case "setCompositionProperties": return setCompositionProperties(args);
        case "deleteComposition":        return deleteComposition(args);
        case "duplicateComposition":     return duplicateComposition(args);
        case "getCurrentTime":           return getCurrentTime(args);
        case "setCurrentTime":           return setCurrentTime(args);
        case "saveFrameToPng":           return saveFrameToPng(args);
        case "getCompositionInfo":       return getCompositionInfo(args);
        // layers.jsx (core)
        case "getLayerInfo":             return getLayerInfo(args);
        case "getSelectedLayers":        return getSelectedLayers(args);
        case "getSelectionDetails":      return getSelectionDetails(args);
        case "setSelectedLayers":        return setSelectedLayers(args);
        case "createLayer":              return createLayer(args);
        case "createSolidLayer":         return createSolidLayer(args);
        case "createCamera":             return createCamera(args);
        case "createLightLayer":         return createLightLayer(args);
        case "createNullLayer":          return createNullLayer(args);
        case "duplicateLayer":           return duplicateLayer(args);
        case "setLayerProperties":       return setLayerProperties(args);
        case "batchSetLayerProperties":  return batchSetLayerProperties(args);
        case "splitLayer":               return splitLayer(args);
        case "trimLayer":                return trimLayer(args);
        case "moveLayer":                return moveLayer(args);
        case "setLayerParent":           return setLayerParent(args);
        case "centerAnchorPoint":        return centerAnchorPoint(args);
        case "setAnchorPoint":           return setAnchorPoint(args);
        case "alignLayers":              return alignLayers(args);
        case "sequenceLayers":           return sequenceLayers(args);
        case "setTimeRemapEnabled":      return setTimeRemapEnabled(args);
        case "deleteLayer":              return deleteLayer(args);
        case "precompose":               return precompose(args);
        case "decomposeLayer":           return decomposeLayer(args);
        case "mergeLayer":               return mergeLayer(args);
        case "setTrackMatte":            return setTrackMatte(args);
        case "getLayerProperty":         return getLayerProperty(args);
        case "setLayerProperty":         return setLayerProperty(args);
        case "distributeLayers3D":       return distributeLayers3D(args);
        // text.jsx
        case "createTextLayer":          return createTextLayer(args);
        case "addTextAnimator":          return addTextAnimator(args);
        case "setTextAnimatorProperty":  return setTextAnimatorProperty(args);
        case "setTextAnimatorRangeSelector": return setTextAnimatorRangeSelector(args);
        case "explodeTextLayer":         return explodeTextLayer(args);
        // shapes.jsx
        case "createShapeLayer":         return createShapeLayer(args);
        case "addShapeOperator":         return addShapeOperator(args);
        case "setShapeOperatorProperty": return setShapeOperatorProperty(args);
        case "convertToShape":           return convertToShape(args);
        // markers.jsx
        case "addMarker":                return addMarker(args);
        case "listMarkers":              return listMarkers(args);
        case "updateMarker":             return updateMarker(args);
        case "removeMarker":             return removeMarker(args);
        // project.jsx
        case "getProjectPath":           return getProjectPath();
        case "saveProject":              return saveProject(args);
        case "backupProject":            return backupProject(args);
        // animation.jsx
        case "getLayerKeyframes":        return getLayerKeyframes(args);
        case "setLayerKeyframe":         return setLayerKeyframe(args);
        case "setKeyframeEasing":        return setKeyframeEasing(args);
        case "setKeyframeSpatial":       return setKeyframeSpatial(args);
        case "removePropertyKeyframes":  return removePropertyKeyframes(args);
        case "getLayerExpressions":      return getLayerExpressions(args);
        case "setLayerExpression":       return setLayerExpression(args);
        case "copyKeyframeEasing":       return copyKeyframeEasing(args);
        case "applyMotionRecipe":        return applyMotionRecipe(args);
        // masks.jsx
        case "getLayerMasks":            return getLayerMasks(args);
        case "setLayerMask":             return setLayerMask(args);
        case "deleteLayerMask":          return deleteLayerMask(args);
        // effects.jsx
        case "getLayerEffects":          return getLayerEffects(args);
        case "applyEffect":              return applyEffect(args);
        case "applyEffectTemplate":      return applyEffectTemplate(args);
        case "setEffectProperty":        return setEffectProperty(args);
        case "deleteEffect":             return deleteEffect(args);
        // footage.jsx
        case "listProjectItems":         return listProjectItems(args);
        case "importFootage":            return importFootage(args);
        case "addFootageToComp":         return addFootageToComp(args);
        case "importAssetToComp":        return importAssetToComp(args);
        case "deleteProjectItem":         return deleteProjectItem(args);
        case "deleteUnusedSolids":       return deleteUnusedSolids();
        // bridge.jsx
        case "batch":                    return batch(args);
        default:                         return JSON.stringify({ status: "error", errorCode: ERROR_CODES.UNKNOWN_COMMAND, message: "Unknown command: " + command });
    }
}

// Executes multiple bridge commands in a single round-trip
function batch(args) {
    var commands = args.commands;

    if (!commands) {
        return JSON.stringify({ status: "error", errorCode: ERROR_CODES.INVALID_ARGS, message: "Missing 'commands' array." });
    }
    if (typeof commands.length === "undefined") {
        return JSON.stringify({ status: "error", errorCode: ERROR_CODES.INVALID_ARGS, message: "'commands' must be an array." });
    }
    if (commands.length === 0) {
        return JSON.stringify({ status: "success", message: "Empty batch.", total: 0, executed: 0, succeeded: 0, failed: 0, results: [] });
    }

    var stopOnError = args.stopOnError === true;
    var results = [];
    var succeeded = 0;
    var failed = 0;

    // Use the caller-supplied label when present (the agent passes a human-readable
    // summary like "Cubic: apply cinematic look to logo", which appears in AE's Edit
    // menu as the single undo entry for the entire turn). Falls back to a generic
    // label when no summary is provided.
    var batchLabel = (typeof args.groupLabel === "string" && args.groupLabel.length > 0)
        ? ("Cubic: " + args.groupLabel)
        : ("Cubic: batch (" + commands.length + " commands)");
    app.beginUndoGroup(batchLabel);
    try {
    for (var i = 0; i < commands.length; i++) {
        var entry = commands[i];

        // Accept both the wire shape { command, args } and the model-facing { script, parameters }.
        // The agent's executeTool normally translates, but callers that reach this handler
        // directly (e.g. an MCP runScript{script:"batch"} from Claude Code, or a bridge test)
        // may pass the untranslated shape — read whichever key is present.
        var entryCmd = entry ? (entry.command || entry.script) : null;
        var entryArgs = entry ? (entry.args || entry.parameters || {}) : {};

        if (typeof entryCmd !== "string" || entryCmd === "") {
            var errEntry = { index: i, command: null, success: false, status: "error", errorCode: ERROR_CODES.INVALID_ARGS, message: "Missing or invalid 'command' field." };
            results.push(errEntry);
            failed++;
            if (stopOnError) break;
            continue;
        }

        // Block nested batch to prevent infinite recursion
        if (entryCmd === "batch") {
            var nestedErr = { index: i, command: "batch", success: false, status: "error", errorCode: ERROR_CODES.INVALID_ARGS, message: "Nested batch commands are not supported." };
            results.push(nestedErr);
            failed++;
            if (stopOnError) break;
            continue;
        }

        var cmdArgs = entryArgs;
        var resultStr, resultObj, cmdSuccess;

        try {
            resultStr = dispatchCommand(entryCmd, cmdArgs);
        } catch (e) {
            resultStr = JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.HANDLER_UNCAUGHT, message: "Uncaught error: " + e.toString() });
        }

        try {
            resultObj = JSON.parse(resultStr);
            cmdSuccess = resultObj.status !== "error";
        } catch (parseErr) {
            resultObj = { raw: resultStr };
            cmdSuccess = false;
        }

        if (cmdSuccess) { succeeded++; } else { failed++; }

        results.push({
            index: i,
            command: entryCmd,
            success: cmdSuccess,
            status: cmdSuccess ? "success" : "error",
            result: resultObj
        });

        if (stopOnError && !cmdSuccess) break;
    }
    } finally {
        app.endUndoGroup();
    }

    var envelope = {
        status: failed === 0 ? "success" : "error",
        total: commands.length,
        executed: results.length,
        succeeded: succeeded,
        failed: failed,
        stoppedEarly: stopOnError && results.length < commands.length,
        results: results
    };
    // On any sub-command failure the envelope is status:"error"; carry a top-level
    // errorCode so callers (agent loop / logs) see a real code, not undefined. The
    // per-command codes live in results[].
    if (failed > 0) { envelope.errorCode = ERROR_CODES.BATCH_FAILED; }
    return JSON.stringify(envelope, null, 2);
}
