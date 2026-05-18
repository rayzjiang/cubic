// effects.jsx
// CRUD: C ✓  R ✓  U ✓  D ✓

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
        var effect;
        var failedProps = [];

        if (presetPath) {
            var presetFile = new File(presetPath);
            if (!presetFile.exists) { throw _err(ERROR_CODES.INVALID_ARGS, "Effect preset file not found: " + presetPath); }
            layer.applyPreset(presetFile);
            effectResult = { type: "preset", name: presetPath.split('/').pop().split('\\').pop(), applied: true };
        } else if (effectMatchName) {
            effect = layer.Effects.addProperty(effectMatchName);
            effectResult = { type: "effect", name: effect.name, matchName: effect.matchName, index: effect.propertyIndex };
            failedProps = applyEffectSettings(effect, effectSettings);
        } else {
            effect = layer.Effects.addProperty(effectName);
            effectResult = { type: "effect", name: effect.name, matchName: effect.matchName, index: effect.propertyIndex };
            failedProps = applyEffectSettings(effect, effectSettings);
        }

        return JSON.stringify({
            status: "success",
            message: "Effect applied successfully",
            effect: effectResult,
            layer: { name: layer.name, index: layer.index },
            composition: { name: comp.name },
            failedProperties: failedProps.length > 0 ? failedProps : undefined
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// ── C: applyEffectTemplate ────────────────────────────────────────────────────
//
// Templates are hardcoded here — ExtendScript has no external config mechanism
// (no require(), no fs). Adding a new template means editing this dict, then:
//   npm run build && npm run install-plugin + reopen panel in AE.
//
// customSettings forms:
//   • flat:        { Vibrance: 30 }       — applied to every sub-effect that has that property
//   • per-index:   { "1": { Vibrance: 30 } } — targets sub-effect at given 0-based index
// Both forms work for single-effect templates too; flat is the natural case there.

function applyEffectTemplate(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp = resolved.comp;
        var layer = resolved.layer;

        var templateName = args.templateName;
        var customSettings = args.customSettings || {};

        if (!templateName) { throw _err(ERROR_CODES.INVALID_ARGS, "You must specify a templateName"); }

        var templates = {
            "gaussian-blur": {
                effectMatchName: "ADBE Gaussian Blur 2",
                settings: { "Blurriness": customSettings.blurriness !== undefined ? customSettings.blurriness : 20 }
            },
            "directional-blur": {
                effectMatchName: "ADBE Directional Blur",
                settings: { "Direction": customSettings.direction !== undefined ? customSettings.direction : 0, "Blur Length": customSettings.length !== undefined ? customSettings.length : 10 }
            },
            "color-balance": {
                effectMatchName: "ADBE Color Balance (HLS)",
                settings: { "Hue": customSettings.hue !== undefined ? customSettings.hue : 0, "Lightness": customSettings.lightness !== undefined ? customSettings.lightness : 0, "Saturation": customSettings.saturation !== undefined ? customSettings.saturation : 0 }
            },
            "brightness-contrast": {
                effectMatchName: "ADBE Brightness & Contrast 2",
                settings: { "Brightness": customSettings.brightness !== undefined ? customSettings.brightness : 0, "Contrast": customSettings.contrast !== undefined ? customSettings.contrast : 0, "Use Legacy": false }
            },
            "curves": {
                effectMatchName: "ADBE CurvesCustom"
            },
            "glow": {
                effectMatchName: "ADBE Glow",
                settings: { "Glow Threshold": customSettings.threshold !== undefined ? customSettings.threshold : 50, "Glow Radius": customSettings.radius !== undefined ? customSettings.radius : 15, "Glow Intensity": customSettings.intensity !== undefined ? customSettings.intensity : 1 }
            },
            "drop-shadow": {
                effectMatchName: "ADBE Drop Shadow",
                settings: {
                    "Shadow Color": customSettings.color !== undefined ? customSettings.color : [0, 0, 0, 1],
                    "Opacity": customSettings.opacity !== undefined ? customSettings.opacity : 50,
                    "Direction": customSettings.direction !== undefined ? customSettings.direction : 135,
                    "Distance": customSettings.distance !== undefined ? customSettings.distance : 10,
                    "Softness": customSettings.softness !== undefined ? customSettings.softness : 10
                }
            },
            "cinematic-look": {
                effects: [
                    { effectMatchName: "ADBE CurvesCustom", settings: {} },
                    { effectMatchName: "ADBE Vibrance", settings: { "Vibrance": 15, "Saturation": -5 } }
                ]
            },
            "text-pop": {
                effects: [
                    { effectMatchName: "ADBE Drop Shadow", settings: { "Shadow Color": [0, 0, 0, 1], "Opacity": 75, "Distance": 5, "Softness": 10 } },
                    { effectMatchName: "ADBE Glow", settings: { "Glow Threshold": 50, "Glow Radius": 10, "Glow Intensity": 1.5 } }
                ]
            }
        };

        var template = templates[templateName];
        if (!template) {
            var available = [];
            for (var k in templates) { if (templates.hasOwnProperty(k)) { available.push(k); } }
            throw _err(ERROR_CODES.INVALID_ARGS, "Template '" + templateName + "' not found. Available: " + available.join(", "));
        }

        var appliedEffects = [];
        var allFailed = [];

        if (template.effectMatchName) {
            var effect = layer.Effects.addProperty(template.effectMatchName);
            // Single-effect templates: settings are already merged with customSettings above (per-key
            // resolution in the templates dict), so just apply them as-is.
            var fp = applyEffectSettings(effect, template.settings || {});
            for (var fpi = 0; fpi < fp.length; fpi++) { allFailed.push({ effectName: effect.name, name: fp[fpi].name, reason: fp[fpi].reason }); }
            appliedEffects.push({ name: effect.name, matchName: effect.matchName });
        } else if (template.effects) {
            // Multi-effect templates: customSettings can be flat (apply to every sub-effect) or
            // per-index ({ "0": {...}, "1": {...} }). Per-index wins where both could match.
            for (var i = 0; i < template.effects.length; i++) {
                var effectData = template.effects[i];
                var effect = layer.Effects.addProperty(effectData.effectMatchName);

                var merged = {};
                for (var bk in effectData.settings) {
                    if (effectData.settings.hasOwnProperty(bk)) { merged[bk] = effectData.settings[bk]; }
                }
                var perIndex = customSettings[i] || customSettings[String(i)];
                var overrideSrc = perIndex ? perIndex : customSettings;
                for (var ck in overrideSrc) {
                    if (overrideSrc.hasOwnProperty(ck) && typeof overrideSrc[ck] !== "object") {
                        merged[ck] = overrideSrc[ck];
                    } else if (overrideSrc.hasOwnProperty(ck) && perIndex) {
                        // Per-index override may carry object values (e.g. color arrays)
                        merged[ck] = overrideSrc[ck];
                    }
                }

                var fp = applyEffectSettings(effect, merged);
                for (var fpi = 0; fpi < fp.length; fpi++) { allFailed.push({ effectName: effect.name, name: fp[fpi].name, reason: fp[fpi].reason }); }
                appliedEffects.push({ name: effect.name, matchName: effect.matchName });
            }
        }

        return JSON.stringify({
            status: "success",
            message: "Effect template '" + templateName + "' applied successfully",
            appliedEffects: appliedEffects,
            layer: { name: layer.name, index: layer.index },
            composition: { name: comp.name },
            failedProperties: allFailed.length > 0 ? allFailed : undefined
        }, null, 2);
    } catch (error) {
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
