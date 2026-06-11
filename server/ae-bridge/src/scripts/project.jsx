// project.jsx
// CRUD: C –  R ✓  U ✓ (saveProject writes to disk)  D –


// R: getProjectPath — return project file path + dirty flag
function getProjectPath() {
    try {
        var project = app.project;
        return JSON.stringify({
            status: "success",
            path:  project.file ? project.file.fsName : null,
            name:  project.file ? project.file.name   : null,
            dirty: project.dirty
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: saveProject — save the current project; pass saveAs (fsName) to save as a new file
function saveProject(args) {
    try {
        var project = app.project;
        var saveAsPath = (args && args.saveAs) ? args.saveAs : null;

        if (saveAsPath) {
            project.save(new File(saveAsPath));
        } else {
            if (!project.file) {
                throw _err(ERROR_CODES.INVALID_ARGS, "Project has never been saved. Pass saveAs with an absolute file path (e.g. '/Users/you/my-project.aep').");
            }
            project.save();
        }

        return JSON.stringify({
            status: "success",
            message: "Project saved.",
            path: project.file ? project.file.fsName : null,
            name: project.file ? project.file.name   : null
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U/R: backupProject — pre-turn revert point for the agent loop. Flushes current edits
// to the working file, then COPIES the .aep into a `.cubic-backups/` sibling folder.
// We copy on the filesystem rather than project.save(new File(...)) on purpose: a
// Save-As would repoint the live project at the backup path, hijacking the user's file.
// Internal-only — intentionally absent from the command registry/catalog (not a model tool).
function backupProject(args) {
    try {
        var project = app.project;
        if (!project.file) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Project has never been saved. Save it once (Cmd+S) so Cubic can create a revert point before editing.");
        }
        // Flush current edits so the backup captures the true pre-turn state — but only
        // when dirty. A clean project already matches disk, so skip the save (and AE's
        // save-progress popup, which has no silent flag and fires on every save()).
        if (project.dirty) project.save();

        var src = project.file;                                   // File
        var backupDir = new Folder(src.parent.fsName + "/.cubic-backups");
        if (!backupDir.exists) backupDir.create();

        var base = src.name.replace(/\.aep$/i, "");
        var turnId = (args && args.turnId) ? args.turnId : String((new Date()).getTime());
        var backupFile = new File(backupDir.fsName + "/" + base + "." + turnId + ".aep");
        if (!src.copy(backupFile.fsName)) {
            throw _err(ERROR_CODES.INTERNAL_ERROR, "Failed to copy project to backup path: " + backupFile.fsName);
        }

        // Prune to the most recent N backups for this project (default 10). turnId is a
        // fixed-width ms timestamp, so a name sort is also a chronological sort.
        var keep = (args && args.keep) ? parseInt(args.keep, 10) : 10;
        var prefix = base + ".";
        var backups = backupDir.getFiles(function (f) {
            return (f instanceof File) && f.name.indexOf(prefix) === 0 && /\.aep$/i.test(f.name);
        });
        backups.sort(function (a, b) { return a.name < b.name ? 1 : (a.name > b.name ? -1 : 0); });
        for (var i = keep; i < backups.length; i++) {
            backups[i].remove();
        }

        return JSON.stringify({
            status: "success",
            backupPath: backupFile.fsName,
            kept: Math.min(keep, backups.length)
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// R/U: restoreProject — revert the project to a pre-turn backup created by backupProject.
// Copies the chosen `.cubic-backups/` .aep back OVER the working file on disk, then drops the
// in-memory project and reopens the working path. We overwrite-then-reopen (rather than
// app.open(backup)) on purpose: opening the backup directly would repoint the live project at
// the backup path, hijacking the user's file — the same trap backupProject's copy avoids.
// close(DO_NOT_SAVE_CHANGES) discards the current state with no save dialog (that discard is
// exactly what "undo that" means). args = { turnId?: string, backupPath?: string }.
function restoreProject(args) {
    try {
        var project = app.project;
        if (!project.file) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Project has never been saved, so there is nothing to restore.");
        }

        var working = project.file;                               // File at the real working path
        var base = working.name.replace(/\.aep$/i, "");
        var backupDir = new Folder(working.parent.fsName + "/.cubic-backups");

        var backupFile = null;
        if (args && args.backupPath) {
            backupFile = new File(args.backupPath);
        } else {
            if (!backupDir.exists) {
                throw _err(ERROR_CODES.INVALID_ARGS, "No backups found for this project yet.");
            }
            // turnId is a fixed-width ms timestamp, so a name sort is also a chronological sort.
            var prefix = base + ".";
            var backups = backupDir.getFiles(function (f) {
                return (f instanceof File) && f.name.indexOf(prefix) === 0 && /\.aep$/i.test(f.name);
            });
            backups.sort(function (a, b) { return a.name < b.name ? 1 : (a.name > b.name ? -1 : 0); });
            if (args && args.turnId) {
                var needle = "." + args.turnId + ".aep";
                for (var i = 0; i < backups.length; i++) {
                    if (backups[i].name.length >= needle.length &&
                        backups[i].name.substring(backups[i].name.length - needle.length) === needle) {
                        backupFile = backups[i];
                        break;
                    }
                }
                if (!backupFile) {
                    throw _err(ERROR_CODES.INVALID_ARGS, "No backup found for turnId " + args.turnId + ".");
                }
            } else {
                backupFile = backups.length ? backups[0] : null;   // most recent
            }
        }

        if (!backupFile || !backupFile.exists) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Backup file not found.");
        }

        var workingPath = working.fsName;
        if (!backupFile.copy(workingPath)) {
            throw _err(ERROR_CODES.INTERNAL_ERROR, "Failed to copy backup over the working file: " + workingPath);
        }
        // Drop the (now stale) in-memory project without a save dialog, then reload from disk.
        project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
        app.open(new File(workingPath));

        return JSON.stringify({
            status: "success",
            restoredPath: workingPath,
            backupPath: backupFile.fsName
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}
