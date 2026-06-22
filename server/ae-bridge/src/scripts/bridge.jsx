// bridge.jsx
// Pure-function dispatch module — no UI, no file I/O, no polling.
// Concatenated with domain files by build-cep-extension.mjs at build time.
// Called by the CEP panel via CSInterface.evalScript.


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

// Deep value-equality with float tolerance — used by set* handlers to detect a no-op write (the
// property already holds the requested value, so the call changes nothing). Compare PARSED values
// (callers eval the "[x,y]"-as-string quirk first). Numbers compare within EPS because AE round-trips
// floats imperfectly; arrays (Position/Scale/Color) compare element-wise; everything else is strict.
// Mismatched shapes (array vs scalar, different lengths) are never equal.
function _valuesEqual(a, b) {
    var EPS = 1e-6;
    var aArr = (a instanceof Array), bArr = (b instanceof Array);
    if (aArr || bArr) {
        if (!aArr || !bArr || a.length !== b.length) { return false; }
        for (var i = 0; i < a.length; i++) {
            if (!_valuesEqual(a[i], b[i])) { return false; }
        }
        return true;
    }
    if (typeof a === "number" && typeof b === "number") {
        return Math.abs(a - b) <= EPS;
    }
    return a === b;
}

// Validate-first helper: returns map[value], or throws a self-healing INVALID_ARGS listing the
// valid keys if `value` isn't one of them. Use BEFORE mutating so a bad enum can't leave a
// partial update (and the model learns the valid options instead of a silent no-op).
function _requireEnum(value, map, label) {
    if (map[value] === undefined) {
        var keys = [];
        for (var k in map) { if (map.hasOwnProperty(k)) { keys.push(k); } }
        throw _err(ERROR_CODES.INVALID_ARGS, label + " '" + value + "' is invalid. Valid: " + keys.join(", ") + ".");
    }
    return map[value];
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

// Resolves a single project-panel item by id (exact), name (must be unique), or 1-based index.
// Takes the values directly (NOT args) so each caller reads its own args.X literally — keeps the
// drift guard's param check honest. An ambiguous name (>1 match) throws INVALID_ARGS listing the
// candidate ids so the caller can disambiguate by id; no match throws too. opts.requireFolder forces
// the result to be a FolderItem (for parent resolution). Throws, never returns null.
function _findProjectItem(idVal, nameVal, indexVal, opts) {
    opts = opts || {};
    var item = null;

    if (idVal !== undefined && idVal !== null) {
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).id === idVal) { item = app.project.item(i); break; }
        }
        if (!item) { throw _err(ERROR_CODES.INVALID_ARGS, "No project item with id " + idVal + "."); }
    } else if (nameVal) {
        var matches = [];
        for (var j = 1; j <= app.project.numItems; j++) {
            if (app.project.item(j).name === nameVal) { matches.push(app.project.item(j)); }
        }
        if (matches.length === 0) { throw _err(ERROR_CODES.INVALID_ARGS, "No project item named \"" + nameVal + "\"."); }
        if (matches.length > 1) {
            var ids = [];
            for (var m = 0; m < matches.length; m++) { ids.push(matches[m].id); }
            throw _err(ERROR_CODES.INVALID_ARGS, "Multiple items named \"" + nameVal + "\" — specify it by id: [" + ids.join(", ") + "].");
        }
        item = matches[0];
    } else if (indexVal !== undefined && indexVal !== null) {
        if (indexVal > 0 && indexVal <= app.project.numItems) { item = app.project.item(indexVal); }
        if (!item) { throw _err(ERROR_CODES.INVALID_ARGS, "Item index out of range: " + indexVal + "."); }
    } else {
        throw _err(ERROR_CODES.INVALID_ARGS, opts.missingMsg || "Specify itemId, itemName, or itemIndex.");
    }

    if (opts.requireFolder && !(item instanceof FolderItem)) {
        throw _err(ERROR_CODES.INVALID_ARGS, "\"" + item.name + "\" is not a folder.");
    }
    return item;
}

// True if `item` may be deleted to resolve a name collision (a leaf source/comp) — NEVER a folder,
// so a rename/move can't silently destroy a folder's contents as a side effect (only an explicit
// deleteProjectItem removes folders).
function _isCollisionDeletableLeaf(item) {
    return (item instanceof FootageItem) || (item instanceof CompItem);
}

// First same-named sibling inside `folder`, EXCLUDING `exceptItem` (the item being renamed/moved, so
// it never collides with itself). null if none. Works for app.project.rootFolder too (it is a FolderItem).
function _siblingNamed(folder, name, exceptItem) {
    for (var i = 1; i <= folder.numItems; i++) {
        var sib = folder.item(i);
        if (sib === exceptItem) { continue; }
        if (sib.name === name) { return sib; }
    }
    return null;
}

// Finder/Explorer-style free name: "Assets" -> "Assets (1)" -> "Assets (2)" (smallest free N).
// Returns `base` unchanged when it's already free among `folder`'s siblings (ignoring `exceptItem`).
function _freeSiblingName(folder, base, exceptItem) {
    if (!_siblingNamed(folder, base, exceptItem)) { return base; }
    var n = 1;
    while (true) {
        var candidate = base + " (" + n + ")";
        if (!_siblingNamed(folder, candidate, exceptItem)) { return candidate; }
        n++;
    }
}

// Per-chat backup folder: .cubic-backups/<sessionId>/ next to the working .aep. Scoping each chat's
// pre-turn snapshots to its own folder is what keeps "undo that" from walking into a DIFFERENT
// conversation's backups (see backupProject/restoreProject). sessionId is sanitized to a filesystem-safe
// token; absent → "default" (the legacy single-session / unset path). Used by both backup + restore so
// they always agree on the location. Returns a Folder (not yet created).
function _sessionBackupDir(projectFile, args) {
    var root = projectFile.parent.fsName + "/.cubic-backups";
    var id = (args && args.sessionId) ? String(args.sessionId).replace(/[^a-zA-Z0-9_-]/g, "-") : "default";
    return new Folder(root + "/" + id);
}

// AE's UI flattens certain container groups; paths address their children directly. Shared by the
// path resolver (transparent fallback) and the keyframeable-children walker (skip these levels when
// emitting paths) so both agree on which levels are invisible — single source of truth.
var IMPLICIT_CONTAINERS = ["Contents", "ADBE Text Animator Properties", "ADBE Text Selectors"];

// Container groups the configurable-children walker skips entirely (never recurses into or emits):
// AE plumbing the agent almost never adjusts. Matched by display name (English) — no new matchNames,
// so test:matchnames is unaffected. "Compositing Options" hangs off every effect (Effect Opacity,
// GPU Rendering, …); "Audio"/"Marker" hang off layers.
var SKIP_CONTAINERS = ["Compositing Options", "Audio", "Marker"];

// Walks a property path array on a layer (e.g. ["Contents","Group 1","Trim Paths 1","Start"]).
// Throws with path context on missing step.
function _resolvePropertyByPath(layer, propertyPath) {
    if (!propertyPath || propertyPath.length === 0) {
        throw _err(ERROR_CODES.INVALID_ARGS, "propertyPath must be a non-empty array.");
    }
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

// Some property values are live AE objects (TextDocument, Shape, MarkerValue, …), not scalars.
// Emitting one as `v` crashes the JSON polyfill: enumerating it touches getters that throw — a
// point-text TextDocument's box getters raise "Text document not of Box document type", which
// aborts the whole response. configurableProperties advertises settable PATHS, not live values, so
// we keep only JSON-safe scalars / number-arrays here; current values come from getLayerProperty.
function _isJsonSafeValue(v) {
    if (v === null) { return true; }
    var t = typeof v;
    if (t === "number" || t === "string" || t === "boolean") { return true; }
    if (v instanceof Array) {
        for (var i = 0; i < v.length; i++) { if (!_isJsonSafeValue(v[i])) { return false; } }
        return true;
    }
    return false;
}

// Walks the subtree under `rootProp` and returns every SETTABLE leaf, token-lean, as
// { n:name, p:path, k:keyframeable, v:value[, nk:numKeys] }. A leaf is settable when it exposes
// setValue (mirrors setLayerProperty's guard), so the agent can drive it with no guessing — animatable
// entries (k:true) via setLayerKeyframe, the rest (dropdowns/checkboxes/menus) via setLayerProperty.
// `p` is the UI-style display-name array that _resolvePropertyByPath accepts (implicit-container levels
// are skipped, NOT appended), used verbatim. `rootPath` is the path prefix of `rootProp` itself
// (e.g. ["Text","Animators",<animatorName>] or ["Effects",<effectName>]). SKIP_CONTAINERS subtrees are
// omitted (AE plumbing), entries are de-duped by path, and depth/count are bounded; if the count cap is
// hit, a final { n:"(truncated)", truncated:true } sentinel signals the list is incomplete.
function _configurableChildren(rootProp, rootPath) {
    var out = [];
    var seen = {};
    var MAX_DEPTH = 8;
    var MAX_ENTRIES = 80;
    var truncated = false;
    function inList(name, list) {
        for (var c = 0; c < list.length; c++) { if (list[c] === name) { return true; } }
        return false;
    }
    function isImplicit(prop) {
        var mn = null;
        try { mn = prop.matchName; } catch (e) {}
        return mn ? inList(mn, IMPLICIT_CONTAINERS) : false;
    }
    function isSkipped(prop) {
        var nm = null;
        try { nm = prop.name; } catch (e) {}
        return nm ? inList(nm, SKIP_CONTAINERS) : false;
    }
    function walk(group, path, depth) {
        if (depth > MAX_DEPTH || out.length >= MAX_ENTRIES) { return; }
        // Transform-first at the layer root: AE's native order puts Text/Masks/Effects before Transform,
        // so an unscoped pull that hits MAX_ENTRIES could shed the core transforms the agent needs most.
        // Walk Transform first; the leaf `seen` de-dupe + the skip below keep it from emitting twice.
        var transformFirst = (depth === 0);
        if (transformFirst) {
            var xf = null;
            try { xf = group.property("Transform"); } catch (eXf) {}
            if (xf) { walk(xf, path.concat([xf.name]), depth + 1); }
        }
        var n = 0;
        try { n = group.numProperties; } catch (e) { n = 0; }
        for (var i = 1; i <= n; i++) {
            if (out.length >= MAX_ENTRIES) { truncated = true; return; }
            var prop = null;
            try { prop = group.property(i); } catch (e) { continue; }
            if (!prop) { continue; }
            if (transformFirst && prop.name === "Transform") { continue; } // already walked first
            if (isSkipped(prop)) { continue; }  // AE-plumbing subtree — don't recurse or emit
            var kids = undefined;
            try { kids = prop.numProperties; } catch (e) {}
            if (kids !== undefined && kids > 0) {
                // Container: implicit levels are flattened in addressable paths, so don't append them.
                var childPath = isImplicit(prop) ? path : path.concat([prop.name]);
                walk(prop, childPath, depth + 1);
            } else {
                var settable = false;
                try { settable = !!prop.setValue; } catch (e) {}
                if (!settable) { continue; }
                var fullPath = path.concat([prop.name]);
                var key = fullPath.join(">");
                if (seen[key]) { continue; }  // de-dupe: same property reached twice
                seen[key] = true;
                var keyframeable = false;
                try { keyframeable = (prop.canVaryOverTime === true); } catch (e2) {}
                var entry = { n: prop.name, p: fullPath, k: keyframeable };
                try { var _pv = prop.value; if (_isJsonSafeValue(_pv)) { entry.v = _pv; } } catch (e3) {}
                if (keyframeable) { try { entry.nk = prop.numKeys; } catch (e4) {} }
                out.push(entry);
            }
        }
    }
    try { walk(rootProp, rootPath, 0); } catch (e) {}
    if (truncated) { out.push({ n: "(truncated)", truncated: true }); }
    return out;
}

// One-level drill-down for the getLayerProperties pull tool. Returns ONLY the IMMEDIATE children of
// rootProp: a GROUP (has sub-properties) → { p, g:true } (navigable — pass p back as scope); a settable
// LEAF → { p, k } (k=keyframeable). NO name (=p's last element), no value/numKeys (lean — values come from
// getLayerProperty). Mirrors _configurableChildren path semantics: SKIP_CONTAINERS are omitted;
// IMPLICIT_CONTAINERS are flattened (recurse THROUGH them so their children surface at this level with the
// container segment NOT in p). Per-level cap; a final { truncated:true } sentinel if hit.
function _configurableLevel(rootProp, rootPath) {
    var out = [];
    var seen = {};
    var MAX_LEVEL = 60;
    var truncated = false;
    function inList(name, list) { for (var c = 0; c < list.length; c++) { if (list[c] === name) { return true; } } return false; }
    function isImplicit(prop) { var mn = null; try { mn = prop.matchName; } catch (e) {} return mn ? inList(mn, IMPLICIT_CONTAINERS) : false; }
    function isSkipped(prop) { var nm = null; try { nm = prop.name; } catch (e) {} return nm ? inList(nm, SKIP_CONTAINERS) : false; }
    // Emit the immediate children of `group` at `path`. Implicit containers are recursed THROUGH (their
    // children appear at this same level with flattened paths), matching how _configurableChildren builds p.
    function emitLevel(group, path) {
        var n = 0;
        try { n = group.numProperties; } catch (e) { n = 0; }
        for (var i = 1; i <= n; i++) {
            if (out.length >= MAX_LEVEL) { truncated = true; return; }
            var prop = null;
            try { prop = group.property(i); } catch (e) { continue; }
            if (!prop) { continue; }
            if (isSkipped(prop)) { continue; }
            if (isImplicit(prop)) { emitLevel(prop, path); continue; }  // flatten through — stay at this level
            var kids = undefined;
            try { kids = prop.numProperties; } catch (e) {}
            if (kids !== undefined && kids > 0) {
                var gp = path.concat([prop.name]);
                var gk = gp.join(">");
                if (seen[gk]) { continue; }
                seen[gk] = true;
                out.push({ p: gp, g: true });  // navigable group
            } else {
                var settable = false;
                try { settable = !!prop.setValue; } catch (e) {}
                if (!settable) { continue; }
                var lp = path.concat([prop.name]);
                var lk = lp.join(">");
                if (seen[lk]) { continue; }
                seen[lk] = true;
                var keyframeable = false;
                try { keyframeable = (prop.canVaryOverTime === true); } catch (e2) {}
                out.push({ p: lp, k: keyframeable });  // settable leaf
            }
        }
    }
    try { emitLevel(rootProp, rootPath); } catch (e) {}
    if (truncated) { out.push({ truncated: true }); }
    return out;
}

// Single-leaf variant of _configurableChildren: for a command that creates/exposes ONE specific
// property (e.g. Time Remap) where walking the whole layer would be noise. Returns the same lean
// { n:name, p:path, k:keyframeable, v:value[, nk:numKeys] } entry shape, wrapped in an array (empty if no prop).
function _configurableLeaf(prop, path) {
    if (!prop) { return []; }
    var keyframeable = false;
    try { keyframeable = (prop.canVaryOverTime === true); } catch (e) {}
    var entry = { n: prop.name, p: path, k: keyframeable };
    try { var _pv = prop.value; if (_isJsonSafeValue(_pv)) { entry.v = _pv; } } catch (e2) {}
    if (keyframeable) { try { entry.nk = prop.numKeys; } catch (e3) {} }
    return [entry];
}


// ============================================================
// BATCH & DISPATCH
// ============================================================

var READ_ONLY_COMMANDS = {
    getProjectInfo: 1, listCompositions: 1, getLayerInfo: 1,
    getLayerKeyframes: 1, getLayerExpressions: 1,
    getLayerMasks: 1, getLayerEffects: 1,
    getSelectedLayers: 1, getSelectionDetails: 1, listProjectItems: 1,
    getLayerProperty: 1, getLayerProperties: 1,
    listMarkers: 1, getCurrentTime: 1, getProjectPath: 1,
    getCompositionInfo: 1, listFonts: 1
};

// Routes a command name + args to the correct handler function.
// Domain handler functions are defined in the files concatenated above this one.
function dispatchCommand(command, args) {
    // Read-only commands, batch (owns its own outer group), and restoreProject (closes +
    // reopens the project, so it can't live inside an undo group) skip the wrapper.
    if (READ_ONLY_COMMANDS[command] === 1 || command === "batch" || command === "restoreProject") {
        return _dispatchSwitch(command, args);
    }
    // Prefer the agent-supplied friendly label (the same text shown in the chat row, e.g.
    // "Added text layer") so Edit > Undo never exposes the raw command name. Direct/MCP
    // callers omit it and fall back to the command name.
    var undoLabel = (typeof args.__undoLabel === "string" && args.__undoLabel.length > 0)
        ? args.__undoLabel
        : command;
    app.beginUndoGroup("Cubic: " + undoLabel);
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
        case "cropComp":                 return cropComp(args);
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
        case "retimeClip":               return retimeClip(args);
        case "moveLayer":                return moveLayer(args);
        case "setLayerParent":           return setLayerParent(args);
        case "centerAnchorPoint":        return centerAnchorPoint(args);
        case "setAnchorPoint":           return setAnchorPoint(args);
        case "alignLayers":              return alignLayers(args);
        case "distributeLayers":         return distributeLayers(args);
        case "fitToFrame":               return fitToFrame(args);
        case "sequenceLayers":           return sequenceLayers(args);
        case "setTimeRemapEnabled":      return setTimeRemapEnabled(args);
        case "deleteLayer":              return deleteLayer(args);
        case "precompose":               return precompose(args);
        case "decomposeLayer":           return decomposeLayer(args);
        case "mergeLayer":               return mergeLayer(args);
        case "setTrackMatte":            return setTrackMatte(args);
        case "getLayerProperty":         return getLayerProperty(args);
        case "getLayerProperties":       return getLayerProperties(args);
        case "setLayerProperty":         return setLayerProperty(args);
        case "distributeLayers3D":       return distributeLayers3D(args);
        case "cameraMove":               return cameraMove(args);
        case "createBackground":         return createBackground(args);
        case "addNullToLayers":          return addNullToLayers(args);
        case "getLayerColors":           return getLayerColors(args);
        // text.jsx
        case "createTextLayer":          return createTextLayer(args);
        // fonts.jsx
        case "listFonts":                return listFonts(args);
        case "addTextAnimator":          return addTextAnimator(args);
        case "setTextAnimatorProperty":  return setTextAnimatorProperty(args);
        case "setTextAnimatorRangeSelector": return setTextAnimatorRangeSelector(args);
        case "explodeTextLayer":         return explodeTextLayer(args);
        case "animateText":              return animateText(args);
        // shapes.jsx
        case "createShapeLayer":         return createShapeLayer(args);
        case "addShapeOperator":         return addShapeOperator(args);
        case "setShapeOperatorProperty": return setShapeOperatorProperty(args);
        case "convertToShape":           return convertToShape(args);
        case "animateShape":             return animateShape(args);
        case "extractShapes":            return extractShapes(args);
        case "mergeShapes":              return mergeShapes(args);
        // markers.jsx
        case "addMarker":                return addMarker(args);
        case "listMarkers":              return listMarkers(args);
        case "updateMarker":             return updateMarker(args);
        case "removeMarker":             return removeMarker(args);
        // project.jsx
        case "getProjectPath":           return getProjectPath();
        case "saveProject":              return saveProject(args);
        case "backupProject":            return backupProject(args);
        case "restoreProject":           return restoreProject(args);
        case "openProject":              return openProject(args);
        // animation.jsx
        case "getLayerKeyframes":        return getLayerKeyframes(args);
        case "setLayerKeyframe":         return setLayerKeyframe(args);
        case "setKeyframeEasing":        return setKeyframeEasing(args);
        case "setKeyframeSpatial":       return setKeyframeSpatial(args);
        case "removePropertyKeyframes":  return removePropertyKeyframes(args);
        case "cloneKeyframes":           return cloneKeyframes(args);
        case "fixKeyframeTiming":        return fixKeyframeTiming(args);
        case "sequenceKeyframes":        return sequenceKeyframes(args);
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
        case "adjustColor":              return adjustColor(args);
        case "applyEffectTemplate":      return applyEffectTemplate(args);
        case "setEffectProperty":        return setEffectProperty(args);
        case "deleteEffect":             return deleteEffect(args);
        case "introspectMatchNames":     return introspectMatchNames(args);
        // footage.jsx
        case "listProjectItems":         return listProjectItems(args);
        case "importFootage":            return importFootage(args);
        case "addFootageToComp":         return addFootageToComp(args);
        case "importAssetToComp":        return importAssetToComp(args);
        case "deleteProjectItem":         return deleteProjectItem(args);
        case "deleteUnusedSolids":       return deleteUnusedSolids();
        case "createFolder":             return createFolder(args);
        case "updateProjectItem":        return updateProjectItem(args);
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
        return JSON.stringify({ status: "noop", message: "Empty batch — nothing to do.", total: 0, executed: 0, succeeded: 0, failed: 0, noopCount: 0, results: [] });
    }

    var stopOnError = args.stopOnError === true;
    var results = [];
    var succeeded = 0;
    var failed = 0;
    var noopCount = 0;

    // Label the single undo entry for the whole turn. Prefer the agent-injected __undoLabel
    // (the same friendly text the chat shows — the model's groupLabel when given, otherwise
    // synthesized from the sub-commands), then a raw groupLabel from direct/MCP callers, then
    // a generic count. Never exposes "batch"/raw command names on the agent path.
    var batchLabel = (typeof args.__undoLabel === "string" && args.__undoLabel.length > 0)
        ? ("Cubic: " + args.__undoLabel)
        : (typeof args.groupLabel === "string" && args.groupLabel.length > 0)
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
            // Call the UNWRAPPED dispatcher: batch already owns the outer undo group, so sub-commands
            // must NOT each open their own (dispatchCommand wraps every write in begin/endUndoGroup).
            // Nesting begin/endUndoGroup makes AE report "undo group mismatch" and leaks the outer group
            // open, so the user's next manual edit merges into the AI's turn (one Cmd+Z undoes both).
            // _dispatchSwitch is exactly what dispatchCommand runs internally minus that wrapper, so the
            // whole batch stays one clean undo entry.
            resultStr = _dispatchSwitch(entryCmd, cmdArgs);
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

        if (cmdSuccess) { succeeded++; if (resultObj.status === "noop") { noopCount++; } } else { failed++; }

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

    // status precedence: any failure → error; else if every executed sub-command was itself a noop
    // (nothing changed anywhere) → noop, so the whole batch gets the muted row; else success.
    var envelopeStatus = failed > 0
        ? "error"
        : (succeeded > 0 && noopCount === succeeded) ? "noop" : "success";
    var envelope = {
        status: envelopeStatus,
        total: commands.length,
        executed: results.length,
        succeeded: succeeded,
        failed: failed,
        noopCount: noopCount,
        stoppedEarly: stopOnError && results.length < commands.length,
        results: results
    };
    // On any sub-command failure the envelope is status:"error"; carry a top-level
    // errorCode so callers (agent loop / logs) see a real code, not undefined. The
    // per-command codes live in results[].
    if (failed > 0) { envelope.errorCode = ERROR_CODES.BATCH_FAILED; }
    return JSON.stringify(envelope, null, 2);
}
