// footage.jsx
// CRUD for project-level FootageItem objects (imported files, solids, placeholders).
// Note: solid LAYERS are created via createSolidLayer in layers.jsx — this file
// manages the footage sources in the project panel, not the layers that reference them.
// CRUD: C ✓  R ✓  U ✓  D ✓
// importAssetToComp: one-shot import + place (composes importFootage + addFootageToComp)

// R: listProjectItems — enumerate Project Panel contents (footage, comps, folders, solids)
function listProjectItems(args) {
    try {
        var typeFilter = args && args.type ? args.type : null; // optional: "footage"|"composition"|"folder"|"solid"
        var items = [];
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            var itemType;
            var atRoot = (item.parentFolder === app.project.rootFolder);
            var info = {
                id: item.id, name: item.name, itemIndex: i,
                parentId:   atRoot ? 0 : item.parentFolder.id,
                parentName: atRoot ? null : item.parentFolder.name
            };

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

        // Resolve source by itemId (exact), itemName (must be unique), or itemIndex.
        var source = _findProjectItem(args.itemId, args.itemName, args.itemIndex);
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
        var item = _findProjectItem(args.itemId, args.itemName); // exact id or unique name
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

// C: createFolder — create a folder at the project ROOT. Finder-style auto-suffix on a root-sibling
// name collision ("Assets" -> "Assets (1)"); never replaces an existing item.
function createFolder(args) {
    try {
        if (!args || !args.name) { throw _err(ERROR_CODES.INVALID_ARGS, "name is required."); }
        var root = app.project.rootFolder;
        var requested = args.name;
        var finalName = _freeSiblingName(root, requested, null);

        var folder = app.project.items.addFolder(finalName); // lands at root automatically

        var renamed = (finalName !== requested);
        var result = {
            status: "success",
            message: "Folder created",
            folder: { id: folder.id, name: folder.name, parentId: 0, parentName: null },
            renamed: renamed
        };
        if (renamed) { result.warning = "A folder named \"" + requested + "\" already existed, so this one was named \"" + finalName + "\"."; }
        return JSON.stringify(result, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: updateProjectItem — rename and/or move any project item (footage/solid/folder/comp).
// Target by itemId (exact) or itemName (must be unique). Move with parentFolderId/parentFolderName
// (parentFolderId 0 = project root). Name collisions are scoped to the destination's siblings:
// onNameConflict "suffix" (default) auto-numbers; "replace" deletes a same-named LEAF sibling
// (footage/comp) — but a same-named FOLDER is never deleted (refused). No-op when nothing changes.
function updateProjectItem(args) {
    try {
        var item = _findProjectItem(args.itemId, args.itemName); // exact id or unique name
        var origName = item.name;
        var origParent = item.parentFolder;

        var mode = args.onNameConflict || "suffix";
        if (mode !== "suffix" && mode !== "replace") {
            throw _err(ERROR_CODES.INVALID_ARGS, "onNameConflict must be \"suffix\" or \"replace\".");
        }

        var hasNewName = (args.newName !== undefined && args.newName !== null && args.newName !== "");
        var wantsMove  = (args.parentFolderId !== undefined && args.parentFolderId !== null) ||
                         (args.parentFolderName !== undefined && args.parentFolderName !== null && args.parentFolderName !== "");
        if (!hasNewName && !wantsMove) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Provide newName and/or a parent target (parentFolderId/parentFolderName).");
        }

        // ---- MOVE first, so a rename collision is scoped to the destination folder ----
        if (wantsMove) {
            var destFolder;
            if (args.parentFolderId === 0) {
                destFolder = app.project.rootFolder; // sentinel: 0 => project root
            } else {
                destFolder = _findProjectItem(args.parentFolderId, args.parentFolderName, null, { requireFolder: true, missingMsg: "Specify parentFolderId or parentFolderName." });
            }
            // Cycle guard: a folder can't move into itself or one of its descendants.
            if (item instanceof FolderItem) {
                if (destFolder === item) {
                    throw _err(ERROR_CODES.INVALID_ARGS, "Cannot move folder \"" + item.name + "\" into itself.");
                }
                var cur = destFolder.parentFolder;
                while (cur && cur !== app.project.rootFolder) {
                    if (cur === item) {
                        throw _err(ERROR_CODES.INVALID_ARGS, "Cannot move folder \"" + item.name + "\" into one of its own subfolders.");
                    }
                    cur = cur.parentFolder;
                }
            }
            if (destFolder !== item.parentFolder) { item.parentFolder = destFolder; }
        }

        // ---- RENAME / post-move name reconciliation (scope = item's current parent) ----
        var suffixedFrom = null; // the name we wanted but couldn't take verbatim (drives the warning)
        if (hasNewName || item.parentFolder !== origParent) {
            var parentNow = item.parentFolder;
            var targetName = hasNewName ? args.newName : item.name;
            var clash = _siblingNamed(parentNow, targetName, item);
            if (clash) {
                if (mode === "replace") {
                    if (!_isCollisionDeletableLeaf(clash)) {
                        throw _err(ERROR_CODES.INVALID_ARGS, "A folder named \"" + targetName + "\" already exists here. Folders are never replaced — rename or delete it explicitly first.");
                    }
                    clash.remove();
                    item.name = targetName;
                } else {
                    var freeName = _freeSiblingName(parentNow, targetName, item);
                    if (freeName !== targetName) { suffixedFrom = targetName; }
                    item.name = freeName;
                }
            } else if (targetName !== item.name) {
                item.name = targetName;
            }
        }

        var didMove   = (item.parentFolder !== origParent);
        var didRename = (item.name !== origName);
        if (!didMove && !didRename) {
            return JSON.stringify({ status: "noop", message: "No change — already named that and in that folder." }, null, 2);
        }

        var pNow = item.parentFolder;
        var nowAtRoot = (pNow === app.project.rootFolder);
        var result = {
            status: "success",
            message: "Project item updated",
            item: {
                id: item.id, name: item.name,
                parentId:   nowAtRoot ? 0 : pNow.id,
                parentName: nowAtRoot ? null : pNow.name
            },
            renamed: didRename,
            moved: didMove
        };
        if (suffixedFrom !== null) {
            result.warning = "An item named \"" + suffixedFrom + "\" already existed there, so this item was named \"" + item.name + "\".";
        }
        return JSON.stringify(result, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}
