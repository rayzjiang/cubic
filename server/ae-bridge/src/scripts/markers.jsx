// markers.jsx
// CRUD: C ✓  R ✓  U ✓  D ✓
//
// Target disambiguation: if args has layerIndex or layerName → layer marker.
// Otherwise → comp marker (comp.markerProperty).


// ── Shared helpers ────────────────────────────────────────────────────────────

function _resolveMarkerProp(args) {
    var comp = _resolveComp(args);
    var layerIndex = args.layerIndex;
    var layerName  = args.layerName || "";
    if ((layerIndex !== undefined && layerIndex !== null) || layerName) {
        var layer = null;
        if (layerIndex !== undefined && layerIndex !== null) {
            if (layerIndex > 0 && layerIndex <= comp.numLayers) { layer = comp.layer(layerIndex); }
            else { throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Layer index out of bounds: " + layerIndex); }
        } else {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === layerName) { layer = comp.layer(j); break; }
            }
            if (!layer) { throw _err(ERROR_CODES.LAYER_NOT_FOUND, "Layer not found: '" + layerName + "'"); }
        }
        return { comp: comp, layer: layer, markerProp: layer.property("Marker"), target: "layer" };
    }
    return { comp: comp, layer: null, markerProp: comp.markerProperty, target: "comp" };
}

// Find a marker's 1-based key index by markerIndex or time (±0.001s tolerance)
function _findMarkerKey(markerProp, args) {
    if (args.markerIndex !== undefined && args.markerIndex !== null) {
        var ki = parseInt(args.markerIndex);
        if (ki < 1 || ki > markerProp.numKeys) {
            throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Marker index " + ki + " out of range (1–" + markerProp.numKeys + ")");
        }
        return ki;
    }
    if (args.time !== undefined && args.time !== null) {
        var t = parseFloat(args.time);
        for (var k = 1; k <= markerProp.numKeys; k++) {
            if (Math.abs(markerProp.keyTime(k) - t) <= 0.001) { return k; }
        }
        throw _err(ERROR_CODES.INVALID_ARGS, "No marker at time " + t + "s (±0.001s tolerance)");
    }
    throw _err(ERROR_CODES.INVALID_ARGS, "Provide markerIndex (1-based) or time (seconds) to identify the marker");
}

function _markerToObj(markerProp, keyIndex) {
    var mv = markerProp.keyValue(keyIndex);
    return {
        index: keyIndex,
        time: markerProp.keyTime(keyIndex),
        comment: mv.comment,
        duration: mv.duration,
        chapter: mv.chapter,
        url: mv.url,
        frameTarget: mv.frameTarget,
        cuePointName: mv.cuePointName,
        label: mv.label,
        protectedRegion: mv.protectedRegion
    };
}


// ── Handlers ──────────────────────────────────────────────────────────────────

// C: addMarker
function addMarker(args) {
    try {
        var resolved = _resolveMarkerProp(args);
        var markerProp = resolved.markerProp;

        if (args.time === undefined || args.time === null) { throw _err(ERROR_CODES.INVALID_ARGS, "time (seconds) is required"); }
        var t = parseFloat(args.time);

        var mv = new MarkerValue(args.comment || "");
        if (args.duration     !== undefined && args.duration     !== null) { mv.duration     = parseFloat(args.duration); }
        if (args.chapter      !== undefined && args.chapter      !== null) { mv.chapter      = args.chapter + ""; }
        if (args.url          !== undefined && args.url          !== null) { mv.url          = args.url + ""; }
        if (args.frameTarget  !== undefined && args.frameTarget  !== null) { mv.frameTarget  = args.frameTarget + ""; }
        if (args.cuePointName    !== undefined && args.cuePointName    !== null) { mv.cuePointName    = args.cuePointName + ""; }
        if (args.label           !== undefined && args.label           !== null) { mv.label           = parseInt(args.label); }
        if (args.protectedRegion !== undefined && args.protectedRegion !== null) { mv.protectedRegion = !!args.protectedRegion; }

        markerProp.setValueAtTime(t, mv);

        var newKeyIndex = 1;
        for (var k = 1; k <= markerProp.numKeys; k++) {
            if (Math.abs(markerProp.keyTime(k) - t) <= 0.001) { newKeyIndex = k; break; }
        }

        return JSON.stringify({
            status: "success",
            message: "Marker added at " + t + "s on " + resolved.target + ".",
            target: resolved.target,
            marker: _markerToObj(markerProp, newKeyIndex)
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// R: listMarkers
function listMarkers(args) {
    try {
        // No compName + no active comp → return empty gracefully (read-only, safe to soft-fail)
        if (!args.compName && !(app.project.activeItem instanceof CompItem)) {
            return JSON.stringify({ status: "success", target: "comp", count: 0, markers: [], message: "No active composition" }, null, 2);
        }
        var resolved = _resolveMarkerProp(args);
        var markerProp = resolved.markerProp;

        var markers = [];
        for (var k = 1; k <= markerProp.numKeys; k++) {
            markers.push(_markerToObj(markerProp, k));
        }

        return JSON.stringify({
            status: "success",
            target: resolved.target,
            count: markers.length,
            markers: markers
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: updateMarker — update fields of an existing marker (identified by markerIndex or time)
function updateMarker(args) {
    try {
        var resolved = _resolveMarkerProp(args);
        var markerProp = resolved.markerProp;

        var keyIndex = _findMarkerKey(markerProp, args);
        var mv = markerProp.keyValue(keyIndex);

        // Capture prior state for revert
        var previousValues = {
            comment: mv.comment, duration: mv.duration, chapter: mv.chapter,
            url: mv.url, frameTarget: mv.frameTarget, cuePointName: mv.cuePointName,
            label: mv.label, protectedRegion: mv.protectedRegion
        };

        var changed = [];
        if (args.comment         !== undefined && args.comment         !== null) { mv.comment         = args.comment + "";            changed.push("comment"); }
        if (args.duration        !== undefined && args.duration        !== null) { mv.duration        = parseFloat(args.duration);    changed.push("duration"); }
        if (args.chapter         !== undefined && args.chapter         !== null) { mv.chapter         = args.chapter + "";            changed.push("chapter"); }
        if (args.url             !== undefined && args.url             !== null) { mv.url             = args.url + "";                changed.push("url"); }
        if (args.frameTarget     !== undefined && args.frameTarget     !== null) { mv.frameTarget     = args.frameTarget + "";        changed.push("frameTarget"); }
        if (args.cuePointName    !== undefined && args.cuePointName    !== null) { mv.cuePointName    = args.cuePointName + "";       changed.push("cuePointName"); }
        if (args.label           !== undefined && args.label           !== null) { mv.label           = parseInt(args.label);         changed.push("label"); }
        if (args.protectedRegion !== undefined && args.protectedRegion !== null) { mv.protectedRegion = !!args.protectedRegion;       changed.push("protectedRegion"); }

        markerProp.setValueAtKey(keyIndex, mv);

        return JSON.stringify({
            status: "success",
            message: "Marker updated: " + (changed.length ? changed.join(", ") : "no fields changed") + ".",
            target: resolved.target,
            marker: _markerToObj(markerProp, keyIndex),
            previousValues: previousValues
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// D: removeMarker — remove by markerIndex or time; or pass all:true to clear all
function removeMarker(args) {
    try {
        var resolved = _resolveMarkerProp(args);
        var markerProp = resolved.markerProp;

        if (args.all === true) {
            var removedMarkers = [];
            for (var ak = 1; ak <= markerProp.numKeys; ak++) {
                removedMarkers.push(_markerToObj(markerProp, ak));
            }
            var count = markerProp.numKeys;
            while (markerProp.numKeys > 0) { markerProp.removeKey(1); }
            return JSON.stringify({
                status: "success",
                message: "All " + count + " marker(s) removed.",
                target: resolved.target,
                removedCount: count,
                removedMarkers: removedMarkers
            }, null, 2);
        }

        var keyIndex    = _findMarkerKey(markerProp, args);
        var removedMarker = _markerToObj(markerProp, keyIndex);
        markerProp.removeKey(keyIndex);

        return JSON.stringify({
            status: "success",
            message: "Marker at " + removedMarker.time + "s removed.",
            target: resolved.target,
            removedAt: removedMarker.time,
            removedMarker: removedMarker
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}
