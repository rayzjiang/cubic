// mcp-bridge.jsx
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
// BATCH & DISPATCH
// ============================================================

var READ_ONLY_COMMANDS = {
    getProjectInfo: 1, listCompositions: 1, getLayerInfo: 1,
    getLayerKeyframes: 1, getLayerExpressions: 1,
    getLayerMasks: 1, getLayerEffects: 1,
    getSelectedLayers: 1, listProjectItems: 1
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
        // layers.jsx
        case "getLayerInfo":             return getLayerInfo(args);
        case "getSelectedLayers":        return getSelectedLayers(args);
        case "createTextLayer":          return createTextLayer(args);
        case "createShapeLayer":         return createShapeLayer(args);
        case "createSolidLayer":         return createSolidLayer(args);
        case "createCamera":             return createCamera(args);
        case "createLightLayer":         return createLightLayer(args);
        case "createNullLayer":          return createNullLayer(args);
        case "duplicateLayer":           return duplicateLayer(args);
        case "setLayerProperties":       return setLayerProperties(args);
        case "batchSetLayerProperties":  return batchSetLayerProperties(args);
        case "moveLayer":                return moveLayer(args);
        case "setLayerParent":           return setLayerParent(args);
        case "deleteLayer":              return deleteLayer(args);
        // animation.jsx
        case "getLayerKeyframes":        return getLayerKeyframes(args);
        case "setLayerKeyframe":         return setLayerKeyframe(args);
        case "setKeyframeEasing":        return setKeyframeEasing(args);
        case "removePropertyKeyframes":  return removePropertyKeyframes(args);
        case "getLayerExpressions":      return getLayerExpressions(args);
        case "setLayerExpression":       return setLayerExpression(args);
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
        case "deleteProjectItem":         return deleteProjectItem(args);
        case "deleteUnusedSolids":       return deleteUnusedSolids();
        // mcp-bridge.jsx
        case "batch":                    return batch(args);
        default:                         return JSON.stringify({ status: "error", message: "Unknown command: " + command });
    }
}

// Executes multiple bridge commands in a single round-trip
function batch(args) {
    var commands = args.commands;

    if (!commands) {
        return JSON.stringify({ status: "error", message: "Missing 'commands' array." });
    }
    if (typeof commands.length === "undefined") {
        return JSON.stringify({ status: "error", message: "'commands' must be an array." });
    }
    if (commands.length === 0) {
        return JSON.stringify({ status: "success", message: "Empty batch.", total: 0, executed: 0, succeeded: 0, failed: 0, results: [] });
    }

    var stopOnError = args.stopOnError === true;
    var results = [];
    var succeeded = 0;
    var failed = 0;

    app.beginUndoGroup("Cubic: batch (" + commands.length + " commands)");
    try {
    for (var i = 0; i < commands.length; i++) {
        var entry = commands[i];

        if (!entry || typeof entry.command !== "string" || entry.command === "") {
            var errEntry = { index: i, command: null, success: false, status: "error", message: "Missing or invalid 'command' field." };
            results.push(errEntry);
            failed++;
            if (stopOnError) break;
            continue;
        }

        // Block nested batch to prevent infinite recursion
        if (entry.command === "batch") {
            var nestedErr = { index: i, command: "batch", success: false, status: "error", message: "Nested batch commands are not supported." };
            results.push(nestedErr);
            failed++;
            if (stopOnError) break;
            continue;
        }

        var cmdArgs = entry.args || {};
        var resultStr, resultObj, cmdSuccess;

        try {
            resultStr = dispatchCommand(entry.command, cmdArgs);
        } catch (e) {
            resultStr = JSON.stringify({ status: "error", message: "Uncaught error: " + e.toString() });
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
            command: entry.command,
            success: cmdSuccess,
            status: cmdSuccess ? "success" : "error",
            result: resultObj
        });

        if (stopOnError && !cmdSuccess) break;
    }
    } finally {
        app.endUndoGroup();
    }

    return JSON.stringify({
        status: failed === 0 ? "success" : "error",
        total: commands.length,
        executed: results.length,
        succeeded: succeeded,
        failed: failed,
        stoppedEarly: stopOnError && results.length < commands.length,
        results: results
    }, null, 2);
}
