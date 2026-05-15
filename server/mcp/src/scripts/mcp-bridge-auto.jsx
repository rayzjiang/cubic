// mcp-bridge-auto.jsx
// Auto-running MCP Bridge panel for After Effects


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
// DOMAIN MODULES
// ============================================================
//@include "compositions.jsx"
//@include "layers.jsx"
//@include "animation.jsx"
//@include "masks.jsx"
//@include "effects.jsx"
//@include "footage.jsx"


// ============================================================
// BATCH & DISPATCH
// ============================================================

// Routes a command name + args to the correct handler function
function dispatchCommand(command, args) {
    switch (command) {
        case "getProjectInfo":           return getProjectInfo();
        case "listCompositions":         return listCompositions();
        case "getLayerInfo":             return getLayerInfo(args);
        case "createComposition":        return createComposition(args);
        case "setCompositionProperties": return setCompositionProperties(args);
        case "deleteComposition":        return deleteComposition(args);
        case "deleteUnusedSolids":       return deleteUnusedSolids();
        case "createTextLayer":          return createTextLayer(args);
        case "createShapeLayer":         return createShapeLayer(args);
        case "createSolidLayer":         return createSolidLayer(args);
        case "createCamera":             return createCamera(args);
        case "duplicateLayer":           return duplicateLayer(args);
        case "setLayerProperties":       return setLayerProperties(args);
        case "batchSetLayerProperties":  return batchSetLayerProperties(args);
        case "moveLayer":                return moveLayer(args);
        case "deleteLayer":              return deleteLayer(args);
        case "getLayerExpressions":      return getLayerExpressions(args);
        case "setLayerKeyframe":         return setLayerKeyframe(args);
        case "setLayerExpression":       return setLayerExpression(args);
        case "getLayerKeyframes":        return getLayerKeyframes(args);
        case "setKeyframeEasing":        return setKeyframeEasing(args);
        case "removePropertyKeyframes":  return removePropertyKeyframes(args);
        case "setLayerMask":             return setLayerMask(args);
        case "applyEffect":              return applyEffect(args);
        case "applyEffectTemplate":      return applyEffectTemplate(args);
        case "bridgeTestEffects":        return bridgeTestEffects(args);
        case "batch":                    return batch(args);
        default:                         return JSON.stringify({ success: false, error: "Unknown command: " + command });
    }
}

// Executes multiple bridge commands in a single round-trip
function batch(args) {
    var commands = args.commands;

    if (!commands) {
        return JSON.stringify({ success: false, message: "Missing 'commands' array." });
    }
    if (typeof commands.length === "undefined") {
        return JSON.stringify({ success: false, message: "'commands' must be an array." });
    }
    if (commands.length === 0) {
        return JSON.stringify({ success: true, message: "Empty batch.", total: 0, executed: 0, succeeded: 0, failed: 0, results: [] });
    }

    var stopOnError = args.stopOnError === true;
    var results = [];
    var succeeded = 0;
    var failed = 0;

    for (var i = 0; i < commands.length; i++) {
        var entry = commands[i];

        if (!entry || typeof entry.command !== "string" || entry.command === "") {
            var errEntry = { index: i, command: null, success: false, message: "Missing or invalid 'command' field." };
            results.push(errEntry);
            failed++;
            if (stopOnError) break;
            continue;
        }

        // Block nested batch to prevent infinite recursion
        if (entry.command === "batch") {
            var nestedErr = { index: i, command: "batch", success: false, message: "Nested batch commands are not supported." };
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
            resultStr = JSON.stringify({ success: false, message: "Uncaught error: " + e.toString() });
        }

        try {
            resultObj = JSON.parse(resultStr);
            cmdSuccess = !(resultObj.success === false || resultObj.status === "error" || resultObj.error !== undefined);
        } catch (parseErr) {
            resultObj = { raw: resultStr };
            cmdSuccess = false;
        }

        if (cmdSuccess) { succeeded++; } else { failed++; }

        results.push({
            index: i,
            command: entry.command,
            success: cmdSuccess,
            result: resultObj
        });

        if (stopOnError && !cmdSuccess) break;
    }

    return JSON.stringify({
        success: failed === 0,
        total: commands.length,
        executed: results.length,
        succeeded: succeeded,
        failed: failed,
        stoppedEarly: stopOnError && results.length < commands.length,
        results: results
    }, null, 2);
}


// ============================================================
// PANEL UI — global variables referenced by bridge I/O below
// ============================================================

var panel = (this instanceof Panel) ? this : new Window("palette", "MCP Bridge Auto", undefined);
panel.orientation = "column";
panel.alignChildren = ["fill", "top"];
panel.spacing = 10;
panel.margins = 16;

var statusText = panel.add("statictext", undefined, "Waiting for commands...");
statusText.alignment = ["fill", "top"];

var logPanel = panel.add("panel", undefined, "Command Log");
logPanel.orientation = "column";
logPanel.alignChildren = ["fill", "fill"];
var logText = logPanel.add("edittext", undefined, "", {multiline: true, readonly: true});
logText.preferredSize.height = 200;

var autoRunCheckbox = panel.add("checkbox", undefined, "Auto-run commands");
autoRunCheckbox.value = true;

var checkInterval = 2000;
var isChecking = false;


// ============================================================
// BRIDGE I/O
// ============================================================

function getCommandFilePath() {
    var bridgeFolder = new Folder(Folder.myDocuments.parent.fsName + "/.ae-mcp-bridge");
    if (!bridgeFolder.exists) {
        bridgeFolder.create();
    }
    return bridgeFolder.fsName + "/ae_command.json";
}

function getResultFilePath() {
    var bridgeFolder = new Folder(Folder.myDocuments.parent.fsName + "/.ae-mcp-bridge");
    if (!bridgeFolder.exists) {
        bridgeFolder.create();
    }
    return bridgeFolder.fsName + "/ae_mcp_result.json";
}

function logToPanel(message) {
    var timestamp = new Date().toLocaleTimeString();
    logText.text = timestamp + ": " + message + "\n" + logText.text;
}

// Calls dispatchCommand then writes result file
function executeCommand(command, args) {
    logToPanel("Executing command: " + command);
    statusText.text = "Running: " + command;
    if (panel instanceof Window) { panel.update(); }

    try {
        var result = dispatchCommand(command, args);
        logToPanel("Execution finished for: " + command);

        var resultString = (typeof result === "string") ? result : JSON.stringify(result);

        try {
            var resultObj = JSON.parse(resultString);
            var _d = new Date();
            resultObj._responseTimestamp = _d.getFullYear() + "-" +
                ("0" + (_d.getMonth() + 1)).slice(-2) + "-" +
                ("0" + _d.getDate()).slice(-2) + "T" +
                ("0" + _d.getHours()).slice(-2) + ":" +
                ("0" + _d.getMinutes()).slice(-2) + ":" +
                ("0" + _d.getSeconds()).slice(-2);
            resultObj._commandExecuted = command;
            resultString = JSON.stringify(resultObj, null, 2);
        } catch (parseError) {
            logToPanel("Could not parse result as JSON to add timestamp: " + parseError.toString());
        }

        var resultFile = new File(getResultFilePath());
        resultFile.encoding = "UTF-8";
        var opened = resultFile.open("w");
        if (!opened) { throw new Error("Failed to open result file for writing."); }
        var written = resultFile.write(resultString);
        if (!written) { logToPanel("WARNING: result file write returned false."); }
        resultFile.close();

        logToPanel("Command completed: " + command);
        statusText.text = "Command completed: " + command;
        // Do NOT call updateCommandStatus("completed") here — it reads+rewrites the command
        // file AFTER Node.js may have already written the next command as "pending", which
        // would clobber the new command's status and cause it to be skipped on the next poll.

    } catch (error) {
        var errorMsg = "ERROR in executeCommand for '" + command + "': " + error.toString() + (error.line ? " (line: " + error.line + ")" : "");
        logToPanel(errorMsg);
        statusText.text = "Error: " + error.toString();

        try {
            var errorResult = JSON.stringify({
                status: "error",
                command: command,
                message: error.toString(),
                line: error.line,
                fileName: error.fileName
            });
            var errorFile = new File(getResultFilePath());
            errorFile.encoding = "UTF-8";
            if (errorFile.open("w")) {
                errorFile.write(errorResult);
                errorFile.close();
            } else {
                logToPanel("CRITICAL: Failed to open result file to write error.");
            }
        } catch (writeError) {
            logToPanel("CRITICAL: Failed to write error to result file: " + writeError.toString());
        }
        // Same reason — do not call updateCommandStatus("error") here.
    }
}

function updateCommandStatus(status) {
    try {
        var commandFile = new File(getCommandFilePath());
        if (commandFile.exists) {
            commandFile.open("r");
            var content = commandFile.read();
            commandFile.close();

            if (content) {
                var commandData = JSON.parse(content);
                commandData.status = status;

                commandFile.open("w");
                commandFile.write(JSON.stringify(commandData, null, 2));
                commandFile.close();
            }
        }
    } catch (e) {
        logToPanel("Error updating command status: " + e.toString());
    }
}


// ============================================================
// COMMAND LOOP
// ============================================================

function checkForCommands() {
    // Guard: if the checkbox belongs to a destroyed panel instance, accessing .value
    // throws "object is invalid". Catching it here lets the old task chain die without
    // rescheduling, so only the current panel's chain keeps running.
    try {
        if (!autoRunCheckbox || !autoRunCheckbox.value || isChecking) {
            app.scheduleTask("checkForCommands()", checkInterval, false);
            return;
        }
    } catch (e) {
        return; // UI destroyed — do not reschedule, let this task chain die
    }

    isChecking = true;

    try {
        var commandFile = new File(getCommandFilePath());
        if (commandFile.exists) {
            commandFile.open("r");
            var content = commandFile.read();
            commandFile.close();

            if (content) {
                // Always use eval so arrays are native ExtendScript types (JSON.parse in AE 2026
                // returns non-native arrays that the AE API rejects in setValueAtTime etc.)
                var commandData = eval("(" + content + ")");

                if (commandData.status === "pending") {
                    updateCommandStatus("running");
                    executeCommand(commandData.command, commandData.args || {});
                }
            }
        }
    } catch (e) {
        logToPanel("Error checking for commands: " + e.toString());
    }

    isChecking = false;
    app.scheduleTask("checkForCommands()", checkInterval, false);
}

function startCommandChecker() {
    app.scheduleTask("checkForCommands()", checkInterval, false);
}


// ============================================================
// STARTUP
// ============================================================

var checkButton = panel.add("button", undefined, "Check for Commands Now");
checkButton.onClick = function() {
    logToPanel("Manually checking for commands");
    checkForCommands();
};

logToPanel("MCP Bridge Auto started");
logToPanel("Command file: " + getCommandFilePath());
statusText.text = "Ready - Auto-run is " + (autoRunCheckbox.value ? "ON" : "OFF");

startCommandChecker();

if (panel instanceof Window) {
    panel.center();
    panel.show();
} else {
    panel.layout.layout(true);
}
