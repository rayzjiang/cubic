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

        for (var i = 1; i <= project.numItems; i++) {
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
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
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

        result.count = result.compositions.length;
        return JSON.stringify(result, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
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
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: setCompositionProperties
function setCompositionProperties(args) {
    try {
        var comp = _resolveComp(args);
        var hasW = (args.width  !== undefined && args.width  !== null);
        var hasH = (args.height !== undefined && args.height !== null);
        if (hasW !== hasH) {
            throw _err(ERROR_CODES.INVALID_ARGS,
                "Pass both width and height together — AE applies dimension changes as a pair.");
        }

        // Capture prior state for revert (only for fields the args touch)
        var previousValues = {};
        if (args.name !== undefined && args.name !== null) { previousValues.name = comp.name; }
        if (args.duration !== undefined && args.duration !== null) { previousValues.duration = comp.duration; }
        if (args.frameRate !== undefined && args.frameRate !== null) { previousValues.frameRate = comp.frameRate; }
        if (hasW && hasH) { previousValues.width = comp.width; previousValues.height = comp.height; }
        if (args.backgroundColor !== undefined && args.backgroundColor !== null) { previousValues.backgroundColor = comp.bgColor; }

        var changed = [];
        if (args.name !== undefined && args.name !== null) { comp.name = args.name; changed.push("name"); }
        if (args.duration !== undefined && args.duration !== null) { comp.duration = args.duration; changed.push("duration"); }
        if (args.frameRate !== undefined && args.frameRate !== null) { comp.frameRate = args.frameRate; changed.push("frameRate"); }
        if (hasW && hasH) { comp.width = args.width; comp.height = args.height; changed.push("dimensions"); }
        if (args.backgroundColor !== undefined && args.backgroundColor !== null) {
            comp.bgColor = [args.backgroundColor.r / 255, args.backgroundColor.g / 255, args.backgroundColor.b / 255];
            changed.push("backgroundColor");
        }
        return JSON.stringify({
            status: "success",
            composition: { name: comp.name, duration: comp.duration, frameRate: comp.frameRate, width: comp.width, height: comp.height, bgColor: comp.bgColor },
            changedProperties: changed,
            previousValues: previousValues
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// R: getCurrentTime — get the composition playhead time
function getCurrentTime(args) {
    try {
        var comp = null;
        if (args && args.compName) {
            comp = _resolveComp(args);
        } else {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
        }
        if (!comp) {
            return JSON.stringify({ status: "success", activeComp: false, message: "No active composition" }, null, 2);
        }
        return JSON.stringify({
            status: "success",
            compName: comp.name,
            timeInSeconds: comp.time,
            frame: Math.round(comp.time * comp.frameRate),
            frameRate: comp.frameRate,
            duration: comp.duration
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: setCurrentTime — move the composition playhead; clamps to [0, duration)
function setCurrentTime(args) {
    try {
        var comp = null;
        if (args && args.compName) {
            comp = _resolveComp(args);
        } else {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
        }
        if (!comp) { throw _err(ERROR_CODES.COMP_NOT_FOUND, "No active composition. Pass compName or open a comp."); }

        var t = null;
        if (args.timeInSeconds !== undefined && args.timeInSeconds !== null) {
            t = parseFloat(args.timeInSeconds);
        } else if (args.timeInFrames !== undefined && args.timeInFrames !== null) {
            t = parseFloat(args.timeInFrames) / comp.frameRate;
        } else {
            throw _err(ERROR_CODES.INVALID_ARGS, "Provide timeInSeconds or timeInFrames.");
        }

        // Clamp silently — motion designers expect snap rather than error
        if (t < 0) { t = 0; }
        if (t >= comp.duration) { t = comp.duration - (1 / comp.frameRate); }

        var previousValue = comp.time;
        comp.time = t;

        return JSON.stringify({
            status: "success",
            compName: comp.name,
            timeInSeconds: comp.time,
            frame: Math.round(comp.time * comp.frameRate),
            frameRate: comp.frameRate,
            previousValue: previousValue
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// R: saveFrameToPng — render a single frame to disk as PNG
function saveFrameToPng(args) {
    try {
        var comp = _resolveComp(args);

        var time = (typeof args.timeInSeconds === "number") ? args.timeInSeconds : comp.time;
        if (time < 0 || time > comp.duration) {
            throw _err(ERROR_CODES.TIME_OUT_OF_RANGE, "time " + time + "s is outside comp duration [0, " + comp.duration + "]");
        }

        if (!args.outputPath) {
            var framesFolder = new Folder('~/.cubic/frames');
            if (!framesFolder.exists) { framesFolder.create(); }
            args.outputPath = framesFolder.fsName + '/frame_' + new Date().getTime() + '.png';
        }
        var file = new File(args.outputPath);

        var parent = file.parent;
        if (parent && !parent.exists) { parent.create(); }

        // Pre-check write permission: open('w') returns false when AE scripting write access is disabled
        var permTest = new File(file.parent.fsName + '/.cubic_write_test');
        if (!permTest.open('w')) {
            throw _err(ERROR_CODES.RENDER_FAILED,
                "AE cannot write files — go to Preferences → Scripting & Expressions and enable 'Allow Scripts to Write Files and Access Network'");
        }
        permTest.close();
        if (permTest.exists) { permTest.remove(); }

        // Pre-check method availability (requires AE 17.0.1+)
        if (typeof comp.saveFrameToPng !== 'function') {
            throw _err(ERROR_CODES.RENDER_FAILED,
                "comp.saveFrameToPng is not available (typeof: " + typeof comp.saveFrameToPng + ") — requires AE 17.0.1+");
        }

        comp.saveFrameToPng(time, file);

        // Do not check file.exists here — ExtendScript's File stat is stale for paths written
        // by AE's internal renderer. Trust the call if it didn't throw; Node verifies on its side.
        var finalPath = file.fsName;

        return JSON.stringify({
            status: "success",
            path: finalPath,
            timeInSeconds: time,
            frame: Math.round(time * comp.frameRate),
            width: comp.width,
            height: comp.height,
            comp: { name: comp.name, frameRate: comp.frameRate, duration: comp.duration }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.RENDER_FAILED, message: error.toString() }, null, 2);
    }
}

// D: deleteComposition
function deleteComposition(args) {
    try {
        var comp = _resolveComp(args);
        var name = comp.name;
        var id   = comp.id;
        comp.remove();
        return JSON.stringify({ status: "success", deleted: { name: name, id: id } }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// R: getCompositionInfo — full detail on a single comp (vs. listCompositions which is summary)
function getCompositionInfo(args) {
    try {
        var comp = _resolveComp(args);
        return JSON.stringify({
            status: "success",
            composition: {
                id: comp.id,
                name: comp.name,
                width: comp.width,
                height: comp.height,
                pixelAspect: comp.pixelAspect,
                duration: comp.duration,
                frameRate: comp.frameRate,
                bgColor: comp.bgColor,
                numLayers: comp.numLayers,
                workAreaStart: comp.workAreaStart,
                workAreaDuration: comp.workAreaDuration,
                displayStartTime: comp.displayStartTime,
                resolutionFactor: comp.resolutionFactor,
                shutterAngle: comp.shutterAngle,
                shutterPhase: comp.shutterPhase,
                motionBlur: comp.motionBlur,
                draft3d: comp.draft3d
            }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}
