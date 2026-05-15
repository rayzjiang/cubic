// effects.jsx
// CRUD: C ✓  R ✓  U ✓  D ✓

// ── Shared helpers ────────────────────────────────────────────────────────────

function resolveEffectsComp(compName) {
    var comp = null;
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof CompItem && item.name === compName) { comp = item; break; }
    }
    if (!comp) {
        if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
        else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
    }
    return comp;
}

function resolveEffectsLayer(comp, layerIndex, layerName) {
    if (layerIndex !== undefined && layerIndex !== null) {
        if (layerIndex < 1 || layerIndex > comp.numLayers) { throw new Error("Layer index out of bounds: " + layerIndex); }
        return comp.layer(layerIndex);
    }
    if (layerName) {
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === layerName) { return comp.layer(i); }
        }
        throw new Error("Layer not found with name '" + layerName + "'");
    }
    throw new Error("layerIndex or layerName is required");
}

// Applies a settings dict to an effect — used by applyEffect and applyEffectTemplate
function applyEffectSettings(effect, settings) {
    if (!settings) return;
    var hasKeys = false;
    for (var k in settings) { if (settings.hasOwnProperty(k)) { hasKeys = true; break; } }
    if (!hasKeys) return;

    for (var propName in settings) {
        if (settings.hasOwnProperty(propName)) {
            try {
                var property = null;
                try {
                    property = effect.property(propName);
                } catch (e) {
                    for (var i = 1; i <= effect.numProperties; i++) {
                        var prop = effect.property(i);
                        if (prop.name === propName) { property = prop; break; }
                    }
                }
                if (property && property.setValue) { property.setValue(settings[propName]); }
            } catch (e) {
                $.writeln("Error setting effect property '" + propName + "': " + e.toString());
            }
        }
    }
}

// ── R: getLayerEffects ────────────────────────────────────────────────────────

function getLayerEffects(args) {
    try {
        var comp = resolveEffectsComp(args.compName || "");
        var layer = resolveEffectsLayer(comp, args.layerIndex, args.layerName);

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
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// ── C: applyEffect ────────────────────────────────────────────────────────────

function applyEffect(args) {
    try {
        var comp = resolveEffectsComp(args.compName || "");
        var layer = resolveEffectsLayer(comp, args.layerIndex, args.layerName);

        var effectName = args.effectName;
        var effectMatchName = args.effectMatchName;
        var presetPath = args.presetPath;
        var effectSettings = args.effectSettings || {};

        if (!effectName && !effectMatchName && !presetPath) {
            throw new Error("You must specify either effectName, effectMatchName, or presetPath");
        }

        var effectResult;

        if (presetPath) {
            var presetFile = new File(presetPath);
            if (!presetFile.exists) { throw new Error("Effect preset file not found: " + presetPath); }
            layer.applyPreset(presetFile);
            effectResult = { type: "preset", name: presetPath.split('/').pop().split('\\').pop(), applied: true };
        } else if (effectMatchName) {
            var effect = layer.Effects.addProperty(effectMatchName);
            effectResult = { type: "effect", name: effect.name, matchName: effect.matchName, index: effect.propertyIndex };
            applyEffectSettings(effect, effectSettings);
        } else {
            var effect = layer.Effects.addProperty(effectName);
            effectResult = { type: "effect", name: effect.name, matchName: effect.matchName, index: effect.propertyIndex };
            applyEffectSettings(effect, effectSettings);
        }

        return JSON.stringify({
            status: "success",
            message: "Effect applied successfully",
            effect: effectResult,
            layer: { name: layer.name, index: layer.index },
            composition: { name: comp.name }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// ── C: applyEffectTemplate ────────────────────────────────────────────────────
//
// Templates are hardcoded here — ExtendScript has no external config mechanism
// (no require(), no fs). Adding a new template means editing this dict, then:
//   npm run build && npm run install-bridge + reopen panel in AE.

function applyEffectTemplate(args) {
    try {
        var comp = resolveEffectsComp(args.compName || "");
        var layer = resolveEffectsLayer(comp, args.layerIndex, args.layerName);

        var templateName = args.templateName;
        var customSettings = args.customSettings || {};

        if (!templateName) { throw new Error("You must specify a templateName"); }

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
            throw new Error("Template '" + templateName + "' not found. Available: " + available.join(", "));
        }

        var appliedEffects = [];

        if (template.effectMatchName) {
            var effect = layer.Effects.addProperty(template.effectMatchName);
            for (var propName in template.settings) {
                try {
                    var property = effect.property(propName);
                    if (property) { property.setValue(template.settings[propName]); }
                } catch (e) {
                    $.writeln("Warning: Could not set " + propName + " on " + effect.name + ": " + e);
                }
            }
            appliedEffects.push({ name: effect.name, matchName: effect.matchName });
        } else if (template.effects) {
            for (var i = 0; i < template.effects.length; i++) {
                var effectData = template.effects[i];
                var effect = layer.Effects.addProperty(effectData.effectMatchName);
                for (var propName in effectData.settings) {
                    try {
                        var property = effect.property(propName);
                        if (property) { property.setValue(effectData.settings[propName]); }
                    } catch (e) {
                        $.writeln("Warning: Could not set " + propName + " on " + effect.name + ": " + e);
                    }
                }
                appliedEffects.push({ name: effect.name, matchName: effect.matchName });
            }
        }

        return JSON.stringify({
            status: "success",
            message: "Effect template '" + templateName + "' applied successfully",
            appliedEffects: appliedEffects,
            layer: { name: layer.name, index: layer.index },
            composition: { name: comp.name }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// ── U: setEffectProperty ──────────────────────────────────────────────────────

function setEffectProperty(args) {
    try {
        var comp = resolveEffectsComp(args.compName || "");
        var layer = resolveEffectsLayer(comp, args.layerIndex, args.layerName);

        var effectsGroup = layer.property("Effects");
        var eff = null;
        if (args.effectIndex !== undefined && args.effectIndex !== null) {
            if (args.effectIndex > 0 && args.effectIndex <= effectsGroup.numProperties) {
                eff = effectsGroup.property(args.effectIndex);
            } else {
                throw new Error("Effect index out of bounds: " + args.effectIndex);
            }
        } else if (args.effectName) {
            for (var i = 1; i <= effectsGroup.numProperties; i++) {
                if (effectsGroup.property(i).name === args.effectName) { eff = effectsGroup.property(i); break; }
            }
        }
        if (!eff) { throw new Error("Effect not found: " + (args.effectName || "index " + args.effectIndex)); }

        var property = null;
        try {
            property = eff.property(args.propertyName);
        } catch (e) {
            for (var p = 1; p <= eff.numProperties; p++) {
                if (eff.property(p).name === args.propertyName) { property = eff.property(p); break; }
            }
        }
        if (!property) { throw new Error("Property '" + args.propertyName + "' not found on effect '" + eff.name + "'"); }

        property.setValue(args.value);

        return JSON.stringify({
            status: "success",
            message: "Effect property updated",
            effect: { name: eff.name, index: eff.propertyIndex },
            property: { name: args.propertyName, value: property.value },
            layer: { name: layer.name, index: layer.index }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// ── D: deleteEffect ───────────────────────────────────────────────────────────

function deleteEffect(args) {
    try {
        var comp = resolveEffectsComp(args.compName || "");
        var layer = resolveEffectsLayer(comp, args.layerIndex, args.layerName);

        var effectsGroup = layer.property("Effects");
        var eff = null;
        if (args.effectIndex !== undefined && args.effectIndex !== null) {
            if (args.effectIndex > 0 && args.effectIndex <= effectsGroup.numProperties) {
                eff = effectsGroup.property(args.effectIndex);
            } else {
                throw new Error("Effect index out of bounds: " + args.effectIndex);
            }
        } else if (args.effectName) {
            for (var i = 1; i <= effectsGroup.numProperties; i++) {
                if (effectsGroup.property(i).name === args.effectName) { eff = effectsGroup.property(i); break; }
            }
        }
        if (!eff) { throw new Error("Effect not found: " + (args.effectName || "index " + args.effectIndex)); }

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
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}
