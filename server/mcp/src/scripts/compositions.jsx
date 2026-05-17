// compositions.jsx
// CRUD: C ✓  R ✓  U ✓  D ✓

// R: getProjectInfo
function getProjectInfo() {
    try {
        var project = app.project;
        var result = {
            projectName: project.file ? project.file.name : "Untitled Project",
            path: project.file ? project.file.fsName : "",
            numItems: project.numItems,
            bitsPerChannel: project.bitsPerChannel,
            timeMode: project.timeDisplayType === TimeDisplayType.FRAMES ? "Frames" : "Timecode",
            items: []
        };

        var countByType = {
            compositions: 0,
            footage: 0,
            folders: 0,
            solids: 0
        };

        for (var i = 1; i <= Math.min(project.numItems, 50); i++) {
            var item = project.item(i);
            var itemType = "";

            if (item instanceof CompItem) {
                itemType = "Composition";
                countByType.compositions++;
            } else if (item instanceof FolderItem) {
                itemType = "Folder";
                countByType.folders++;
            } else if (item instanceof FootageItem) {
                if (item.mainSource instanceof SolidSource) {
                    itemType = "Solid";
                    countByType.solids++;
                } else {
                    itemType = "Footage";
                    countByType.footage++;
                }
            }

            result.items.push({
                id: item.id,
                name: item.name,
                type: itemType
            });
        }

        result.itemCounts = countByType;

        if (app.project.activeItem instanceof CompItem) {
            var ac = app.project.activeItem;
            result.activeComp = {
                id: ac.id,
                name: ac.name,
                width: ac.width,
                height: ac.height,
                duration: ac.duration,
                frameRate: ac.frameRate,
                numLayers: ac.numLayers
            };
        }

        return JSON.stringify(result, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// R: listCompositions
function listCompositions() {
    try {
        var project = app.project;
        var result = {
            compositions: []
        };

        for (var i = 1; i <= project.numItems; i++) {
            var item = project.item(i);

            if (item instanceof CompItem) {
                result.compositions.push({
                    id: item.id,
                    itemIndex: i,
                    name: item.name,
                    duration: item.duration,
                    frameRate: item.frameRate,
                    width: item.width,
                    height: item.height,
                    numLayers: item.numLayers
                });
            }
        }

        return JSON.stringify(result, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// C: createComposition
function createComposition(args) {
    try {
        var name = args.name || "New Composition";
        var width = parseInt(args.width) || 1920;
        var height = parseInt(args.height) || 1080;
        var pixelAspect = parseFloat(args.pixelAspect) || 1.0;
        var duration = parseFloat(args.duration) || 10.0;
        var frameRate = parseFloat(args.frameRate) || 30.0;
        var bgColor = args.backgroundColor ? [args.backgroundColor.r/255, args.backgroundColor.g/255, args.backgroundColor.b/255] : [0, 0, 0];
        var newComp = app.project.items.addComp(name, width, height, pixelAspect, duration, frameRate);
        if (args.backgroundColor) {
            newComp.bgColor = bgColor;
        }
        var itemIndex = 0;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).id === newComp.id) { itemIndex = i; break; }
        }
        return JSON.stringify({
            status: "success", message: "Composition created successfully",
            composition: { name: newComp.name, id: newComp.id, itemIndex: itemIndex, width: newComp.width, height: newComp.height, pixelAspect: newComp.pixelAspect, duration: newComp.duration, frameRate: newComp.frameRate, bgColor: newComp.bgColor }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// U: setCompositionProperties
function setCompositionProperties(args) {
    try {
        var compName = args.compName || "";
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            throw new Error("No composition found with name '" + compName + "'");
        }
        var changed = [];
        if (args.name !== undefined && args.name !== null) { comp.name = args.name; changed.push("name"); }
        if (args.duration !== undefined && args.duration !== null) { comp.duration = args.duration; changed.push("duration"); }
        if (args.frameRate !== undefined && args.frameRate !== null) { comp.frameRate = args.frameRate; changed.push("frameRate"); }
        if (args.width !== undefined && args.width !== null && args.height !== undefined && args.height !== null) {
            comp.width = args.width; comp.height = args.height; changed.push("dimensions");
        }
        if (args.backgroundColor !== undefined && args.backgroundColor !== null) {
            comp.bgColor = [args.backgroundColor.r / 255, args.backgroundColor.g / 255, args.backgroundColor.b / 255];
            changed.push("backgroundColor");
        }
        return JSON.stringify({
            status: "success",
            composition: { name: comp.name, duration: comp.duration, frameRate: comp.frameRate, width: comp.width, height: comp.height, bgColor: comp.bgColor },
            changedProperties: changed
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// Project op: undoAction — undo the most recent N actions (1–20)
// Note: intentionally in READ_ONLY_COMMANDS in mcp-bridge.jsx — wrapping Undo inside
// beginUndoGroup is semantically incoherent and causes undefined AE behavior.
function undoAction(args) {
    try {
        var steps = (args && args.steps) ? parseInt(args.steps) : 1;
        if (isNaN(steps) || steps < 1) { steps = 1; }
        if (steps > 20) { steps = 20; }

        // findMenuCommandId("Undo") may fail on AE versions where the label is dynamic
        // ("Undo createSolidLayer" vs. the static "Undo"). Fall back to hardcoded ID 16
        // which is Edit > Undo on all AE versions and platforms.
        var undoCmd = app.findMenuCommandId("Undo") || 16;

        var executed = 0;
        for (var i = 0; i < steps; i++) {
            try {
                app.executeCommand(undoCmd);
                executed++;
            } catch (e) {
                // AE throws when nothing remains to undo — stop the loop
                break;
            }
        }
        return JSON.stringify({
            status: "success",
            message: "Undid " + executed + " action(s)",
            requested: steps,
            executed: executed
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// D: deleteComposition
function deleteComposition(args) {
    try {
        var comp = null;
        if (args.compName) {
            for (var i = 1; i <= app.project.numItems; i++) {
                var item = app.project.item(i);
                if (item instanceof CompItem && item.name === args.compName) { comp = item; break; }
            }
        } else if (args.compIndex) {
            var candidate = app.project.item(parseInt(args.compIndex));
            if (candidate instanceof CompItem) { comp = candidate; }
        }
        if (!comp) {
            return JSON.stringify({ status: "error", message: "Composition not found: " + (args.compName || args.compIndex) }, null, 2);
        }
        var name = comp.name;
        var id   = comp.id;
        comp.remove();
        return JSON.stringify({ status: "success", deleted: { name: name, id: id } }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}
