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

// R: checkFileAccess — detect whether AE's "Allow Scripts to Write Files and Access Network" setting is
// enabled. We READ THE PREFERENCE directly (app.preferences), which is the reliable signal. A file-write
// probe is NOT reliable: File.open("w") returns true even when the setting is OFF (the block happens at
// write time / only after a restart, not at open), so it reports a false positive. Reading the pref
// reflects the checkbox the moment the user closes Preferences — no AE restart needed to DETECT it.
// The pref lives in the machine-independent prefs file on some AE versions and reads via the default
// (machine-specific) on others, so we accept "enabled" if EITHER read reports 1 (each guarded). 1 =
// enabled. Read-only w.r.t. the AE project — drives the §D-1a onboarding gate.
function checkFileAccess() {
    try {
        var SECTION = "Main Pref Section";
        var KEY = "Pref_SCRIPTING_FILE_NETWORK_SECURITY";
        var enabled = false;
        try { enabled = app.preferences.getPrefAsLong(SECTION, KEY) === 1; } catch (e1) {}
        if (!enabled && typeof PREFType !== "undefined") {
            try { enabled = app.preferences.getPrefAsLong(SECTION, KEY, PREFType.PREF_Type_MACHINE_INDEPENDENT) === 1; } catch (e2) {}
        }
        return JSON.stringify({ status: "success", canWriteFiles: enabled }, null, 2);
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
            if (project.dirty === false) {
                return JSON.stringify({ status: "noop", message: "Project already saved — no changes." }, null, 2);
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
        var backupDir = _sessionBackupDir(src, args);             // .cubic-backups/<sessionId>/ — scoped per chat
        if (!backupDir.exists) backupDir.create();                // creates the .cubic-backups parent too

        var base = src.name.replace(/\.aep$/i, "");
        var turnId = (args && args.turnId) ? args.turnId : String((new Date()).getTime());
        var backupFile = new File(backupDir.fsName + "/" + base + "." + turnId + ".aep");
        if (!src.copy(backupFile.fsName)) {
            throw _err(ERROR_CODES.INTERNAL_ERROR, "Failed to copy project to backup path: " + backupFile.fsName);
        }

        // Prune to the most recent N backups for THIS chat (default 10) — the folder is already
        // session-scoped. turnId is a fixed-width ms timestamp, so a name sort is also chronological.
        // ALWAYS keep the OLDEST backup (the chat's original-state snapshot, index length-1): it's the
        // "restore to before the first request" point — a full reset of every Cubic change — which must
        // stay available no matter how long the chat runs. Only the middle band [keep .. length-2] is
        // pruned. (Deeper per-turn rewind beyond N is the separately-tracked size/diff limitation.)
        var keep = (args && args.keep) ? parseInt(args.keep, 10) : 10;
        var prefix = base + ".";
        var backups = backupDir.getFiles(function (f) {
            return (f instanceof File) && f.name.indexOf(prefix) === 0 && /\.aep$/i.test(f.name);
        });
        backups.sort(function (a, b) { return a.name < b.name ? 1 : (a.name > b.name ? -1 : 0); });
        for (var i = keep; i < backups.length - 1; i++) {
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

// Byte-equality test used by no-args restore to skip backups identical to the working file.
// Size first (instant, and the only check needed when sizes differ); a full binary read+compare
// runs only on a size match — which is exactly the undo turn's own snapshot (an exact file copy).
function _filesEqual(a, b) {
    if (!a.exists || !b.exists) return false;
    if (a.length !== b.length) return false;
    a.encoding = "BINARY";
    b.encoding = "BINARY";
    if (!a.open("r")) return false;
    var ca = a.read(); a.close();
    if (!b.open("r")) return false;
    var cb = b.read(); b.close();
    return ca === cb;
}

// R/U: restoreProject — revert the project to a pre-turn backup created by backupProject.
// Copies the chosen `.cubic-backups/` .aep back OVER the working file on disk, then drops the
// in-memory project and reopens the working path. We overwrite-then-reopen (rather than
// app.open(backup)) on purpose: opening the backup directly would repoint the live project at
// the backup path, hijacking the user's file — the same trap backupProject's copy avoids.
// close(DO_NOT_SAVE_CHANGES) discards the current state with no save dialog (that discard is
// exactly what "undo that" means). args = { turnId?: string, backupPath?: string }.
//
// No-args = "undo that": the agent loop already snapshotted the CURRENT state before this turn,
// so the newest backup(s) are byte-identical to the working file. We can't just grab backups[0]
// (that's the no-op bug — restoring current onto current). Instead we walk newest→oldest and land
// on the first backup whose CONTENTS differ — the real prior state — then PRUNE everything newer
// than it. The prune is what makes repeated "undo that" walk strictly backward (linear, one-way —
// there is no redo): without it, the just-restored state would still sit on disk and a second undo
// would bounce forward to the redo copy instead of further back. turnId/backupPath stay raw
// (restore exactly that backup, no diff, no prune) as an explicit escape hatch.
function restoreProject(args) {
    try {
        var project = app.project;
        if (!project.file) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Project has never been saved, so there is nothing to restore.");
        }

        var working = project.file;                               // File at the real working path
        var base = working.name.replace(/\.aep$/i, "");
        var backupDir = _sessionBackupDir(working, args);         // scope undo to THIS chat's backups only

        var backupFile = null;
        var prune = [];                                           // backups newer than the target (no-args undo only)
        if (args && args.backupPath) {
            backupFile = new File(args.backupPath);
        } else {
            // turnId is a fixed-width ms timestamp, so a name sort is also a chronological sort. A
            // missing session folder = no backups for this chat → empty list (no-args undo then returns
            // the "nothing left to undo" noop below; an explicit turnId throws not-found).
            var prefix = base + ".";
            var backups = backupDir.exists ? backupDir.getFiles(function (f) {
                return (f instanceof File) && f.name.indexOf(prefix) === 0 && /\.aep$/i.test(f.name);
            }) : [];
            backups.sort(function (a, b) { return a.name < b.name ? 1 : (a.name > b.name ? -1 : 0); });
            if (args && args.turnId) {
                var needle = "." + args.turnId + ".aep";
                for (var i = 0; i < backups.length; i++) {
                    if (backups[i].name.length >= needle.length &&
                        backups[i].name.substring(backups[i].name.length - needle.length) === needle) {
                        backupFile = backups[i];
                        // args.prune (set by the UI "restore to before this request"): discard the
                        // backups NEWER than the target too, so the rewind is one-way (no redo) like
                        // the no-args undo. The agent never sets prune (it uses the no-args undo).
                        if (args.prune) prune = backups.slice(0, i);
                        break;
                    }
                }
                if (!backupFile) {
                    throw _err(ERROR_CODES.INVALID_ARGS, "No backup found for turnId " + args.turnId + ".");
                }
            } else {
                for (var j = 0; j < backups.length; j++) {
                    if (!_filesEqual(backups[j], working)) {
                        backupFile = backups[j];                  // most recent state that differs from current
                        prune = backups.slice(0, j);              // the own-turn snapshot + any redundant copies
                        break;
                    }
                }
                if (!backupFile) {
                    return JSON.stringify({
                        status: "noop",
                        message: "Already at the earliest restore point — nothing left to undo."
                    }, null, 2);
                }
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

        // Discard the abandoned "future" so the next undo can only step further back (one-way rewind).
        for (var k = 0; k < prune.length; k++) {
            if (prune[k].exists) prune[k].remove();
        }

        return JSON.stringify({
            status: "success",
            restoredPath: workingPath,
            backupPath: backupFile.fsName
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: openProject — replace the open project with the .aep at args.path. Drives AE from the Cubic UI
// (the "Open <project> in After Effects" bar action) so Cubic mirrors AE rather than showing a project
// that isn't open. args = { path: string, save: "save" | "discard" }. The CALLER (agentChat) resolves
// the unsaved-changes decision first and passes it as `save`, because AE's own "save changes?" dialog on
// close would block evalScript and hang the bridge — so we never let it prompt: a "save" decision flushes
// the current project explicitly (only possible when it has a file), then we always close DO_NOT_SAVE.
// Internal-only — intentionally absent from the command registry/catalog (not a model tool).
function openProject(args) {
    try {
        if (!args || !args.path) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Missing required argument 'path'.");
        }
        var file = new File(args.path);
        if (!file.exists) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Project file not found: " + args.path);
        }
        var project = app.project;
        // Flush the current project to disk when the user chose "save" — only a project that already has a
        // file can be saved silently (an untitled one would open a Save-As dialog; the UI hides that option).
        if (args.save === "save" && project.file) project.save();
        // Drop the current project without a save dialog, then load the requested one from disk.
        project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
        app.open(file);

        return JSON.stringify({
            status: "success",
            openedPath: file.fsName
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}
