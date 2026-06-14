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

        // Pre-validate workArea pair atomically before any mutation
        var hasWorkAreaStart    = (args.workAreaStart    !== undefined && args.workAreaStart    !== null);
        var hasWorkAreaDuration = (args.workAreaDuration !== undefined && args.workAreaDuration !== null);
        if (hasWorkAreaStart || hasWorkAreaDuration) {
            var waStart   = hasWorkAreaStart    ? parseFloat(args.workAreaStart)    : comp.workAreaStart;
            var waDur     = hasWorkAreaDuration ? parseFloat(args.workAreaDuration) : comp.workAreaDuration;
            var compDur   = (args.duration !== undefined && args.duration !== null) ? parseFloat(args.duration) : comp.duration;
            if (waStart < 0) { throw _err(ERROR_CODES.INVALID_ARGS, "workAreaStart must be >= 0"); }
            if (waStart >= compDur) { throw _err(ERROR_CODES.INVALID_ARGS, "workAreaStart must be < composition duration (" + compDur + "s)"); }
            if (waDur <= 0)  { throw _err(ERROR_CODES.INVALID_ARGS, "workAreaDuration must be > 0"); }
            if (waStart + waDur > compDur) { throw _err(ERROR_CODES.INVALID_ARGS, "workAreaStart + workAreaDuration (" + (waStart + waDur) + "s) exceeds composition duration (" + compDur + "s)"); }
        }

        // Pre-parse + validate resolutionFactor before any mutation — a malformed value would
        // otherwise throw mid-sequence after name/duration/etc. were already applied.
        var rfParsed = null;
        if (args.resolutionFactor !== undefined && args.resolutionFactor !== null) {
            rfParsed = args.resolutionFactor;
            if (typeof rfParsed === "string") { try { rfParsed = eval("(" + rfParsed + ")"); } catch (e) { rfParsed = null; } }
            if (!rfParsed || typeof rfParsed.length !== "number" || rfParsed.length < 2) {
                throw _err(ERROR_CODES.INVALID_ARGS, "resolutionFactor must be a 2-element array, e.g. [1,1] (full) or [2,2] (half).");
            }
        }

        // Capture prior state for revert (only for fields the args touch)
        var previousValues = {};
        if (args.name !== undefined && args.name !== null) { previousValues.name = comp.name; }
        if (args.duration !== undefined && args.duration !== null) { previousValues.duration = comp.duration; }
        if (args.frameRate !== undefined && args.frameRate !== null) { previousValues.frameRate = comp.frameRate; }
        if (hasW && hasH) { previousValues.width = comp.width; previousValues.height = comp.height; }
        if (args.backgroundColor !== undefined && args.backgroundColor !== null) { previousValues.backgroundColor = comp.bgColor; }
        if (hasWorkAreaStart)    { previousValues.workAreaStart    = comp.workAreaStart; }
        if (hasWorkAreaDuration) { previousValues.workAreaDuration = comp.workAreaDuration; }
        if (args.displayStartTime !== undefined && args.displayStartTime !== null) { previousValues.displayStartTime = comp.displayStartTime; }
        if (args.resolutionFactor !== undefined && args.resolutionFactor !== null) { previousValues.resolutionFactor = comp.resolutionFactor; }
        if (args.shutterAngle     !== undefined && args.shutterAngle     !== null) { previousValues.shutterAngle     = comp.shutterAngle; }
        if (args.shutterPhase     !== undefined && args.shutterPhase     !== null) { previousValues.shutterPhase     = comp.shutterPhase; }
        if (args.motionBlur       !== undefined && args.motionBlur       !== null) { previousValues.motionBlur       = comp.motionBlur; }
        if (args.draft3d          !== undefined && args.draft3d          !== null) { previousValues.draft3d          = comp.draft3d; }

        var changed = [];
        if (args.name !== undefined && args.name !== null) { comp.name = args.name; changed.push("name"); }
        if (args.duration !== undefined && args.duration !== null) { comp.duration = parseFloat(args.duration); changed.push("duration"); }
        if (args.frameRate !== undefined && args.frameRate !== null) { comp.frameRate = parseFloat(args.frameRate); changed.push("frameRate"); }
        if (hasW && hasH) { comp.width = parseInt(args.width); comp.height = parseInt(args.height); changed.push("dimensions"); }
        if (args.backgroundColor !== undefined && args.backgroundColor !== null) {
            comp.bgColor = [args.backgroundColor.r / 255, args.backgroundColor.g / 255, args.backgroundColor.b / 255];
            changed.push("backgroundColor");
        }
        if (hasWorkAreaStart)    { comp.workAreaStart    = parseFloat(args.workAreaStart);    changed.push("workAreaStart"); }
        if (hasWorkAreaDuration) { comp.workAreaDuration = parseFloat(args.workAreaDuration); changed.push("workAreaDuration"); }
        if (args.displayStartTime !== undefined && args.displayStartTime !== null) { comp.displayStartTime = parseFloat(args.displayStartTime); changed.push("displayStartTime"); }
        if (rfParsed !== null) { comp.resolutionFactor = rfParsed; changed.push("resolutionFactor"); }
        if (args.shutterAngle !== undefined && args.shutterAngle !== null) {
            comp.shutterAngle = Math.max(0, Math.min(720, parseInt(args.shutterAngle)));
            changed.push("shutterAngle");
        }
        if (args.shutterPhase !== undefined && args.shutterPhase !== null) {
            comp.shutterPhase = Math.max(-360, Math.min(360, parseInt(args.shutterPhase)));
            changed.push("shutterPhase");
        }
        if (args.motionBlur !== undefined && args.motionBlur !== null) { comp.motionBlur = !!args.motionBlur; changed.push("motionBlur"); }
        if (args.draft3d    !== undefined && args.draft3d    !== null) { comp.draft3d    = !!args.draft3d;    changed.push("draft3d"); }

        return JSON.stringify({
            status: "success",
            composition: {
                name: comp.name, duration: comp.duration, frameRate: comp.frameRate,
                width: comp.width, height: comp.height, bgColor: comp.bgColor,
                workAreaStart: comp.workAreaStart, workAreaDuration: comp.workAreaDuration,
                displayStartTime: comp.displayStartTime, resolutionFactor: comp.resolutionFactor,
                shutterAngle: comp.shutterAngle, shutterPhase: comp.shutterPhase,
                motionBlur: comp.motionBlur, draft3d: comp.draft3d
            },
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

// C: duplicateComposition — duplicate a comp, optionally recursing into all nested pre-comps.
// deep:false (default) — shallow duplicate via CompItem.duplicate().
// deep:true — DFS collects all transitively referenced ComItems; duplicates each leaf-first;
//             remaps layer.source references inside all new comps to point to their new counterparts.
function duplicateComposition(args) {
    try {
        var comp = _resolveComp(args);
        var newName = args.newName;
        var deep    = args.deep === true;

        if (!deep) {
            var dup = comp.duplicate();
            if (newName) dup.name = newName;
            return JSON.stringify({
                status: "success",
                message: "Composition duplicated.",
                original:  { id: comp.id, name: comp.name },
                duplicate: { id: dup.id,  name: dup.name  }
            }, null, 2);
        }

        // Deep mode: collect all nested comps in post-order (leaves first)
        var visited = {};
        var orderedComps = [];

        function collectComps(c) {
            if (visited[c.id]) return;
            visited[c.id] = true;
            for (var li = 1; li <= c.numLayers; li++) {
                var src = null;
                try { src = c.layer(li).source; } catch(e) {}
                if (src && src instanceof CompItem) collectComps(src);
            }
            orderedComps.push(c);
        }
        collectComps(comp);

        // Duplicate each (leaf-first) and build original.id → new CompItem map
        var idMap = {};
        var duplicatedIds = [];
        for (var j = 0; j < orderedComps.length; j++) {
            var orig = orderedComps[j];
            var d = orig.duplicate();
            idMap[orig.id] = d;
            duplicatedIds.push(d.id);
        }

        // Rename root duplicate
        var rootDup = idMap[comp.id];
        rootDup.name = newName || (comp.name + " copy");

        // Remap nested comp layer sources in all duplicated comps
        for (var k = 0; k < orderedComps.length; k++) {
            var dupComp = idMap[orderedComps[k].id];
            for (var li2 = 1; li2 <= dupComp.numLayers; li2++) {
                var lsrc = null;
                try { lsrc = dupComp.layer(li2).source; } catch(e) {}
                if (lsrc && lsrc instanceof CompItem && idMap[lsrc.id]) {
                    try { dupComp.layer(li2).replaceSource(idMap[lsrc.id], false); } catch(e) {}
                }
            }
        }

        return JSON.stringify({
            status: "success",
            message: "Deep composition duplicate created (" + orderedComps.length + " comp(s) duplicated).",
            original:      { id: comp.id,    name: comp.name    },
            rootDuplicate: { id: rootDup.id, name: rootDup.name },
            duplicatedCompIds: duplicatedIds
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
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
