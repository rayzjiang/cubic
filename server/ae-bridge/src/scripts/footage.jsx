// footage.jsx
// CRUD for project-level FootageItem objects (imported files, solids, placeholders).
// Note: solid LAYERS are created via createSolidLayer in layers.jsx — this file
// manages the footage sources in the project panel, not the layers that reference them.
// CRUD: C ✓  R ✓  U ✗  D ✓
// importAssetToComp: one-shot import + place (composes importFootage + addFootageToComp)

// R: listProjectItems — enumerate Project Panel contents (footage, comps, folders, solids)
function listProjectItems(args) {
    try {
        var typeFilter = args && args.type ? args.type : null; // optional: "footage"|"composition"|"folder"|"solid"
        var items = [];
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            var itemType;
            var info = { id: item.id, name: item.name, itemIndex: i };

            if (item instanceof CompItem) {
                itemType = "composition";
                info.width = item.width; info.height = item.height;
                info.duration = item.duration; info.frameRate = item.frameRate;
                info.numLayers = item.numLayers;
            } else if (item instanceof FolderItem) {
                itemType = "folder";
                info.numItems = item.numItems;
            } else if (item instanceof FootageItem) {
                if (item.mainSource instanceof SolidSource) {
                    itemType = "solid";
                    info.color = item.mainSource.color;
                } else {
                    itemType = "footage";
                    info.path = item.file ? item.file.fsName : null;
                    info.width = item.width; info.height = item.height;
                    info.duration = item.duration;
                    info.hasVideo = item.hasVideo; info.hasAudio = item.hasAudio;
                }
            } else {
                itemType = "unknown";
            }

            info.type = itemType;
            if (!typeFilter || typeFilter === itemType) { items.push(info); }
        }
        return JSON.stringify({ status: "success", items: items, count: items.length }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: importFootage — import a file from disk into the project panel
function importFootage(args) {
    try {
        if (!args || !args.filePath) { throw _err(ERROR_CODES.INVALID_ARGS, "filePath is required"); }
        var f = new File(args.filePath);
        if (!f.exists) { throw _err(ERROR_CODES.INVALID_ARGS, "File not found: " + args.filePath); }

        var importOptions = new ImportOptions(f);
        if (args.sequence === true) { importOptions.sequence = true; }
        var imported = app.project.importFile(importOptions);

        return JSON.stringify({
            status: "success",
            message: "Footage imported",
            item: {
                id: imported.id,
                name: imported.name,
                type: "footage",
                path: imported.file ? imported.file.fsName : null,
                width: imported.width,
                height: imported.height,
                duration: imported.duration,
                hasVideo: imported.hasVideo,
                hasAudio: imported.hasAudio
            }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: addFootageToComp — place a project-panel item onto a comp's timeline as an AVLayer
function addFootageToComp(args) {
    try {
        var comp = _resolveComp(args);

        // Resolve source: by itemId, itemName, or itemIndex
        var source = null;
        if (args.itemId !== undefined && args.itemId !== null) {
            for (var j = 1; j <= app.project.numItems; j++) {
                if (app.project.item(j).id === args.itemId) { source = app.project.item(j); break; }
            }
        } else if (args.itemName) {
            for (var k = 1; k <= app.project.numItems; k++) {
                if (app.project.item(k).name === args.itemName) { source = app.project.item(k); break; }
            }
        } else if (args.itemIndex !== undefined && args.itemIndex !== null) {
            if (args.itemIndex > 0 && args.itemIndex <= app.project.numItems) {
                source = app.project.item(args.itemIndex);
            }
        }
        if (!source) { throw _err(ERROR_CODES.INVALID_ARGS, "Source item not found. Specify itemName, itemId, or itemIndex."); }
        if (source instanceof FolderItem) { throw _err(ERROR_CODES.INVALID_ARGS, "Cannot add a folder to a composition."); }

        var layer = comp.layers.add(source);
        if (args.position !== undefined && args.position !== null) { layer.property("Position").setValue(args.position); }
        if (args.startTime !== undefined && args.startTime !== null) { layer.startTime = args.startTime; }
        if (args.duration !== undefined && args.duration !== null && args.duration > 0) {
            var st = (args.startTime !== undefined && args.startTime !== null) ? args.startTime : layer.startTime;
            layer.outPoint = st + args.duration;
        }
        if (args.name) { layer.name = args.name; }

        return JSON.stringify({
            status: "success",
            message: "Footage added to comp",
            layer: {
                index: layer.index,
                name: layer.name,
                inPoint: layer.inPoint,
                outPoint: layer.outPoint,
                position: layer.property("Position") ? layer.property("Position").value : null
            },
            composition: { name: comp.name }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: importAssetToComp — one-shot: import a file from disk and place it on the comp timeline.
// Combines importFootage + addFootageToComp in a single call inside one undo group.
function importAssetToComp(args) {
    try {
        if (!args.filePath) throw _err(ERROR_CODES.INVALID_ARGS, "filePath is required.");
        var f = new File(args.filePath);
        if (!f.exists) throw _err(ERROR_CODES.INVALID_ARGS, "File not found: " + args.filePath);

        var importOptions = new ImportOptions(f);
        if (args.sequence === true) importOptions.sequence = true;
        var imported = app.project.importFile(importOptions);

        var comp = _resolveComp(args);
        var layer = comp.layers.add(imported);
        if (args.position !== undefined && args.position !== null) layer.property("Position").setValue(args.position);
        if (args.startTime !== undefined && args.startTime !== null) layer.startTime = args.startTime;
        if (args.duration !== undefined && args.duration !== null && args.duration > 0) {
            var st = (args.startTime !== undefined && args.startTime !== null) ? args.startTime : layer.startTime;
            layer.outPoint = st + args.duration;
        }
        if (args.name) layer.name = args.name;

        return JSON.stringify({
            status: "success",
            message: "Asset imported and added to comp.",
            item: { id: imported.id, name: imported.name, path: imported.file ? imported.file.fsName : null },
            layer: { index: layer.index, name: layer.name, inPoint: layer.inPoint, outPoint: layer.outPoint },
            composition: { name: comp.name }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// D: deleteProjectItem — remove a footage/solid/folder item from the project panel by name or id
// Use deleteComposition for compositions (this rejects them to avoid accidental data loss).
function deleteProjectItem(args) {
    try {
        var item = null;
        if (args.itemId !== undefined && args.itemId !== null) {
            for (var i = 1; i <= app.project.numItems; i++) {
                if (app.project.item(i).id === args.itemId) { item = app.project.item(i); break; }
            }
        } else if (args.itemName) {
            for (var j = 1; j <= app.project.numItems; j++) {
                if (app.project.item(j).name === args.itemName) { item = app.project.item(j); break; }
            }
        }
        if (!item) { throw _err(ERROR_CODES.INVALID_ARGS, "Project item not found (specify itemId or itemName)"); }
        if (item instanceof CompItem) { throw _err(ERROR_CODES.INVALID_ARGS, "Use deleteComposition to remove compositions"); }
        var name = item.name;
        var id = item.id;
        item.remove();
        return JSON.stringify({ status: "success", deleted: { name: name, id: id } }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// D: deleteUnusedSolids — removes all solid footage items not referenced by any comp
function deleteUnusedSolids() {
    try {
        var removed = [];
        // iterate backwards so index shifts from remove() don't skip items
        for (var i = app.project.numItems; i >= 1; i--) {
            var item = app.project.item(i);
            if (item instanceof FootageItem && item.mainSource instanceof SolidSource) {
                if (item.usedIn.length === 0) {
                    removed.push(item.name);
                    item.remove();
                }
            }
        }
        if (removed.length === 0) {
            return JSON.stringify({ status: "noop", message: "No unused solids to remove." }, null, 2);
        }
        return JSON.stringify({ status: "success", removed: removed, count: removed.length }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}
