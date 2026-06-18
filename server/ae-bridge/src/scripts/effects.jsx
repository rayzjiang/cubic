// effects.jsx
// CRUD: C ✓  R ✓  U ✓  D ✓

// ── Curated effect dictionary (single source of truth) ─────────────────────────
//
// The model drives effects through FRIENDLY names ("glow", "drop-shadow") — never raw AE
// matchNames, which it tends to hallucinate (e.g. "ADBE Glow" instead of the real "ADBE Glo2").
// Every matchName here is verified against real AE by tests/fixtures/ae-matchnames.json + the
// matchname static guard, so a wrong one fails CI instead of silently erroring in AE.
//
// Per entry:
//   matchName  — the real AE effect matchName (ground truth = the fixture, NOT memory)
//   defaults   — sensible default settings, keyed by AE property DISPLAY name
//   customMap  — friendly customSettings key -> AE property display name (raw AE names also accepted)
var EFFECT_DICT = {
    "gaussian-blur":       { matchName: "ADBE Gaussian Blur 2",        defaults: { "Blurriness": 20 }, customMap: { blurriness: "Blurriness" } },
    "directional-blur":    { matchName: "ADBE Motion Blur",            defaults: { "Direction": 0, "Blur Length": 10 }, customMap: { direction: "Direction", length: "Blur Length" } },
    "color-balance":       { matchName: "ADBE Color Balance (HLS)",    defaults: { "Hue": 0, "Lightness": 0, "Saturation": 0 }, customMap: { hue: "Hue", lightness: "Lightness", saturation: "Saturation" } },
    "brightness-contrast": { matchName: "ADBE Brightness & Contrast 2", defaults: { "Brightness": 0, "Contrast": 0, "Use Legacy (supports HDR)": false }, customMap: { brightness: "Brightness", contrast: "Contrast" } },
    "curves":              { matchName: "ADBE CurvesCustom",           defaults: {}, customMap: {} },
    "glow":                { matchName: "ADBE Glo2",                   defaults: { "Glow Threshold": 50, "Glow Radius": 15, "Glow Intensity": 1 }, customMap: { threshold: "Glow Threshold", radius: "Glow Radius", intensity: "Glow Intensity" } },
    "drop-shadow":         { matchName: "ADBE Drop Shadow",            defaults: { "Shadow Color": [0, 0, 0, 1], "Opacity": 50, "Direction": 135, "Distance": 10, "Softness": 10 }, customMap: { color: "Shadow Color", opacity: "Opacity", direction: "Direction", distance: "Distance", softness: "Softness" } },
    "vibrance":            { matchName: "ADBE Vibrance",               defaults: { "Vibrance": 15, "Saturation": -5 }, customMap: { vibrance: "Vibrance", saturation: "Saturation" } }
};

// Composite templates: ordered lists of EFFECT_DICT entries (matchNames stay single-sourced) with
// optional per-effect setting overrides (AE display-name keys).
var EFFECT_TEMPLATES = {
    "cinematic-look": [
        { effect: "curves", settings: {} },
        { effect: "vibrance", settings: { "Vibrance": 15, "Saturation": -5 } }
    ],
    "text-pop": [
        { effect: "drop-shadow", settings: { "Shadow Color": [0, 0, 0, 1], "Opacity": 75, "Distance": 5, "Softness": 10 } },
        { effect: "glow", settings: { "Glow Radius": 10, "Glow Intensity": 1.5 } }
    ]
};

// Case-insensitive lookup of a friendly effect name -> EFFECT_DICT entry (or null).
function _lookupEffect(name) {
    if (!name) return null;
    if (EFFECT_DICT.hasOwnProperty(name)) return EFFECT_DICT[name];
    var lower = String(name).toLowerCase();
    for (var k in EFFECT_DICT) {
        if (EFFECT_DICT.hasOwnProperty(k) && k.toLowerCase() === lower) return EFFECT_DICT[k];
    }
    return null;
}

// All known friendly effect + template names, for self-healable error messages.
function _effectFriendlyNames() {
    var out = [];
    for (var k in EFFECT_DICT) { if (EFFECT_DICT.hasOwnProperty(k)) out.push(k); }
    for (var t in EFFECT_TEMPLATES) { if (EFFECT_TEMPLATES.hasOwnProperty(t)) out.push(t); }
    return out;
}

// Merge an entry's defaults with caller customSettings, translating friendly keys via customMap
// (raw AE property names pass through untouched). Returns an AE-display-name-keyed settings dict.
function _mergeEffectSettings(entry, customSettings) {
    var out = {};
    for (var dk in entry.defaults) { if (entry.defaults.hasOwnProperty(dk)) out[dk] = entry.defaults[dk]; }
    if (customSettings) {
        for (var ck in customSettings) {
            if (!customSettings.hasOwnProperty(ck)) continue;
            var aeName = (entry.customMap && entry.customMap[ck]) ? entry.customMap[ck] : ck;
            out[aeName] = customSettings[ck];
        }
    }
    return out;
}

// Builds the honest "applied, but couldn't set X, Y" warning from a failedProperties list (or
// undefined when nothing failed). Keeps the success status but never hides a partial apply.
function _partialWarning(effectLabel, failed) {
    if (!failed || failed.length === 0) return undefined;
    var names = [];
    for (var i = 0; i < failed.length; i++) names.push(failed[i].name);
    return "Applied " + effectLabel + ", but couldn't set: " + names.join(", ");
}

// ── Shared helper ─────────────────────────────────────────────────────────────

// Applies a settings dict to an effect — used by applyEffect and applyEffectTemplate.
// Returns an array of { name, reason } for any properties that could not be set.
function applyEffectSettings(effect, settings) {
    var failed = [];
    if (!settings) return failed;
    var hasKeys = false;
    for (var k in settings) { if (settings.hasOwnProperty(k)) { hasKeys = true; break; } }
    if (!hasKeys) return failed;

    for (var propName in settings) {
        if (settings.hasOwnProperty(propName)) {
            var property = null;
            try {
                property = effect.property(propName);
            } catch (e) {
                for (var i = 1; i <= effect.numProperties; i++) {
                    var prop = effect.property(i);
                    if (prop.name === propName) { property = prop; break; }
                }
            }
            if (!property || !property.setValue) {
                failed.push({ name: propName, reason: "not found" });
                continue;
            }
            try { property.setValue(settings[propName]); }
            catch (e) { failed.push({ name: propName, reason: e.toString() }); }
        }
    }
    return failed;
}

// ── R: getLayerEffects ────────────────────────────────────────────────────────

function getLayerEffects(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var effectsGroup = layer.property("Effects");
        var effects = [];
        for (var i = 1; i <= effectsGroup.numProperties; i++) {
            var eff = effectsGroup.property(i);
            var props = [];
            for (var p = 1; p <= eff.numProperties; p++) {
                var prop = eff.property(p);
                var propVal = null;
                try { propVal = prop.value; } catch (e) {}
                props.push({ name: prop.name, value: propVal });
            }
            effects.push({
                index: i,
                name: eff.name,
                matchName: eff.matchName,
                enabled: eff.enabled,
                properties: props
            });
        }

        return JSON.stringify({
            status: "success",
            layer: { name: layer.name, index: layer.index },
            effects: effects,
            count: effects.length
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// ── C: applyEffect ────────────────────────────────────────────────────────────

function applyEffect(args) {
    var effect = null;  // tracked for atomic-create rollback (see catch); preset path doesn't set it
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp = resolved.comp;
        var layer = resolved.layer;

        var effectName = args.effectName;
        var effectMatchName = args.effectMatchName;
        var presetPath = args.presetPath;
        var effectSettings = args.effectSettings || {};

        if (!effectName && !effectMatchName && !presetPath) {
            throw _err(ERROR_CODES.INVALID_ARGS, "You must specify either effectName, effectMatchName, or presetPath");
        }

        var effectResult;
        var failedProps = [];
        var warning;

        if (presetPath) {
            var presetFile = new File(presetPath);
            if (!presetFile.exists) { throw _err(ERROR_CODES.INVALID_ARGS, "Effect preset file not found: " + presetPath); }
            layer.applyPreset(presetFile);
            effectResult = { type: "preset", name: presetPath.split('/').pop().split('\\').pop(), applied: true };
        } else {
            // Resolve to a real matchName. effectMatchName (power use) is taken as-is; effectName is
            // resolved through the curated dictionary so the model never has to know AE matchNames.
            // An unknown effectName falls back to a literal display-name lookup. A bad name no longer
            // throws a cryptic error — it returns a self-healable list of supported effects.
            var entry = effectMatchName ? null : _lookupEffect(effectName);
            var resolvedMatch = effectMatchName ? effectMatchName : (entry ? entry.matchName : effectName);
            try {
                effect = layer.Effects.addProperty(resolvedMatch);
            } catch (addErr) {
                throw _err(ERROR_CODES.INVALID_ARGS,
                    "Couldn't apply effect '" + (effectName || effectMatchName) + "'. Use one of the known effects (" +
                    _effectFriendlyNames().join(", ") + "), or pass a valid AE matchName via effectMatchName.");
            }
            // When resolved from the dictionary, layer defaults under any caller-provided overrides.
            var settingsToApply = entry ? _mergeEffectSettings(entry, effectSettings) : effectSettings;
            effectResult = { type: "effect", name: effect.name, matchName: effect.matchName, index: effect.propertyIndex };
            failedProps = applyEffectSettings(effect, settingsToApply);
            warning = _partialWarning(effect.name, failedProps);
        }

        return JSON.stringify({
            status: "success",
            message: "Effect applied successfully",
            effect: effectResult,
            layer: { name: layer.name, index: layer.index },
            composition: { name: comp.name },
            warning: warning,
            failedProperties: failedProps.length > 0 ? failedProps : undefined
        }, null, 2);
    } catch (error) {
        // Roll back the partially-added effect so a failed apply leaves no orphan.
        if (effect !== null) { try { effect.remove(); } catch (e2) {} }
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// ── C: applyEffectTemplate ────────────────────────────────────────────────────
//
// A thin layer over EFFECT_DICT / EFFECT_TEMPLATES (defined at the top of this file — the single
// source of truth for matchNames). A templateName may be a single curated effect (any EFFECT_DICT
// key, e.g. "glow") or a composite (EFFECT_TEMPLATES key, e.g. "text-pop"). Adding/adjusting an
// effect means editing those dicts, then: npm run build && npm run install-plugin + reopen panel.
//
// customSettings forms:
//   • flat:        { intensity: 1.5 }        — friendly keys (per the entry's customMap) or AE names
//   • per-index:   { "1": { intensity: 1.5 } } — targets the sub-effect at that 0-based index (composites)

function applyEffectTemplate(args) {
    // Effect objects added so far, tracked for atomic-create rollback: a template adds several
    // effects in a loop, so a mid-loop failure must remove ALL of them (not just the last) — else
    // a self-heal retry stacks duplicates on top of the half-applied template.
    var addedEffects = [];
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp = resolved.comp;
        var layer = resolved.layer;

        var templateName = args.templateName;
        var customSettings = args.customSettings || {};

        if (!templateName) { throw _err(ERROR_CODES.INVALID_ARGS, "You must specify a templateName"); }

        // Normalize to an ordered list of { entry, settings } steps sourced from EFFECT_DICT.
        var steps = [];
        var single = _lookupEffect(templateName);
        if (single) {
            steps.push({ entry: single, settings: _mergeEffectSettings(single, customSettings) });
        } else if (EFFECT_TEMPLATES.hasOwnProperty(templateName)) {
            var spec = EFFECT_TEMPLATES[templateName];
            for (var s = 0; s < spec.length; s++) {
                var stepEntry = EFFECT_DICT[spec[s].effect];
                // Base = entry defaults, then the template's per-step overrides, then caller customSettings
                // (flat applies to every step; per-index { "0": {...} } targets one step).
                var merged = _mergeEffectSettings(stepEntry, null);
                for (var ok in spec[s].settings) { if (spec[s].settings.hasOwnProperty(ok)) merged[ok] = spec[s].settings[ok]; }
                var perIndex = customSettings[s] || customSettings[String(s)];
                var overrideSrc = perIndex ? perIndex : customSettings;
                for (var ck in overrideSrc) {
                    if (!overrideSrc.hasOwnProperty(ck)) continue;
                    if (perIndex || typeof overrideSrc[ck] !== "object") {
                        var aeName = (stepEntry.customMap && stepEntry.customMap[ck]) ? stepEntry.customMap[ck] : ck;
                        merged[aeName] = overrideSrc[ck];
                    }
                }
                steps.push({ entry: stepEntry, settings: merged });
            }
        } else {
            throw _err(ERROR_CODES.INVALID_ARGS, "Template '" + templateName + "' not found. Available: " + _effectFriendlyNames().join(", "));
        }

        var appliedEffects = [];
        var allFailed = [];

        for (var i = 0; i < steps.length; i++) {
            var effect;
            try {
                effect = layer.Effects.addProperty(steps[i].entry.matchName);
            } catch (addErr) {
                // A bad matchName here is a code/fixture bug, not user error — surface it loudly.
                throw _err(ERROR_CODES.INVALID_ARGS, "Effect matchName '" + steps[i].entry.matchName + "' was rejected by AE (template '" + templateName + "'). The effect dictionary is out of sync with this AE version.");
            }
            addedEffects.push(effect);
            var fp = applyEffectSettings(effect, steps[i].settings);
            for (var fpi = 0; fpi < fp.length; fpi++) { allFailed.push({ effectName: effect.name, name: fp[fpi].name, reason: fp[fpi].reason }); }
            appliedEffects.push({ name: effect.name, matchName: effect.matchName });
        }

        return JSON.stringify({
            status: "success",
            message: "Effect template '" + templateName + "' applied successfully",
            appliedEffects: appliedEffects,
            layer: { name: layer.name, index: layer.index },
            composition: { name: comp.name },
            warning: _partialWarning(templateName, allFailed),
            failedProperties: allFailed.length > 0 ? allFailed : undefined
        }, null, 2);
    } catch (error) {
        // Roll back every effect added before the failure (reverse order) so the template is
        // all-or-nothing and leaves no partial stack behind.
        for (var r = addedEffects.length - 1; r >= 0; r--) { try { addedEffects[r].remove(); } catch (e2) {} }
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// ── U: setEffectProperty ──────────────────────────────────────────────────────

function setEffectProperty(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var effectsGroup = layer.property("Effects");
        var eff = null;
        if (args.effectIndex !== undefined && args.effectIndex !== null) {
            if (args.effectIndex > 0 && args.effectIndex <= effectsGroup.numProperties) {
                eff = effectsGroup.property(args.effectIndex);
            } else {
                throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Effect index out of bounds: " + args.effectIndex);
            }
        } else if (args.effectName) {
            for (var i = 1; i <= effectsGroup.numProperties; i++) {
                if (effectsGroup.property(i).name === args.effectName) { eff = effectsGroup.property(i); break; }
            }
        }
        if (!eff) { throw _err(ERROR_CODES.LAYER_NOT_FOUND, "Effect not found: " + (args.effectName || "index " + args.effectIndex)); }

        var property = null;
        try {
            property = eff.property(args.propertyName);
        } catch (e) {
            for (var p = 1; p <= eff.numProperties; p++) {
                if (eff.property(p).name === args.propertyName) { property = eff.property(p); break; }
            }
        }
        if (!property) { throw _err(ERROR_CODES.PROPERTY_NOT_FOUND, "Property '" + args.propertyName + "' not found on effect '" + eff.name + "'"); }

        var previousValue = null;
        try { previousValue = property.value; } catch (e) {}

        // No-op: requested value already matches the current value — nothing to mutate.
        var parsedValue = args.value;
        if (typeof parsedValue === "string") { try { parsedValue = eval("(" + parsedValue + ")"); } catch (e) {} }
        if (_valuesEqual(parsedValue, property.value)) {
            return JSON.stringify({ status: "noop", message: "This effect property is already set to that value." }, null, 2);
        }

        property.setValue(args.value);

        return JSON.stringify({
            status: "success",
            message: "Effect property updated",
            effect: { name: eff.name, index: eff.propertyIndex },
            property: { name: args.propertyName, value: property.value },
            previousValue: previousValue,
            layer: { name: layer.name, index: layer.index }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// ── D: deleteEffect ───────────────────────────────────────────────────────────

function deleteEffect(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var effectsGroup = layer.property("Effects");
        var eff = null;
        if (args.effectIndex !== undefined && args.effectIndex !== null) {
            if (args.effectIndex > 0 && args.effectIndex <= effectsGroup.numProperties) {
                eff = effectsGroup.property(args.effectIndex);
            } else {
                throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Effect index out of bounds: " + args.effectIndex);
            }
        } else if (args.effectName) {
            for (var i = 1; i <= effectsGroup.numProperties; i++) {
                if (effectsGroup.property(i).name === args.effectName) { eff = effectsGroup.property(i); break; }
            }
        }
        if (!eff) { throw _err(ERROR_CODES.LAYER_NOT_FOUND, "Effect not found: " + (args.effectName || "index " + args.effectIndex)); }

        var deletedName = eff.name;
        var deletedIndex = eff.propertyIndex;
        eff.remove();

        return JSON.stringify({
            status: "success",
            message: "Effect deleted successfully",
            deleted: { name: deletedName, index: deletedIndex },
            layer: { name: layer.name, index: layer.index }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// ── Diagnostic: introspectMatchNames ──────────────────────────────────────────
//
// Ground-truth probe: ask AE itself whether each candidate effect matchName is real and what
// canonical matchName + property names it resolves to. Run ONCE against live AE to generate
// tests/fixtures/ae-matchnames.json, which the static matchname guard checks our code against.
// Internal/diagnostic — hidden from the model's catalog. Self-cleans its scratch comp.
//
// args.matchNames: array of candidate matchName strings (defaults to every EFFECT_DICT matchName).
function introspectMatchNames(args) {
    var tempComp = null;
    try {
        var names = (args && args.matchNames && args.matchNames.length) ? args.matchNames : (function () {
            var out = [];
            for (var k in EFFECT_DICT) { if (EFFECT_DICT.hasOwnProperty(k)) out.push(EFFECT_DICT[k].matchName); }
            return out;
        })();

        tempComp = app.project.items.addComp("__cubic_introspect", 100, 100, 1.0, 1, 30);
        var probe = tempComp.layers.addSolid([0, 0, 0], "probe", 100, 100, 1.0);

        var results = {};
        for (var i = 0; i < names.length; i++) {
            var mn = names[i];
            var entry = { valid: false };
            try {
                var fx = probe.Effects.addProperty(mn);
                entry.valid = true;
                entry.canonicalMatchName = fx.matchName;
                entry.displayName = fx.name;
                var props = [];
                for (var p = 1; p <= fx.numProperties; p++) {
                    var pr = fx.property(p);
                    props.push({ name: pr.name, matchName: pr.matchName });
                }
                entry.properties = props;
                fx.remove();
            } catch (e) {
                entry.valid = false;
                entry.error = e.toString();
            }
            results[mn] = entry;
        }

        return JSON.stringify({ status: "success", results: results }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    } finally {
        if (tempComp) { try { tempComp.remove(); } catch (e) {} }
    }
}
