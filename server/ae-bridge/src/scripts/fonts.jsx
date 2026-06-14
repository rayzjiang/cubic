// fonts.jsx
// Font name resolution + listing.
//
// AE's TextDocument.font setter wants a PostScript name ("ComicSansMS"), but the model
// supplies display names ("Comic Sans"). Installed fonts vary per machine, so we resolve
// against the LIVE app.fonts collection (not a static map). _resolveFont() turns whatever
// the model gives us into a real PostScript name, or throws a self-healing "did you mean"
// error. The lookup index is built once per session and cached in a module global (same
// lazy-cache pattern as masks.jsx's MASK_MODE_LABELS), with a rebuild-on-miss so a font
// installed mid-session is still found.

var FONT_INDEX = null;

// Normalize a font/family name for fuzzy matching: lowercase, strip everything but
// alphanumerics. "Comic Sans MS" -> "comicsansms", "Comic Sans" -> "comicsans".
function _normFontKey(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Read the first defined, non-empty string among candidate property names on a FontObject.
// AE's FontObject attribute names vary by version, so we probe a fallback chain rather than
// assume one name. Returns null if none resolve.
function _fontStr(f, names) {
    for (var i = 0; i < names.length; i++) {
        try {
            var v = f[names[i]];
            if (v !== undefined && v !== null && String(v).length > 0) { return String(v); }
        } catch (e) {}
    }
    return null;
}

// Index a single FontObject into FONT_INDEX. seenFam tracks first-seen families.
function _indexFont(f, seenFam) {
    var ps = _fontStr(f, ["postScriptName"]);
    if (!ps) { return; }
    var full = _fontStr(f, ["fullName", "nativeFullName"]);
    var fam  = _fontStr(f, ["familyName", "nativeFamilyName"]);
    var style = _fontStr(f, ["styleName", "nativeStyleName"]);

    FONT_INDEX.byPostScript[String(ps).toLowerCase()] = ps;
    if (full) { FONT_INDEX.byFullName[String(full).toLowerCase()] = ps; }
    if (fam && style) { FONT_INDEX.byFamilyStyle[(String(fam) + " " + String(style)).toLowerCase()] = ps; }
    if (fam) {
        var fl = String(fam).toLowerCase();
        var isReg = style && /^(regular|roman)$/i.test(String(style));
        // First style seen wins, but a Regular/Roman style overrides it (sensible default).
        if (FONT_INDEX.byFamily[fl] === undefined || isReg) { FONT_INDEX.byFamily[fl] = ps; }
        if (!seenFam[fl]) {
            seenFam[fl] = true;
            FONT_INDEX.families.push(String(fam));
            FONT_INDEX.familyList.push({ family: String(fam), norm: _normFontKey(fam), ps: ps });
        }
    }
}

// Build the lookup index from app.fonts.allFonts. If enumeration is unavailable/empty,
// leaves available=false so _resolveFont degrades to passing the raw name through to AE.
function _ensureFontIndex() {
    if (FONT_INDEX !== null) { return; }
    FONT_INDEX = { byPostScript: {}, byFullName: {}, byFamilyStyle: {}, byFamily: {}, familyList: [], families: [], available: false };

    var all = null;
    try { all = app.fonts.allFonts; } catch (e) { all = null; }
    if (!all || !all.length) { return; }

    var seenFam = {};
    for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el === undefined || el === null) { continue; }
        // app.fonts.allFonts is an array of per-family ARRAYS of FontObjects (one entry per
        // installed style). Older AE builds may expose a flat array — handle both: if el is a
        // font, index it directly; otherwise iterate it as a group of fonts.
        if (_fontStr(el, ["postScriptName"])) {
            _indexFont(el, seenFam);
        } else if (typeof el.length === "number") {
            for (var g = 0; g < el.length; g++) {
                if (el[g] !== undefined && el[g] !== null) { _indexFont(el[g], seenFam); }
            }
        }
    }
    // Point each family's representative PostScript name at the Regular-preferred choice.
    for (var j = 0; j < FONT_INDEX.familyList.length; j++) {
        var fe = FONT_INDEX.familyList[j];
        var pref = FONT_INDEX.byFamily[fe.family.toLowerCase()];
        if (pref) { fe.ps = pref; }
    }
    FONT_INDEX.families.sort();
    // Only "available" if we actually indexed families to match against. If extraction
    // produced nothing (unexpected FontObject shape), stay false so _resolveFont passes the
    // raw name through to AE rather than throwing "not found" for every font.
    FONT_INDEX.available = FONT_INDEX.familyList.length > 0;
}

// Resolve a supplied name to a PostScript name using the cached index; null if no match.
function _lookupFont(name) {
    var lower = String(name).toLowerCase();
    if (FONT_INDEX.byPostScript[lower]) { return FONT_INDEX.byPostScript[lower]; }
    if (FONT_INDEX.byFullName[lower]) { return FONT_INDEX.byFullName[lower]; }
    if (FONT_INDEX.byFamilyStyle[lower]) { return FONT_INDEX.byFamilyStyle[lower]; }
    if (FONT_INDEX.byFamily[lower]) { return FONT_INDEX.byFamily[lower]; }

    var norm = _normFontKey(name);
    var best = null, bestLen = 0;
    for (var i = 0; i < FONT_INDEX.familyList.length; i++) {
        var e = FONT_INDEX.familyList[i];
        if (e.norm === norm) { return e.ps; }
        // Containment both ways: "comicsans" matches family "comicsansms". Prefer the most
        // specific (shortest matching family) so "Arial" beats "Arial Narrow".
        if (e.norm.indexOf(norm) >= 0 || norm.indexOf(e.norm) >= 0) {
            if (best === null || e.norm.length < bestLen) { best = e.ps; bestLen = e.norm.length; }
        }
    }
    return best;
}

// Up to 8 installed families to suggest when a name can't be resolved (prefix match, else first few).
function _fontSuggestions(name) {
    var norm = _normFontKey(name);
    var pre = norm.substring(0, 3);
    var out = [];
    var i;
    if (pre.length >= 2) {
        for (i = 0; i < FONT_INDEX.familyList.length && out.length < 8; i++) {
            if (FONT_INDEX.familyList[i].norm.indexOf(pre) === 0) { out.push(FONT_INDEX.familyList[i].family); }
        }
    }
    if (out.length === 0) {
        for (i = 0; i < FONT_INDEX.families.length && out.length < 8; i++) { out.push(FONT_INDEX.families[i]); }
    }
    return out;
}

// Public: turn a model-supplied font name into a real PostScript name, or throw a
// self-healing error. Pass-through when fonts can't be enumerated. Call BEFORE mutating
// (e.g. before addText) so an unresolvable name fails without leaving partial state.
function _resolveFont(name) {
    if (name === undefined || name === null || name === "") { return name; }
    _ensureFontIndex();
    if (!FONT_INDEX.available) { return name; }

    var hit = _lookupFont(name);
    if (hit) { return hit; }

    // Rebuild once — the font may have been installed since the index was built.
    FONT_INDEX = null;
    _ensureFontIndex();
    if (!FONT_INDEX.available) { return name; }
    hit = _lookupFont(name);
    if (hit) { return hit; }

    throw _err(ERROR_CODES.INVALID_ARGS,
        "Font '" + name + "' not found. Did you mean: " + _fontSuggestions(name).join(", ") +
        " (call listFonts to browse installed families).");
}

// R: listFonts — installed font families, optionally filtered by a case-insensitive substring.
function listFonts(args) {
    try {
        _ensureFontIndex();
        var filter = (args && typeof args.filter === "string" && args.filter.length > 0) ? args.filter.toLowerCase() : null;
        var out = [];
        for (var i = 0; i < FONT_INDEX.families.length; i++) {
            var fam = FONT_INDEX.families[i];
            if (!filter || fam.toLowerCase().indexOf(filter) >= 0) { out.push(fam); }
        }
        return JSON.stringify({ status: "success", fonts: out, count: out.length, available: FONT_INDEX.available }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}
