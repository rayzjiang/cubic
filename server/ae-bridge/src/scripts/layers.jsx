// layers.jsx
// Core layer CRUD + transforms + movement + parenting + selection + trim/split + precompose.
// Text-specific handlers live in text.jsx; shape-specific handlers live in shapes.jsx.
// CRUD: C ✓  R ✓  U ✓  D ✓

// ── Shared: keyframe-overwrite guard ──────────────────────────────────────────
// Enforces the "throw unless overwriteKeyframes:true" policy. Returns true after clearing.
function _guardKeyframeOverwrite(prop, propLabel, overwriteKeyframes) {
    if (prop.numKeys > 0) {
        if (!overwriteKeyframes) {
            throw _err(ERROR_CODES.INVALID_ARGS,
                "'" + propLabel + "' has " + prop.numKeys + " keyframe(s). Pass overwriteKeyframes: true to clear and overwrite, or use setLayerKeyframe to target a specific time.");
        }
        while (prop.numKeys > 0) { prop.removeKey(1); }
    }
    return true;
}

var AUTO_ORIENT_LABELS = {};
AUTO_ORIENT_LABELS[AutoOrientType.NO_AUTO_ORIENT]              = "off";
AUTO_ORIENT_LABELS[AutoOrientType.ALONG_PATH]                  = "alongPath";
AUTO_ORIENT_LABELS[AutoOrientType.CAMERA_OR_POINT_OF_INTEREST] = "cameraOrPOI";
AUTO_ORIENT_LABELS[AutoOrientType.CHARACTERS_TOWARDS_CAMERA]   = "charactersTowardsCamera";

var BLEND_MODES = {
    "normal": BlendingMode.NORMAL, "add": BlendingMode.ADD, "multiply": BlendingMode.MULTIPLY,
    "screen": BlendingMode.SCREEN, "overlay": BlendingMode.OVERLAY, "softLight": BlendingMode.SOFT_LIGHT,
    "hardLight": BlendingMode.HARD_LIGHT, "colorDodge": BlendingMode.COLOR_DODGE, "colorBurn": BlendingMode.COLOR_BURN,
    "darken": BlendingMode.DARKEN, "lighten": BlendingMode.LIGHTEN, "difference": BlendingMode.DIFFERENCE,
    "exclusion": BlendingMode.EXCLUSION, "hue": BlendingMode.HUE, "saturation": BlendingMode.SATURATION,
    "color": BlendingMode.COLOR, "luminosity": BlendingMode.LUMINOSITY
};
var QUALITY_MAP = { "best": LayerQuality.BEST, "draft": LayerQuality.DRAFT, "wireframe": LayerQuality.WIREFRAME };
var AUTO_ORIENT_MAP = { "off": AutoOrientType.NO_AUTO_ORIENT, "alongPath": AutoOrientType.ALONG_PATH, "cameraOrPOI": AutoOrientType.CAMERA_OR_POINT_OF_INTEREST, "charactersTowardsCamera": AutoOrientType.CHARACTERS_TOWARDS_CAMERA };
var MATTE_TYPES = { "none": TrackMatteType.NO_TRACK_MATTE, "alpha": TrackMatteType.ALPHA, "alphaInverted": TrackMatteType.ALPHA_INVERTED, "luma": TrackMatteType.LUMA, "lumaInverted": TrackMatteType.LUMA_INVERTED };

// R: getLayerInfo
function getLayerInfo(args) {
    try {
        var activeComp = null;
        if (args && args.compName) {
            activeComp = _resolveComp(args);
        } else if (app.project.activeItem instanceof CompItem) {
            activeComp = app.project.activeItem;
        } else {
            throw _err(ERROR_CODES.COMP_NOT_FOUND, "compName is required — project item indices are unreliable");
        }

        var result = { layers: [] };

        for (var i = 1; i <= activeComp.numLayers; i++) {
            var layer = activeComp.layer(i);
            var layerType = "unknown";
            if (layer instanceof TextLayer) { layerType = "text"; }
            else if (layer instanceof ShapeLayer) { layerType = "shape"; }
            else if (layer instanceof CameraLayer) { layerType = "camera"; }
            else if (layer instanceof LightLayer) { layerType = "light"; }
            else if (layer instanceof AVLayer) {
                layerType = layer.nullLayer ? "null" : (layer.adjustmentLayer ? "adjustment" : "solid");
            }

            var scaleProp   = layer.property("Scale");
            var opacityProp = layer.property("Opacity");
            var rotProp     = layer.threeDLayer ? layer.property("Z Rotation") : layer.property("Rotation");

            var layerInfo = {
                index: layer.index,
                name: layer.name,
                type: layerType,
                enabled: layer.enabled,
                locked: layer.locked,
                threeDLayer: layer.threeDLayer,
                autoOrient: AUTO_ORIENT_LABELS[layer.autoOrient] || layer.autoOrient,
                position: layer.property("Position") ? layer.property("Position").value : null,
                scale: scaleProp   ? scaleProp.value   : null,
                rotation: rotProp  ? rotProp.value      : null,
                opacity: opacityProp ? opacityProp.value : null,
                inPoint: layer.inPoint,
                outPoint: layer.outPoint,
                parent: layer.parent ? { name: layer.parent.name, index: layer.parent.index } : null,
                effectsCount: layer.property("Effects") ? layer.property("Effects").numProperties : 0,
                masksCount: layer.property("Masks") ? layer.property("Masks").numProperties : 0
            };

            // Motion blur switch — only AVLayers have it (cameras/lights throw), so guard the read.
            try { layerInfo.motionBlur = layer.motionBlur; } catch (mbErr) {}

            // Blend mode as a friendly label (reverse of BLEND_MODES) — enables read-back verification.
            for (var bmk in BLEND_MODES) {
                if (BLEND_MODES.hasOwnProperty(bmk) && BLEND_MODES[bmk] === layer.blendingMode) { layerInfo.blendMode = bmk; break; }
            }

            // Type-specific fields
            if (layer instanceof CameraLayer) {
                var camOpts = layer.property("Camera Options");
                layerInfo.zoom        = camOpts ? camOpts.property("Zoom").value : null;
                var poi               = layer.property("Point of Interest");
                layerInfo.pointOfInterest = poi ? poi.value : null;
                if (camOpts) {
                    try { layerInfo.depthOfField  = camOpts.property("Depth of Field").value;  } catch(e2) {}
                    try { layerInfo.focusDistance = camOpts.property("Focus Distance").value;  } catch(e2) {}
                    try { layerInfo.aperture      = camOpts.property("Aperture").value;        } catch(e2) {}
                    try { layerInfo.blurLevel     = camOpts.property("Blur Level").value;      } catch(e2) {}
                }
            } else if (layer instanceof LightLayer) {
                var lightTypeLabels = {};
                lightTypeLabels[LightType.PARALLEL] = "parallel";
                lightTypeLabels[LightType.SPOT]     = "spot";
                lightTypeLabels[LightType.POINT]    = "point";
                lightTypeLabels[LightType.AMBIENT]  = "ambient";
                layerInfo.lightType = lightTypeLabels[layer.lightType] || "unknown";
                var lightOpts = layer.property("Light Options");
                if (lightOpts) {
                    try { layerInfo.intensity       = lightOpts.property("Intensity").value;        } catch(e2) {}
                    try { layerInfo.lightColor      = lightOpts.property("Color").value;            } catch(e2) {}
                    if (layer.lightType === LightType.SPOT) {
                        try { layerInfo.coneAngle   = lightOpts.property("Cone Angle").value;   } catch(e2) {}
                        try { layerInfo.coneFeather = lightOpts.property("Cone Feather").value; } catch(e2) {}
                    }
                    try { layerInfo.falloff         = lightOpts.property("Falloff").value;          } catch(e2) {}
                    try { layerInfo.radius          = lightOpts.property("Radius").value;           } catch(e2) {}
                    try { layerInfo.falloffDistance = lightOpts.property("Falloff Distance").value; } catch(e2) {}
                    try { layerInfo.castsShadows    = lightOpts.property("Casts Shadows").value;    } catch(e2) {}
                    try { layerInfo.shadowDarkness  = lightOpts.property("Shadow Darkness").value;  } catch(e2) {}
                    try { layerInfo.shadowDiffusion = lightOpts.property("Shadow Diffusion").value; } catch(e2) {}
                }
            }

            result.layers.push(layerInfo);
        }

        return JSON.stringify(result, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: createSolidLayer
function createSolidLayer(args) {
    var solidLayer = null;  // tracked for atomic-create rollback (see catch)
    try {
        var comp = _resolveComp(args);
        var color = args.color || [1, 1, 1];
        var name = args.name || "Solid Layer";
        var position = args.position;
        var size = args.size;
        var startTime = args.startTime || 0;
        var duration = args.duration || 5;
        var isAdjustment = args.isAdjustment || false;

        if (!size) { size = [comp.width, comp.height]; }
        if (!position) { position = [comp.width / 2, comp.height / 2]; }
        if (isAdjustment) {
            solidLayer = comp.layers.addSolid([0, 0, 0], name, size[0], size[1], 1);
            solidLayer.adjustmentLayer = true;
        } else {
            solidLayer = comp.layers.addSolid(color, name, size[0], size[1], 1);
        }
        solidLayer.property("Position").setValue(position);
        solidLayer.startTime = startTime;
        if (duration > 0) { solidLayer.outPoint = startTime + duration; }
        return JSON.stringify({
            status: "success", message: isAdjustment ? "Adjustment layer created successfully" : "Solid layer created successfully",
            layer: { name: solidLayer.name, index: solidLayer.index, type: isAdjustment ? "adjustment" : "solid", inPoint: solidLayer.inPoint, outPoint: solidLayer.outPoint, position: solidLayer.property("Position").value, isAdjustment: solidLayer.adjustmentLayer },
            configurableProperties: _configurableChildren(solidLayer, [])
        }, null, 2);
    } catch (error) {
        // Roll back the partially-created layer so a failed create leaves no orphan.
        if (solidLayer !== null) { try { solidLayer.remove(); } catch (e2) {} }
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: createCamera
function createCamera(args) {
    var cameraLayer = null;  // tracked for atomic-create rollback (see catch)
    try {
        var comp = _resolveComp(args);
        var name            = args.name || "Camera";
        var zoom            = args.zoom || 1777.78; // Default ~50mm equivalent
        var position        = args.position;
        var pointOfInterest = args.pointOfInterest;
        var oneNode         = args.oneNode || false;
        var startTime       = args.startTime !== undefined ? parseFloat(args.startTime) : 0;
        var duration        = args.duration  !== undefined ? parseFloat(args.duration)  : 5;
        var depthOfField    = args.depthOfField;
        var focusDistance   = args.focusDistance;
        var aperture        = args.aperture;
        var blurLevel       = args.blurLevel;

        var centerPoint = [comp.width / 2, comp.height / 2];
        cameraLayer = comp.layers.addCamera(name, centerPoint);
        var camOpts = cameraLayer.property("Camera Options");
        camOpts.property("Zoom").setValue(zoom);

        if (oneNode) { cameraLayer.autoOrient = AutoOrientType.NO_AUTO_ORIENT; }
        if (position !== undefined && position !== null) { cameraLayer.property("Position").setValue(position); }
        if (pointOfInterest !== undefined && pointOfInterest !== null && !oneNode) {
            cameraLayer.property("Point of Interest").setValue(pointOfInterest);
        }

        cameraLayer.startTime = startTime;
        if (duration > 0) { cameraLayer.outPoint = startTime + duration; }

        if (depthOfField !== undefined && depthOfField !== null) { try { camOpts.property("Depth of Field").setValue(depthOfField ? 1 : 0); } catch(e2) {} }
        if (focusDistance !== undefined && focusDistance !== null) { try { camOpts.property("Focus Distance").setValue(parseFloat(focusDistance)); } catch(e2) {} }
        if (aperture !== undefined && aperture !== null) { try { camOpts.property("Aperture").setValue(parseFloat(aperture)); } catch(e2) {} }
        if (blurLevel !== undefined && blurLevel !== null) { try { camOpts.property("Blur Level").setValue(parseFloat(blurLevel)); } catch(e2) {} }

        var result = {
            name: cameraLayer.name,
            index: cameraLayer.index,
            inPoint: cameraLayer.inPoint,
            outPoint: cameraLayer.outPoint,
            zoom: camOpts.property("Zoom").value,
            position: cameraLayer.property("Position").value,
            oneNode: oneNode
        };
        if (!oneNode) { result.pointOfInterest = cameraLayer.property("Point of Interest").value; }
        try { result.depthOfField  = camOpts.property("Depth of Field").value;  } catch(e2) {}
        try { result.focusDistance = camOpts.property("Focus Distance").value;  } catch(e2) {}
        try { result.aperture      = camOpts.property("Aperture").value;        } catch(e2) {}
        try { result.blurLevel     = camOpts.property("Blur Level").value;      } catch(e2) {}

        return JSON.stringify({ status: "success", message: "Camera created successfully", layer: result, configurableProperties: _configurableChildren(cameraLayer, []) }, null, 2);
    } catch (error) {
        // Roll back the partially-created layer so a failed create leaves no orphan.
        if (cameraLayer !== null) { try { cameraLayer.remove(); } catch (e2) {} }
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: createLightLayer
function createLightLayer(args) {
    var lightLayer = null;  // tracked for atomic-create rollback (see catch)
    try {
        var comp = _resolveComp(args);
        var name            = args.name || "Light";
        var lightType       = args.lightType || "point";
        var intensity       = args.intensity  !== undefined ? args.intensity  : 100;
        var color           = args.color      || [1, 1, 1];
        var position        = args.position;
        var startTime       = args.startTime  !== undefined ? parseFloat(args.startTime) : 0;
        var duration        = args.duration   !== undefined ? parseFloat(args.duration)  : 5;
        var coneAngle       = args.coneAngle;
        var coneFeather     = args.coneFeather;
        var falloff         = args.falloff;
        var radius          = args.radius;
        var falloffDistance = args.falloffDistance;
        var castsShadows    = args.castsShadows;
        var shadowDarkness  = args.shadowDarkness;
        var shadowDiffusion = args.shadowDiffusion;

        var centerPoint = [comp.width / 2, comp.height / 2];
        lightLayer = comp.layers.addLight(name, centerPoint);
        var lightTypes = { "parallel": LightType.PARALLEL, "spot": LightType.SPOT, "point": LightType.POINT, "ambient": LightType.AMBIENT };
        if (lightTypes[lightType] !== undefined) { lightLayer.lightType = lightTypes[lightType]; }
        var lightOpts = lightLayer.property("Light Options");
        lightOpts.property("Intensity").setValue(intensity);
        lightOpts.property("Color").setValue(color);
        if (position !== undefined && position !== null) { lightLayer.property("Position").setValue(position); }
        lightLayer.startTime = startTime;
        if (duration > 0) { lightLayer.outPoint = startTime + duration; }

        var isSpot = lightTypes[lightType] === LightType.SPOT;
        var warnings = [];
        if (coneAngle   !== undefined && coneAngle   !== null) { if (isSpot) { try { lightOpts.property("Cone Angle").setValue(parseFloat(coneAngle));   } catch(e2) {} } else { warnings.push("coneAngle requires spot light type"); } }
        if (coneFeather !== undefined && coneFeather !== null) { if (isSpot) { try { lightOpts.property("Cone Feather").setValue(parseFloat(coneFeather)); } catch(e2) {} } else { warnings.push("coneFeather requires spot light type"); } }
        if (falloff !== undefined && falloff !== null) {
            var LFMAP = { "none": 0, "smooth": 1, "inverseSquare": 2 };
            var lfVal = (LFMAP[falloff] !== undefined) ? LFMAP[falloff] : parseInt(falloff);
            try { lightOpts.property("Falloff").setValue(lfVal); } catch(e2) {}
        }
        if (radius          !== undefined && radius          !== null) { try { lightOpts.property("Radius").setValue(parseFloat(radius));                   } catch(e2) {} }
        if (falloffDistance !== undefined && falloffDistance !== null) { try { lightOpts.property("Falloff Distance").setValue(parseFloat(falloffDistance)); } catch(e2) {} }
        if (castsShadows    !== undefined && castsShadows    !== null) { try { lightOpts.property("Casts Shadows").setValue(castsShadows ? 1 : 0);          } catch(e2) {} }
        if (shadowDarkness  !== undefined && shadowDarkness  !== null) { try { lightOpts.property("Shadow Darkness").setValue(parseFloat(shadowDarkness));  } catch(e2) {} }
        if (shadowDiffusion !== undefined && shadowDiffusion !== null) { try { lightOpts.property("Shadow Diffusion").setValue(parseFloat(shadowDiffusion));} catch(e2) {} }

        var layerResult = {
            name: lightLayer.name, index: lightLayer.index, type: "light", lightType: lightType,
            inPoint: lightLayer.inPoint, outPoint: lightLayer.outPoint, position: lightLayer.property("Position").value,
            intensity: lightOpts.property("Intensity").value, color: lightOpts.property("Color").value
        };
        if (isSpot) {
            try { layerResult.coneAngle   = lightOpts.property("Cone Angle").value;   } catch(e2) {}
            try { layerResult.coneFeather = lightOpts.property("Cone Feather").value; } catch(e2) {}
        }
        try { layerResult.falloff         = lightOpts.property("Falloff").value;          } catch(e2) {}
        try { layerResult.radius          = lightOpts.property("Radius").value;           } catch(e2) {}
        try { layerResult.falloffDistance = lightOpts.property("Falloff Distance").value; } catch(e2) {}
        try { layerResult.castsShadows    = lightOpts.property("Casts Shadows").value;    } catch(e2) {}
        try { layerResult.shadowDarkness  = lightOpts.property("Shadow Darkness").value;  } catch(e2) {}
        try { layerResult.shadowDiffusion = lightOpts.property("Shadow Diffusion").value; } catch(e2) {}
        if (warnings.length > 0) { layerResult.warnings = warnings; }

        return JSON.stringify({ status: "success", message: "Light layer created successfully", layer: layerResult, configurableProperties: _configurableChildren(lightLayer, []) }, null, 2);
    } catch (error) {
        // Roll back the partially-created layer so a failed create leaves no orphan.
        if (lightLayer !== null) { try { lightLayer.remove(); } catch (e2) {} }
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: createNullLayer
function createNullLayer(args) {
    var nullLayer = null;  // tracked for atomic-create rollback (see catch)
    try {
        var comp = _resolveComp(args);
        var name = args.name || "Null";
        var position = args.position;
        var threeDLayer = args.threeDLayer || false;
        var startTime = args.startTime || 0;
        var duration = args.duration || 5;

        nullLayer = comp.layers.addNull();
        nullLayer.name = name;
        nullLayer.threeDLayer = !!threeDLayer;
        if (position !== undefined && position !== null) { nullLayer.property("Position").setValue(position); }
        nullLayer.startTime = startTime;
        if (duration > 0) { nullLayer.outPoint = startTime + duration; }
        return JSON.stringify({
            status: "success", message: "Null layer created successfully",
            layer: { name: nullLayer.name, index: nullLayer.index, type: "null", threeDLayer: nullLayer.threeDLayer, inPoint: nullLayer.inPoint, outPoint: nullLayer.outPoint, position: nullLayer.property("Position").value },
            configurableProperties: _configurableChildren(nullLayer, [])
        }, null, 2);
    } catch (error) {
        // Roll back the partially-created layer so a failed create leaves no orphan.
        if (nullLayer !== null) { try { nullLayer.remove(); } catch (e2) {} }
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: createLayer — unified dispatcher (type: text|shape|solid|adjustment|null|camera|light)
function createLayer(args) {
    var type = (args.type || "").toLowerCase();
    var delegateArgs = {};
    for (var k in args) {
        if (args.hasOwnProperty(k) && k !== "type") { delegateArgs[k] = args[k]; }
    }
    switch (type) {
        case "text":       return createTextLayer(delegateArgs);
        case "shape":      return createShapeLayer(delegateArgs);
        case "solid":      return createSolidLayer(delegateArgs);
        case "adjustment": delegateArgs.isAdjustment = true; return createSolidLayer(delegateArgs);
        case "null":       return createNullLayer(delegateArgs);
        case "camera":     return createCamera(delegateArgs);
        case "light":      return createLightLayer(delegateArgs);
        default:
            return JSON.stringify({ status: "error", errorCode: ERROR_CODES.INVALID_ARGS, message: "Unknown layer type: '" + type + "'. Use: text, shape, solid, adjustment, null, camera, light." }, null, 2);
    }
}

// C: duplicateLayer
function duplicateLayer(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;
        var newName = args.newName; // optional rename

        var newLayer = layer.duplicate();
        if (newName) { newLayer.name = newName; }

        return JSON.stringify({
            status: "success",
            message: "Layer duplicated successfully",
            original: { name: layer.name, index: layer.index },
            duplicate: { name: newLayer.name, index: newLayer.index },
            configurableProperties: _configurableChildren(newLayer, [])
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: setLayerProperties
function setLayerProperties(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;
        var overwriteKeyframes = args.overwriteKeyframes === true;

        // Validate-first: reject any invalid enum / unresolvable font BEFORE mutating, so a bad
        // arg can't leave a partial update. Resolve to the values the mutation code reuses below.
        var blendModeVal = null, matteTypeVal = null, qualityVal = null, autoOrientVal = null, resolvedFontFamily = null;
        if (args.blendMode !== undefined && args.blendMode !== null) { blendModeVal = _requireEnum(args.blendMode, BLEND_MODES, "blendMode"); }
        if (args.trackMatteType !== undefined && args.trackMatteType !== null) { matteTypeVal = _requireEnum(args.trackMatteType, MATTE_TYPES, "trackMatteType"); }
        if (args.quality !== undefined && args.quality !== null) { qualityVal = _requireEnum(args.quality, QUALITY_MAP, "quality"); }
        if (args.autoOrient !== undefined && args.autoOrient !== null) { autoOrientVal = _requireEnum(args.autoOrient, AUTO_ORIENT_MAP, "autoOrient"); }
        if (layer instanceof TextLayer && args.fontFamily !== undefined && args.fontFamily !== null) { resolvedFontFamily = _resolveFont(args.fontFamily); }

        // Capture prior state for revert (only for fields the args touch)
        var previousValues = {};
        if (args.enabled !== undefined && args.enabled !== null) { previousValues.enabled = layer.enabled; }
        if (args.threeDLayer !== undefined && args.threeDLayer !== null) { previousValues.threeDLayer = layer.threeDLayer; }
        if (args.motionBlur !== undefined && args.motionBlur !== null) { previousValues.motionBlur = layer.motionBlur; }
        if (args.blendMode !== undefined && args.blendMode !== null) {
            var prevBM = "unknown";
            for (var bk in BLEND_MODES) { if (BLEND_MODES.hasOwnProperty(bk) && BLEND_MODES[bk] === layer.blendingMode) { prevBM = bk; break; } }
            previousValues.blendMode = prevBM;
        }
        if (args.trackMatteType !== undefined && args.trackMatteType !== null) {
            var prevMT = "unknown";
            for (var mk in MATTE_TYPES) { if (MATTE_TYPES.hasOwnProperty(mk) && MATTE_TYPES[mk] === layer.trackMatteType) { prevMT = mk; break; } }
            previousValues.trackMatteType = prevMT;
        }
        if (args.position !== undefined && args.position !== null) { previousValues.position = layer.property("Position").value; }
        if (args.scale !== undefined && args.scale !== null) { previousValues.scale = layer.property("Scale").value; }
        if (args.rotation !== undefined && args.rotation !== null) { previousValues.rotation = layer.threeDLayer ? layer.property("Z Rotation").value : layer.property("Rotation").value; }
        if (args.opacity !== undefined && args.opacity !== null) { previousValues.opacity = layer.property("Opacity").value; }
        if (args.anchorPoint !== undefined && args.anchorPoint !== null) { previousValues.anchorPoint = layer.property("Anchor Point").value; }
        if (args.startTime !== undefined && args.startTime !== null) { previousValues.startTime = layer.startTime; }
        if (args.duration !== undefined && args.duration !== null) { previousValues.duration = layer.outPoint - layer.inPoint; }
        if (args.stretch !== undefined && args.stretch !== null) { previousValues.stretch = layer.stretch; }
        if (layer instanceof TextLayer) {
            var srcSnap = layer.property("Source Text");
            if (srcSnap && srcSnap.value) {
                var tdSnap = srcSnap.value;
                if (args.text !== undefined && args.text !== null) { previousValues.text = tdSnap.text; }
                if (args.fontFamily !== undefined && args.fontFamily !== null) { previousValues.fontFamily = tdSnap.font; }
                if (args.fontSize !== undefined && args.fontSize !== null) { previousValues.fontSize = tdSnap.fontSize; }
                if (args.fillColor !== undefined && args.fillColor !== null) { previousValues.fillColor = tdSnap.fillColor; }
            }
        }

        var changedProperties = [];
        var textDocument = null;

        // --- Text Property Handling ---
        var textContent = args.text;
        var fontFamily  = args.fontFamily;
        var fontSize    = args.fontSize;
        var fillColor   = args.fillColor;
        if (layer instanceof TextLayer && (textContent !== undefined || fontFamily !== undefined || fontSize !== undefined || fillColor !== undefined)) {
            var sourceTextProp = layer.property("Source Text");
            if (sourceTextProp && sourceTextProp.value) {
                var currentTextDocument = sourceTextProp.value;
                var updated = false;

                if (textContent !== undefined && textContent !== null && currentTextDocument.text !== textContent) {
                    currentTextDocument.text = textContent;
                    changedProperties.push("text");
                    updated = true;
                }
                if (resolvedFontFamily !== null && currentTextDocument.font !== resolvedFontFamily) {
                    currentTextDocument.font = resolvedFontFamily;
                    changedProperties.push("fontFamily");
                    updated = true;
                }
                if (fontSize !== undefined && fontSize !== null && currentTextDocument.fontSize !== fontSize) {
                    currentTextDocument.fontSize = fontSize;
                    changedProperties.push("fontSize");
                    updated = true;
                }
                if (fillColor !== undefined && fillColor !== null &&
                    (currentTextDocument.fillColor[0] !== fillColor[0] ||
                     currentTextDocument.fillColor[1] !== fillColor[1] ||
                     currentTextDocument.fillColor[2] !== fillColor[2])) {
                    currentTextDocument.fillColor = fillColor;
                    changedProperties.push("fillColor");
                    updated = true;
                }

                if (updated) { sourceTextProp.setValue(currentTextDocument); }
                textDocument = currentTextDocument;
            }
        }

        // --- Boolean toggles + enums ---
        if (args.enabled !== undefined && args.enabled !== null) { layer.enabled = !!args.enabled; changedProperties.push("enabled"); }
        if (args.selected !== undefined && args.selected !== null) { layer.selected = !!args.selected; changedProperties.push("selected"); }

        if (blendModeVal !== null) { layer.blendingMode = blendModeVal; changedProperties.push("blendMode"); }

        if (matteTypeVal !== null) { layer.trackMatteType = matteTypeVal; changedProperties.push("trackMatteType"); }

        if (args.threeDLayer !== undefined && args.threeDLayer !== null) { layer.threeDLayer = !!args.threeDLayer; changedProperties.push("threeDLayer"); }
        if (args.motionBlur !== undefined && args.motionBlur !== null) { layer.motionBlur = !!args.motionBlur; changedProperties.push("motionBlur"); }
        if (args.collapseTransformation !== undefined && args.collapseTransformation !== null) { layer.collapseTransformation = !!args.collapseTransformation; changedProperties.push("collapseTransformation"); }
        if (args.shy !== undefined && args.shy !== null) { layer.shy = !!args.shy; changedProperties.push("shy"); }
        if (args.solo !== undefined && args.solo !== null) { layer.solo = !!args.solo; changedProperties.push("solo"); }
        if (args.guideLayer !== undefined && args.guideLayer !== null) { layer.guideLayer = !!args.guideLayer; changedProperties.push("guideLayer"); }

        if (qualityVal !== null) { layer.quality = qualityVal; changedProperties.push("quality"); }

        if (autoOrientVal !== null) { layer.autoOrient = autoOrientVal; changedProperties.push("autoOrient"); }

        if (args.label !== undefined && args.label !== null) { layer.label = args.label; changedProperties.push("label"); }
        if (args.comment !== undefined && args.comment !== null) { layer.comment = args.comment; changedProperties.push("comment"); }

        // --- Transforms (subject to overwriteKeyframes guard) ---
        if (args.position !== undefined && args.position !== null) {
            var posProp = layer.property("Position");
            _guardKeyframeOverwrite(posProp, "position", overwriteKeyframes);
            posProp.setValue(args.position);
            changedProperties.push("position");
        }
        if (args.scale !== undefined && args.scale !== null) {
            var scaleProp = layer.property("Scale");
            _guardKeyframeOverwrite(scaleProp, "scale", overwriteKeyframes);
            scaleProp.setValue(args.scale);
            changedProperties.push("scale");
        }
        if (args.rotation !== undefined && args.rotation !== null) {
            var rotProp = layer.threeDLayer ? layer.property("Z Rotation") : layer.property("Rotation");
            _guardKeyframeOverwrite(rotProp, "rotation", overwriteKeyframes);
            rotProp.setValue(args.rotation);
            changedProperties.push("rotation");
        }
        if (args.opacity !== undefined && args.opacity !== null) {
            var opacityProp = layer.property("Opacity");
            _guardKeyframeOverwrite(opacityProp, "opacity", overwriteKeyframes);
            opacityProp.setValue(args.opacity);
            changedProperties.push("opacity");
        }
        if (args.anchorPoint !== undefined && args.anchorPoint !== null) {
            var anchorProp = layer.property("Anchor Point");
            _guardKeyframeOverwrite(anchorProp, "anchorPoint", overwriteKeyframes);
            anchorProp.setValue(args.anchorPoint);
            changedProperties.push("anchorPoint");
        }

        // --- Time ---
        if (args.startTime !== undefined && args.startTime !== null) { layer.startTime = args.startTime; changedProperties.push("startTime"); }
        if (args.duration !== undefined && args.duration !== null && args.duration > 0) {
            var actualStartTime = (args.startTime !== undefined && args.startTime !== null) ? args.startTime : layer.startTime;
            layer.outPoint = actualStartTime + args.duration;
            changedProperties.push("duration");
        }
        if (args.stretch !== undefined && args.stretch !== null) { layer.stretch = parseFloat(args.stretch); changedProperties.push("stretch"); }

        // --- Camera Options ---
        if (args.cameraOptions !== undefined && args.cameraOptions !== null && layer instanceof CameraLayer) {
            var co = args.cameraOptions;
            if (typeof co === "string") { try { co = eval("(" + co + ")"); } catch(e) {} }
            if (co.zoom         !== undefined) { previousValues.cameraOptions = previousValues.cameraOptions || {}; try { previousValues.cameraOptions.zoom         = layer.property("Camera Options").property("Zoom").value;         } catch(e2) {} }
            if (co.depthOfField !== undefined) { previousValues.cameraOptions = previousValues.cameraOptions || {}; try { previousValues.cameraOptions.depthOfField = layer.property("Camera Options").property("Depth of Field").value; } catch(e2) {} }
            if (co.focusDistance!== undefined) { previousValues.cameraOptions = previousValues.cameraOptions || {}; try { previousValues.cameraOptions.focusDistance= layer.property("Camera Options").property("Focus Distance").value; } catch(e2) {} }
            if (co.aperture     !== undefined) { previousValues.cameraOptions = previousValues.cameraOptions || {}; try { previousValues.cameraOptions.aperture     = layer.property("Camera Options").property("Aperture").value;     } catch(e2) {} }
            if (co.blurLevel    !== undefined) { previousValues.cameraOptions = previousValues.cameraOptions || {}; try { previousValues.cameraOptions.blurLevel    = layer.property("Camera Options").property("Blur Level").value;    } catch(e2) {} }
            var camOO = layer.property("Camera Options");
            if (camOO) {
                if (co.zoom          !== undefined && co.zoom          !== null) { try { var cp = camOO.property("Zoom");          _guardKeyframeOverwrite(cp, "Camera Zoom",          overwriteKeyframes); cp.setValue(parseFloat(co.zoom));          changedProperties.push("cameraOptions.zoom"); }          catch(e2) {} }
                if (co.depthOfField  !== undefined && co.depthOfField  !== null) { try { var cp = camOO.property("Depth of Field"); _guardKeyframeOverwrite(cp, "Camera Depth of Field", overwriteKeyframes); cp.setValue(co.depthOfField ? 1 : 0);    changedProperties.push("cameraOptions.depthOfField"); }  catch(e2) {} }
                if (co.focusDistance !== undefined && co.focusDistance !== null) { try { var cp = camOO.property("Focus Distance"); _guardKeyframeOverwrite(cp, "Camera Focus Distance", overwriteKeyframes); cp.setValue(parseFloat(co.focusDistance)); changedProperties.push("cameraOptions.focusDistance"); } catch(e2) {} }
                if (co.aperture      !== undefined && co.aperture      !== null) { try { var cp = camOO.property("Aperture");       _guardKeyframeOverwrite(cp, "Camera Aperture",       overwriteKeyframes); cp.setValue(parseFloat(co.aperture));       changedProperties.push("cameraOptions.aperture"); }       catch(e2) {} }
                if (co.blurLevel     !== undefined && co.blurLevel     !== null) { try { var cp = camOO.property("Blur Level");     _guardKeyframeOverwrite(cp, "Camera Blur Level",     overwriteKeyframes); cp.setValue(parseFloat(co.blurLevel));      changedProperties.push("cameraOptions.blurLevel"); }      catch(e2) {} }
            }
        }

        // --- Light Options ---
        if (args.lightOptions !== undefined && args.lightOptions !== null && layer instanceof LightLayer) {
            var lo = args.lightOptions;
            if (typeof lo === "string") { try { lo = eval("(" + lo + ")"); } catch(e) {} }
            var lightOO = layer.property("Light Options");
            if (lightOO) {
                var LOfields = ["Intensity", "Color", "Cone Angle", "Cone Feather", "Falloff", "Radius", "Falloff Distance", "Casts Shadows", "Shadow Darkness", "Shadow Diffusion"];
                var LOkeys   = ["intensity", "color", "coneAngle", "coneFeather", "falloff", "radius", "falloffDistance", "castsShadows", "shadowDarkness", "shadowDiffusion"];
                for (var loi = 0; loi < LOkeys.length; loi++) {
                    var loKey = LOkeys[loi];
                    var loField = LOfields[loi];
                    if (lo[loKey] !== undefined && lo[loKey] !== null) {
                        previousValues.lightOptions = previousValues.lightOptions || {};
                        try { previousValues.lightOptions[loKey] = lightOO.property(loField).value; } catch(e2) {}
                        try {
                            var lp = lightOO.property(loField);
                            _guardKeyframeOverwrite(lp, "Light " + loField, overwriteKeyframes);
                            var loVal = lo[loKey];
                            if (loKey === "castsShadows") { loVal = loVal ? 1 : 0; }
                            else if (loKey === "falloff") {
                                var LFMAP = { "none": 0, "smooth": 1, "inverseSquare": 2 };
                                loVal = (LFMAP[loVal] !== undefined) ? LFMAP[loVal] : parseInt(loVal);
                            } else if (loKey !== "color") { loVal = parseFloat(loVal); }
                            lp.setValue(loVal);
                            changedProperties.push("lightOptions." + loKey);
                        } catch(e2) {}
                    }
                }
            }
        }

        var returnLayerInfo = {
            name: layer.name,
            index: layer.index,
            threeDLayer: layer.threeDLayer,
            position: layer.property("Position").value,
            scale: layer.property("Scale").value,
            rotation: layer.threeDLayer ? layer.property("Z Rotation").value : layer.property("Rotation").value,
            opacity: layer.property("Opacity").value,
            anchorPoint: layer.property("Anchor Point").value,
            inPoint: layer.inPoint,
            outPoint: layer.outPoint,
            stretch: layer.stretch,
            changedProperties: changedProperties
        };
        if (layer instanceof TextLayer && textDocument) {
            returnLayerInfo.text = textDocument.text;
            returnLayerInfo.fontFamily = textDocument.font;
            returnLayerInfo.fontSize = textDocument.fontSize;
            returnLayerInfo.fillColor = textDocument.fillColor;
        }

        return JSON.stringify({
            status: "success", message: "Layer properties updated successfully",
            layer: returnLayerInfo,
            previousValues: previousValues
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: batchSetLayerProperties — apply per-layer setLayerProperties-style updates in a single call
function batchSetLayerProperties(args) {
    try {
        var comp = _resolveComp(args);
        var operations = args.operations;
        // Outer-level overwriteKeyframes acts as default for every op; per-op flag can override.
        var defaultOverwrite = args.overwriteKeyframes === true;

        if (!operations || !operations.length) {
            throw _err(ERROR_CODES.INVALID_ARGS, "No operations provided. Pass an array of {layerIndex, ...properties}");
        }

        var results = [];
        for (var o = 0; o < operations.length; o++) {
            var op = operations[o];
            var overwriteKeyframes = (op.overwriteKeyframes !== undefined) ? (op.overwriteKeyframes === true) : defaultOverwrite;
            var layer = null;
            if (op.layerIndex !== undefined && op.layerIndex !== null) {
                if (op.layerIndex > 0 && op.layerIndex <= comp.numLayers) { layer = comp.layer(op.layerIndex); }
                else { results.push({ layerIndex: op.layerIndex, status: "error", errorCode: ERROR_CODES.LAYER_INDEX_OOB, message: "Layer index out of bounds" }); continue; }
            } else if (op.layerName) {
                for (var j = 1; j <= comp.numLayers; j++) {
                    if (comp.layer(j).name === op.layerName) { layer = comp.layer(j); break; }
                }
            }
            if (!layer) { results.push({ layerIndex: op.layerIndex, layerName: op.layerName, status: "error", errorCode: ERROR_CODES.LAYER_NOT_FOUND, message: "Layer not found" }); continue; }

            try {
                // Validate-first (per op): reject invalid enums / unresolvable font before any
                // mutation so one bad op fails cleanly (recorded as an error result) without a
                // partial update. Reuse the resolved values in the mutation code below.
                var opBlendModeVal = null, opQualityVal = null, opAutoOrientVal = null, opResolvedFont = null;
                if (op.blendMode !== undefined && op.blendMode !== null) { opBlendModeVal = _requireEnum(op.blendMode, BLEND_MODES, "blendMode"); }
                if (op.quality !== undefined && op.quality !== null) { opQualityVal = _requireEnum(op.quality, QUALITY_MAP, "quality"); }
                if (op.autoOrient !== undefined && op.autoOrient !== null) { opAutoOrientVal = _requireEnum(op.autoOrient, AUTO_ORIENT_MAP, "autoOrient"); }
                if (layer instanceof TextLayer && op.fontFamily !== undefined && op.fontFamily !== null) { opResolvedFont = _resolveFont(op.fontFamily); }

                // Capture prior state for revert (only for fields this op touches)
                var prevVals = {};
                if (layer instanceof TextLayer) {
                    var bSrcSnap = layer.property("Source Text");
                    if (bSrcSnap && bSrcSnap.value) {
                        var bTdSnap = bSrcSnap.value;
                        if (op.text !== undefined && op.text !== null) { prevVals.text = bTdSnap.text; }
                        if (op.fontFamily !== undefined && op.fontFamily !== null) { prevVals.fontFamily = bTdSnap.font; }
                        if (op.fontSize !== undefined && op.fontSize !== null) { prevVals.fontSize = bTdSnap.fontSize; }
                        if (op.fillColor !== undefined && op.fillColor !== null) { prevVals.fillColor = bTdSnap.fillColor; }
                    }
                }
                if (op.threeDLayer !== undefined && op.threeDLayer !== null) { prevVals.threeDLayer = layer.threeDLayer; }
                if (op.position !== undefined && op.position !== null) { prevVals.position = layer.property("Position").value; }
                if (op.scale !== undefined && op.scale !== null) { prevVals.scale = layer.property("Scale").value; }
                if (op.rotation !== undefined && op.rotation !== null) { prevVals.rotation = layer.threeDLayer ? layer.property("Z Rotation").value : layer.property("Rotation").value; }
                if (op.opacity !== undefined && op.opacity !== null) { prevVals.opacity = layer.property("Opacity").value; }
                if (op.anchorPoint !== undefined && op.anchorPoint !== null) { prevVals.anchorPoint = layer.property("Anchor Point").value; }
                if (op.blendMode !== undefined && op.blendMode !== null) {
                    var bPrevBM = "unknown";
                    for (var bkk in BLEND_MODES) { if (BLEND_MODES.hasOwnProperty(bkk) && BLEND_MODES[bkk] === layer.blendingMode) { bPrevBM = bkk; break; } }
                    prevVals.blendMode = bPrevBM;
                }
                if (op.startTime !== undefined && op.startTime !== null) { prevVals.startTime = layer.startTime; }
                if (op.motionBlur !== undefined && op.motionBlur !== null) { prevVals.motionBlur = layer.motionBlur; }
                if (op.stretch !== undefined && op.stretch !== null) { prevVals.stretch = layer.stretch; }

                var changed = [];

                if (layer instanceof TextLayer && (op.text !== undefined || op.fontFamily !== undefined || op.fontSize !== undefined || op.fillColor !== undefined)) {
                    var sourceTextProp = layer.property("Source Text");
                    if (sourceTextProp && sourceTextProp.value) {
                        var td = sourceTextProp.value;
                        var tdUpdated = false;
                        if (op.text !== undefined && op.text !== null) { td.text = op.text; changed.push("text"); tdUpdated = true; }
                        if (opResolvedFont !== null) { td.font = opResolvedFont; changed.push("fontFamily"); tdUpdated = true; }
                        if (op.fontSize !== undefined && op.fontSize !== null) { td.fontSize = op.fontSize; changed.push("fontSize"); tdUpdated = true; }
                        if (op.fillColor !== undefined && op.fillColor !== null) { td.fillColor = op.fillColor; changed.push("fillColor"); tdUpdated = true; }
                        if (tdUpdated) { sourceTextProp.setValue(td); }
                    }
                }

                if (op.threeDLayer !== undefined && op.threeDLayer !== null) { layer.threeDLayer = !!op.threeDLayer; changed.push("threeDLayer"); }

                if (op.position !== undefined && op.position !== null) {
                    var posProp = layer.property("Position");
                    _guardKeyframeOverwrite(posProp, "position", overwriteKeyframes);
                    posProp.setValue(op.position);
                    changed.push("position");
                }
                if (op.scale !== undefined && op.scale !== null) {
                    var scaleProp = layer.property("Scale");
                    _guardKeyframeOverwrite(scaleProp, "scale", overwriteKeyframes);
                    scaleProp.setValue(op.scale);
                    changed.push("scale");
                }
                if (op.rotation !== undefined && op.rotation !== null) {
                    var rotProp = layer.threeDLayer ? layer.property("Z Rotation") : layer.property("Rotation");
                    _guardKeyframeOverwrite(rotProp, "rotation", overwriteKeyframes);
                    rotProp.setValue(op.rotation);
                    changed.push("rotation");
                }
                if (op.opacity !== undefined && op.opacity !== null) {
                    var opacityProp = layer.property("Opacity");
                    _guardKeyframeOverwrite(opacityProp, "opacity", overwriteKeyframes);
                    opacityProp.setValue(op.opacity);
                    changed.push("opacity");
                }
                if (op.anchorPoint !== undefined && op.anchorPoint !== null) {
                    var anchorProp = layer.property("Anchor Point");
                    _guardKeyframeOverwrite(anchorProp, "anchorPoint", overwriteKeyframes);
                    anchorProp.setValue(op.anchorPoint);
                    changed.push("anchorPoint");
                }

                if (opBlendModeVal !== null) { layer.blendingMode = opBlendModeVal; changed.push("blendMode"); }
                if (op.startTime !== undefined && op.startTime !== null) { layer.startTime = op.startTime; changed.push("startTime"); }
                if (op.duration !== undefined && op.duration !== null && op.duration > 0) {
                    var opStartTime = (op.startTime !== undefined && op.startTime !== null) ? op.startTime : layer.startTime;
                    layer.outPoint = opStartTime + op.duration;
                    changed.push("duration");
                }
                if (op.outPoint !== undefined && op.outPoint !== null) { layer.outPoint = op.outPoint; changed.push("outPoint"); }
                if (op.stretch !== undefined && op.stretch !== null) { layer.stretch = parseFloat(op.stretch); changed.push("stretch"); }
                if (op.motionBlur !== undefined && op.motionBlur !== null) { layer.motionBlur = !!op.motionBlur; changed.push("motionBlur"); }
                if (op.collapseTransformation !== undefined && op.collapseTransformation !== null) { layer.collapseTransformation = !!op.collapseTransformation; changed.push("collapseTransformation"); }
                if (op.shy !== undefined && op.shy !== null) { layer.shy = !!op.shy; changed.push("shy"); }
                if (op.solo !== undefined && op.solo !== null) { layer.solo = !!op.solo; changed.push("solo"); }
                if (op.guideLayer !== undefined && op.guideLayer !== null) { layer.guideLayer = !!op.guideLayer; changed.push("guideLayer"); }
                if (opQualityVal !== null) { layer.quality = opQualityVal; changed.push("quality"); }
                if (opAutoOrientVal !== null) { layer.autoOrient = opAutoOrientVal; changed.push("autoOrient"); }
                if (op.label !== undefined && op.label !== null) { layer.label = op.label; changed.push("label"); }
                if (op.comment !== undefined && op.comment !== null) { layer.comment = op.comment; changed.push("comment"); }

                results.push({
                    layerIndex: layer.index,
                    name: layer.name,
                    status: "success",
                    threeDLayer: layer.threeDLayer,
                    position: layer.property("Position").value,
                    scale: layer.property("Scale").value,
                    rotation: layer.threeDLayer ? layer.property("Z Rotation").value : layer.property("Rotation").value,
                    opacity: layer.property("Opacity").value,
                    anchorPoint: layer.property("Anchor Point").value,
                    changedProperties: changed,
                    previousValues: prevVals
                });
            } catch (opErr) {
                results.push({
                    layerIndex: layer.index,
                    name: layer.name,
                    status: "error",
                    errorCode: opErr.code || ERROR_CODES.INTERNAL_ERROR,
                    message: opErr.toString()
                });
            }
        }

        return JSON.stringify({ status: "success", results: results }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: moveLayer
function moveLayer(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp = resolved.comp;
        var layer = resolved.layer;

        var target = null;
        if (args.targetIndex !== undefined && args.targetIndex !== null) {
            if (args.targetIndex > 0 && args.targetIndex <= comp.numLayers) { target = comp.layer(args.targetIndex); }
            else { throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Target layer index out of bounds: " + args.targetIndex); }
        } else if (args.targetName) {
            for (var k = 1; k <= comp.numLayers; k++) {
                if (comp.layer(k).name === args.targetName) { target = comp.layer(k); break; }
            }
        }
        if (!target) { throw _err(ERROR_CODES.LAYER_NOT_FOUND, "Target layer not found: " + (args.targetName || "index " + args.targetIndex)); }

        var previousIndex = layer.index;

        if (args.position === "before") {
            layer.moveBefore(target);
        } else {
            layer.moveAfter(target);
        }
        // Reordering to the slot it already occupies leaves the index unchanged — nothing moved.
        if (layer.index === previousIndex) {
            return JSON.stringify({ status: "noop", message: "Layer is already in that position." }, null, 2);
        }
        return JSON.stringify({ status: "success", message: "Layer moved successfully.", layer: { name: layer.name, index: layer.index }, previousIndex: previousIndex }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: e.toString(), line: e.line }, null, 2);
    }
}

// U: setLayerParent
function setLayerParent(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp = resolved.comp;
        var layer = resolved.layer;
        var parentIndex = args.parentIndex;
        var parentName = args.parentName || "";

        var previousParent = layer.parent ? { name: layer.parent.name, index: layer.parent.index } : null;

        if ((parentIndex === undefined || parentIndex === null) && !parentName) {
            if (previousParent === null) {
                return JSON.stringify({ status: "noop", message: "Layer already has no parent." }, null, 2);
            }
            layer.parent = null;
            return JSON.stringify({ status: "success", message: "Parent cleared", layer: { name: layer.name, index: layer.index, parent: null }, previousParent: previousParent }, null, 2);
        }
        var parentLayer = null;
        if (parentIndex !== undefined && parentIndex !== null) {
            if (parentIndex > 0 && parentIndex <= comp.numLayers) { parentLayer = comp.layer(parentIndex); }
            else { throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Parent layer index out of bounds: " + parentIndex); }
        } else if (parentName) {
            for (var k = 1; k <= comp.numLayers; k++) {
                if (comp.layer(k).name === parentName) { parentLayer = comp.layer(k); break; }
            }
        }
        if (!parentLayer) { throw _err(ERROR_CODES.LAYER_NOT_FOUND, "Parent layer not found: " + (parentName || "index " + parentIndex)); }
        if (parentLayer.index === layer.index) { throw _err(ERROR_CODES.INVALID_ARGS, "A layer cannot be its own parent"); }
        if (layer.parent && layer.parent.index === parentLayer.index) {
            return JSON.stringify({ status: "noop", message: "Layer already has that parent." }, null, 2);
        }
        layer.parent = parentLayer;
        return JSON.stringify({
            status: "success", message: "Layer parent set successfully",
            layer: { name: layer.name, index: layer.index, parent: { name: parentLayer.name, index: parentLayer.index } },
            previousParent: previousParent
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// R: getSelectedLayers — returns layers the user has highlighted in the AE timeline
function getSelectedLayers(args) {
    try {
        var activeItem = null;
        if (args && args.compName) {
            activeItem = _resolveComp(args);
        } else {
            activeItem = app.project.activeItem;
        }
        if (!(activeItem instanceof CompItem)) {
            return JSON.stringify({
                status: "success",
                activeComp: null,
                selectedLayers: [],
                count: 0,
                message: "No active composition"
            }, null, 2);
        }

        var selected = activeItem.selectedLayers;
        var layers = [];
        for (var i = 0; i < selected.length; i++) {
            var layer = selected[i];
            var layerType = "unknown";
            if (layer instanceof TextLayer)        { layerType = "text"; }
            else if (layer instanceof ShapeLayer)  { layerType = "shape"; }
            else if (layer instanceof CameraLayer) { layerType = "camera"; }
            else if (layer instanceof LightLayer)  { layerType = "light"; }
            else if (layer instanceof AVLayer) {
                layerType = layer.nullLayer ? "null" : (layer.adjustmentLayer ? "adjustment" : "solid");
            }
            layers.push({
                index: layer.index,
                name: layer.name,
                type: layerType,
                enabled: layer.enabled,
                threeDLayer: layer.threeDLayer,
                inPoint: layer.inPoint,
                outPoint: layer.outPoint,
                parent: layer.parent ? { name: layer.parent.name, index: layer.parent.index } : null
            });
        }

        return JSON.stringify({
            status: "success",
            activeComp: { name: activeItem.name, id: activeItem.id, numLayers: activeItem.numLayers },
            selectedLayers: layers,
            count: layers.length
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// R: getSelectionDetails — returns selected properties, values, expressions, and selected
// keyframes for every highlighted property across all selected layers in the active comp.
//
// Uses comp.selectedLayers + downward tree walk (prop.selected) rather than
// comp.selectedProperties + walk-up, because Layer.parent means the parenting relationship
// (Parent & Link), not the property-hierarchy parent, making walk-up unreliable.
function getSelectionDetails(args) {
    var foundProps = []; // reused per layer; captured by collectSelected closure

    function collectSelected(group, path) {
        for (var i = 1; i <= group.numProperties; i++) {
            var prop = group.property(i);
            var propPath = path.concat([prop.name]);
            if (prop.selected) {
                foundProps.push({ prop: prop, path: propPath });
            }
            if (typeof prop.numProperties === "number" && prop.numProperties > 0) {
                collectSelected(prop, propPath);
            }
        }
    }

    try {
        var activeItem = (args && args.compName) ? _resolveComp(args) : app.project.activeItem;
        if (!(activeItem instanceof CompItem)) {
            return JSON.stringify({
                status: "success",
                activeComp: null,
                layers: [],
                count: 0,
                message: "No active composition"
            }, null, 2);
        }

        var MAX_PROPS_PER_LAYER = 10;
        var MAX_EXPRESSION_CHARS = 2000;
        var MAX_SELECTED_KEYS = 20;

        var selectedLayersList = activeItem.selectedLayers;
        if (!selectedLayersList || selectedLayersList.length === 0) {
            return JSON.stringify({
                status: "success",
                activeComp: { name: activeItem.name, id: activeItem.id },
                layers: [],
                count: 0
            }, null, 2);
        }

        var resultLayers = [];

        for (var li = 0; li < selectedLayersList.length; li++) {
            var layer = selectedLayersList[li];

            foundProps = [];
            collectSelected(layer, []);

            if (foundProps.length === 0) continue;

            var truncProps = 0, truncExprChars = 0, truncKeys = 0;
            var propLimit = Math.min(foundProps.length, MAX_PROPS_PER_LAYER);
            if (foundProps.length > MAX_PROPS_PER_LAYER) {
                truncProps = foundProps.length - MAX_PROPS_PER_LAYER;
            }

            var propsOut = [];
            for (var pi = 0; pi < propLimit; pi++) {
                var pObj = foundProps[pi];
                var p = pObj.prop;
                var isGroup = (typeof p.numProperties === "number" && p.numProperties > 0);

                var entry = { propertyPath: pObj.path };

                if (!isGroup) {
                    try { entry.value = p.value; } catch (e) {}

                    if (p.canSetExpression && p.expressionEnabled && p.expression !== "") {
                        var expr = p.expression;
                        if (expr.length > MAX_EXPRESSION_CHARS) {
                            var over = expr.length - MAX_EXPRESSION_CHARS;
                            truncExprChars += over;
                            entry.expression = expr.substring(0, MAX_EXPRESSION_CHARS) +
                                "…[truncated, " + over + " more chars]";
                        } else {
                            entry.expression = expr;
                        }
                    }

                    try {
                        if (p.numKeys > 0) {
                            var selKeys = p.selectedKeys;
                            if (selKeys && selKeys.length > 0) {
                                var keyLimit = Math.min(selKeys.length, MAX_SELECTED_KEYS);
                                if (selKeys.length > MAX_SELECTED_KEYS) {
                                    truncKeys += selKeys.length - MAX_SELECTED_KEYS;
                                }
                                var keysOut = [];
                                for (var ki = 0; ki < keyLimit; ki++) {
                                    var kIdx = selKeys[ki];
                                    try {
                                        keysOut.push({
                                            keyIndex: kIdx,
                                            time: p.keyTime(kIdx),
                                            value: p.keyValue(kIdx)
                                        });
                                    } catch (ke) {}
                                }
                                entry.selectedKeys = keysOut;
                            }
                        }
                    } catch (ke) {}
                } else {
                    entry.isGroup = true;
                }

                propsOut.push(entry);
            }

            if (propsOut.length === 0) continue;

            var layerOut = { layerIndex: layer.index, selectedProperties: propsOut };
            if (truncProps > 0 || truncExprChars > 0 || truncKeys > 0) {
                var trunc = {};
                if (truncProps > 0)     trunc.properties = truncProps;
                if (truncExprChars > 0) trunc.expressionChars = truncExprChars;
                if (truncKeys > 0)      trunc.keyframes = truncKeys;
                layerOut._truncated = trunc;
            }
            resultLayers.push(layerOut);
        }

        return JSON.stringify({
            status: "success",
            activeComp: { name: activeItem.name, id: activeItem.id },
            layers: resultLayers,
            count: resultLayers.length
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: setSelectedLayers — select layers by index or name; deselects all others by default
function setSelectedLayers(args) {
    try {
        var comp = (args && args.compName) ? _resolveComp(args) : app.project.activeItem;
        if (!(comp instanceof CompItem)) { throw _err(ERROR_CODES.COMP_NOT_FOUND, "No active composition. Pass compName or open a comp."); }

        var clearOthers = (args.clearOthers !== false); // default true

        // Capture prior selection before modifying
        var previousSelection = [];
        for (var ps = 1; ps <= comp.numLayers; ps++) {
            if (comp.layer(ps).selected) { previousSelection.push({ index: comp.layer(ps).index, name: comp.layer(ps).name }); }
        }

        if (clearOthers) {
            for (var ci2 = 1; ci2 <= comp.numLayers; ci2++) { comp.layer(ci2).selected = false; }
        }

        var layerIndices = args.layerIndices;
        if (typeof layerIndices === "string") { try { layerIndices = eval("(" + layerIndices + ")"); } catch(e) { layerIndices = null; } }
        var layerNames = args.layerNames;
        if (typeof layerNames === "string") { try { layerNames = eval("(" + layerNames + ")"); } catch(e) { layerNames = null; } }

        if (layerIndices && layerIndices.length > 0) {
            for (var ii = 0; ii < layerIndices.length; ii++) {
                var idx = layerIndices[ii];
                if (idx < 1 || idx > comp.numLayers) { throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Layer index out of bounds: " + idx); }
                comp.layer(idx).selected = true;
            }
        } else if (layerNames && layerNames.length > 0) {
            for (var ni = 0; ni < layerNames.length; ni++) {
                var nm = layerNames[ni];
                var found = false;
                for (var li = 1; li <= comp.numLayers; li++) {
                    if (comp.layer(li).name === nm) { comp.layer(li).selected = true; found = true; break; }
                }
                if (!found) { throw _err(ERROR_CODES.LAYER_NOT_FOUND, "Layer not found: '" + nm + "'"); }
            }
        }

        var selectedLayers = [];
        for (var sl = 1; sl <= comp.numLayers; sl++) {
            if (comp.layer(sl).selected) {
                selectedLayers.push({ index: comp.layer(sl).index, name: comp.layer(sl).name });
            }
        }

        // Same set of layers selected as before (re-selecting + clearing is idempotent) — no change.
        var prevIdx = [], curIdx = [];
        for (var pi = 0; pi < previousSelection.length; pi++) { prevIdx.push(previousSelection[pi].index); }
        for (var cii = 0; cii < selectedLayers.length; cii++) { curIdx.push(selectedLayers[cii].index); }
        prevIdx.sort(function (a, b) { return a - b; });
        curIdx.sort(function (a, b) { return a - b; });
        if (_valuesEqual(prevIdx, curIdx)) {
            return JSON.stringify({ status: "noop", message: "Those layers are already selected." }, null, 2);
        }

        return JSON.stringify({
            status: "success",
            activeComp: { name: comp.name, id: comp.id, numLayers: comp.numLayers },
            selectedLayers: selectedLayers,
            count: selectedLayers.length,
            previousSelection: previousSelection
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: precompose — group layers into a nested sub-comp
function precompose(args) {
    try {
        var comp = _resolveComp(args);
        var layerIndices = args.layerIndices;
        var newCompName = args.newCompName || "Precomp";
        var moveAttributes = (args.moveAttributes !== false);
        var openNewComp = args.openNewComp === true;

        if (!layerIndices || typeof layerIndices.length === "undefined" || layerIndices.length === 0) {
            throw _err(ERROR_CODES.INVALID_ARGS, "layerIndices must be a non-empty array.");
        }

        for (var k = 0; k < layerIndices.length; k++) {
            if (layerIndices[k] < 1 || layerIndices[k] > comp.numLayers) {
                throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Layer index out of bounds: " + layerIndices[k]);
            }
        }

        var newComp = comp.layers.precompose(layerIndices, newCompName, moveAttributes);

        if (openNewComp) { newComp.openInViewer(); }

        var placeholderLayer = null;
        for (var p = 1; p <= comp.numLayers; p++) {
            var lyr = comp.layer(p);
            if (lyr.source && lyr.source === newComp) { placeholderLayer = lyr; break; }
        }

        return JSON.stringify({
            status: "success",
            message: "Precomposed " + layerIndices.length + " layer(s) into '" + newCompName + "'.",
            newComp: { name: newComp.name, id: newComp.id, width: newComp.width, height: newComp.height, duration: newComp.duration, numLayers: newComp.numLayers },
            replacingLayer: placeholderLayer ? { index: placeholderLayer.index, name: placeholderLayer.name } : null
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: setTrackMatte — set track matte type + optional explicit matte layer pointer (AE 22+)
function setTrackMatte(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp = resolved.comp;
        var layer = resolved.layer;

        var matteType = args.matteType;
        var matteTypes = {
            "none": TrackMatteType.NO_TRACK_MATTE,
            "alpha": TrackMatteType.ALPHA,
            "alphaInverted": TrackMatteType.ALPHA_INVERTED,
            "luma": TrackMatteType.LUMA,
            "lumaInverted": TrackMatteType.LUMA_INVERTED
        };
        if (matteTypes[matteType] === undefined) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Invalid matteType '" + matteType + "'. Use: none, alpha, alphaInverted, luma, lumaInverted.");
        }

        // Capture prior state before mutation
        var prevTypeLabels = {};
        for (var pk in matteTypes) { if (matteTypes.hasOwnProperty(pk)) { prevTypeLabels[matteTypes[pk]] = pk; } }
        var previousMatteType = prevTypeLabels[layer.trackMatteType] || "unknown";
        var previousMatteLayer = null;
        try {
            if (typeof layer.trackMatteLayer !== "undefined" && layer.trackMatteLayer) {
                previousMatteLayer = { index: layer.trackMatteLayer.index, name: layer.trackMatteLayer.name };
            }
        } catch (e) {}

        var matteLayerIndex = args.matteLayerIndex;
        var matteLayerName = args.matteLayerName;
        var mattingLayer = null;

        if (matteLayerIndex !== undefined && matteLayerIndex !== null) {
            if (matteLayerIndex < 1 || matteLayerIndex > comp.numLayers) {
                throw _err(ERROR_CODES.LAYER_INDEX_OOB, "matteLayerIndex out of bounds: " + matteLayerIndex);
            }
            mattingLayer = comp.layer(matteLayerIndex);
        } else if (matteLayerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === matteLayerName) { mattingLayer = comp.layer(j); break; }
            }
            if (!mattingLayer) { throw _err(ERROR_CODES.LAYER_NOT_FOUND, "Matte layer not found: " + matteLayerName); }
        }

        // Already the requested matte (same type, and same matte layer if one was given) — no change.
        if (previousMatteType === matteType &&
            (!mattingLayer || (previousMatteLayer && previousMatteLayer.index === mattingLayer.index))) {
            return JSON.stringify({ status: "noop", message: "Track matte is already set that way." }, null, 2);
        }

        if (mattingLayer && matteTypes[matteType] !== TrackMatteType.NO_TRACK_MATTE) {
            try {
                layer.setTrackMatte(mattingLayer, matteTypes[matteType]);
            } catch (apiErr) {
                layer.trackMatteType = matteTypes[matteType];
            }
        } else {
            layer.trackMatteType = matteTypes[matteType];
        }

        return JSON.stringify({
            status: "success",
            message: "Track matte set to '" + matteType + "' on layer '" + layer.name + "'.",
            layer: { index: layer.index, name: layer.name, trackMatteType: matteType, matteLayerIndex: mattingLayer ? mattingLayer.index : null },
            previousValues: { matteType: previousMatteType, matteLayer: previousMatteLayer }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: splitLayer — split a layer at a given time by duplicating and trimming both halves
function splitLayer(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp = resolved.comp;
        var layer = resolved.layer;

        var time = (args.time !== undefined && args.time !== null) ? parseFloat(args.time) : comp.time;

        if (time <= layer.inPoint || time >= layer.outPoint) {
            throw _err(ERROR_CODES.TIME_OUT_OF_RANGE, "Split time " + time + "s is outside the layer's active range [" + layer.inPoint + ", " + layer.outPoint + "]");
        }

        var originalOutPoint = layer.outPoint;
        var dup = layer.duplicate();
        // duplicate() places dup above original; move original back above dup so left half renders on top
        layer.moveBefore(dup);

        layer.outPoint = time;
        dup.inPoint = time;
        dup.outPoint = originalOutPoint;

        return JSON.stringify({
            status: "success",
            message: "Layer split at " + time + "s.",
            original: { index: layer.index, name: layer.name, inPoint: layer.inPoint, outPoint: layer.outPoint },
            newLayer: { index: dup.index, name: dup.name, inPoint: dup.inPoint, outPoint: dup.outPoint }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: trimLayer — set the layer's in/out window and/or start time
function trimLayer(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp = resolved.comp;
        var layer = resolved.layer;

        var mode = args.mode || "";
        var inPoint = args.inPoint;
        var outPoint = args.outPoint;

        if (mode === "currentTimeIn") {
            inPoint = comp.time;
        } else if (mode === "currentTimeOut") {
            outPoint = comp.time;
        }

        // Pre-validate before mutating
        var newIn  = (inPoint  !== undefined && inPoint  !== null) ? parseFloat(inPoint)  : layer.inPoint;
        var newOut = (outPoint !== undefined && outPoint !== null) ? parseFloat(outPoint) : layer.outPoint;
        if (newIn >= newOut) {
            throw _err(ERROR_CODES.INVALID_ARGS, "inPoint (" + newIn + ") must be less than outPoint (" + newOut + ")");
        }

        var previousValues = { startTime: layer.startTime, inPoint: layer.inPoint, outPoint: layer.outPoint };

        // Already at the requested in/out (and start time, if given) — nothing to trim.
        var startUnchanged = (args.startTime === undefined || args.startTime === null) || _valuesEqual(parseFloat(args.startTime), layer.startTime);
        if (startUnchanged && _valuesEqual(newIn, layer.inPoint) && _valuesEqual(newOut, layer.outPoint)) {
            return JSON.stringify({ status: "noop", message: "Layer is already trimmed to that range." }, null, 2);
        }

        if (args.startTime !== undefined && args.startTime !== null) { layer.startTime = parseFloat(args.startTime); }
        if (inPoint  !== undefined && inPoint  !== null) { layer.inPoint  = parseFloat(inPoint);  }
        if (outPoint !== undefined && outPoint !== null) { layer.outPoint = parseFloat(outPoint); }

        return JSON.stringify({
            status: "success",
            message: "Layer trimmed.",
            layer: { index: layer.index, name: layer.name, startTime: layer.startTime, inPoint: layer.inPoint, outPoint: layer.outPoint },
            previousValues: previousValues
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: retimeClip — change a clip's playback timing without hand-rolling time-remap keyframes.
// mode: speed (uniform rate via time-stretch; speed=2 → 2x faster, 0.5 → slow-mo) |
//       freeze (hold one frame for the whole layer, via a single held Time Remap key) |
//       reverse (play backwards via negative time-stretch).
// On slow-mo (speed < 1) frame blending is auto-enabled so the in-between frames stay smooth.
function retimeClip(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp = resolved.comp;
        var layer = resolved.layer;
        var mode = (args.mode || "").toLowerCase();

        if (mode !== "speed" && mode !== "freeze" && mode !== "reverse") {
            throw _err(ERROR_CODES.INVALID_ARGS, "mode must be speed, freeze, or reverse.");
        }
        if (!(layer instanceof AVLayer)) {
            throw _err(ERROR_CODES.INVALID_ARGS, "retimeClip only works on footage/precomp (AV) layers — not cameras, lights, or nulls.");
        }

        var previousValues = { stretch: layer.stretch, timeRemapEnabled: layer.timeRemapEnabled, inPoint: layer.inPoint, outPoint: layer.outPoint };

        if (mode === "speed") {
            var speed = (args.speed !== undefined && args.speed !== null) ? parseFloat(args.speed) : null;
            if (speed === null || isNaN(speed) || speed <= 0) {
                throw _err(ERROR_CODES.INVALID_ARGS, "speed must be a positive number (e.g. 2 for 2x, 0.5 for half-speed).");
            }
            // Time-stretch is the inverse of speed: 50% stretch = 2x faster, 200% = half-speed.
            // Preserve any existing reverse (negative stretch) direction.
            var sign = (layer.stretch < 0) ? -1 : 1;
            var newStretch = sign * (100 / speed);
            if (_valuesEqual(newStretch, layer.stretch)) {
                return JSON.stringify({ status: "noop", message: "Layer is already at that speed." }, null, 2);
            }
            layer.stretch = newStretch;

            // Smooth slow-mo: auto-enable frame blending when playing slower than real time.
            var frameBlended = false;
            if (speed < 1) {
                try { layer.frameBlendingType = FrameBlendingType.PIXEL_MOTION; frameBlended = true; }
                catch (eFB) { try { layer.frameBlendingType = FrameBlendingType.FRAME_MIX; frameBlended = true; } catch (eFB2) {} }
                try { comp.frameBlending = true; } catch (eCFB) {}
            }
            return JSON.stringify({
                status: "success",
                message: "Set speed to " + speed + "x" + (frameBlended ? " (frame blending on for smooth slow-mo)" : "") + ".",
                layer: { index: layer.index, name: layer.name, stretch: layer.stretch, outPoint: layer.outPoint },
                frameBlended: frameBlended,
                previousValues: previousValues
            }, null, 2);
        }

        if (mode === "reverse") {
            // Negative time-stretch reverses playback while preserving the current speed magnitude.
            if (layer.stretch < 0) {
                return JSON.stringify({ status: "noop", message: "Layer is already playing in reverse." }, null, 2);
            }
            layer.stretch = -Math.abs(layer.stretch);
            return JSON.stringify({
                status: "success",
                message: "Reversed playback.",
                layer: { index: layer.index, name: layer.name, stretch: layer.stretch, inPoint: layer.inPoint, outPoint: layer.outPoint },
                previousValues: previousValues
            }, null, 2);
        }

        // mode === "freeze": hold a single source frame for the whole layer via Time Remap.
        if (!layer.canSetTimeRemapEnabled) {
            throw _err(ERROR_CODES.INVALID_ARGS, "This layer can't be frozen (time remapping unsupported — use a footage or precomp layer, not a solid or still).");
        }
        var freezeAt = (args.atTime !== undefined && args.atTime !== null) ? parseFloat(args.atTime) : comp.time;
        // Clamp the freeze point into the layer's visible range.
        if (freezeAt < layer.inPoint) freezeAt = layer.inPoint;
        if (freezeAt > layer.outPoint) freezeAt = layer.outPoint;

        if (!layer.timeRemapEnabled) { layer.timeRemapEnabled = true; }  // AE auto-adds keys here
        var trp = layer.property("Time Remap");
        // Source time currently shown at the freeze point — the frame we hold.
        var srcTime = trp.valueAtTime(freezeAt, false);
        // Collapse to a SINGLE held key. Never empty the property: with 0 keys AE hides Time Remap and
        // the next setValue throws "property or a parent property is hidden" — so we leave one key, then
        // overwrite its value, rather than removing all and re-adding.
        while (trp.numKeys > 1) { trp.removeKey(trp.numKeys); }
        if (trp.numKeys === 1) { trp.setValueAtKey(1, srcTime); }
        else { trp.setValueAtTime(layer.inPoint, srcTime); }
        try { trp.setInterpolationTypeAtKey(1, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD); } catch (eHold) {}

        return JSON.stringify({
            status: "success",
            message: "Froze the frame at " + freezeAt.toFixed(3) + "s.",
            layer: { index: layer.index, name: layer.name, freezeTime: freezeAt, sourceTime: srcTime },
            configurableProperties: _configurableLeaf(trp, ["Time Remap"]),
            previousValues: previousValues
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: setTimeRemapEnabled — enable/disable time remapping on a layer (AVLayer only)
function setTimeRemapEnabled(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        if (args.enabled === undefined || args.enabled === null) {
            throw _err(ERROR_CODES.INVALID_ARGS, "enabled (boolean) is required");
        }
        if (!(layer instanceof AVLayer)) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Time remapping is only supported on AV layers (not cameras, lights, or nulls)");
        }
        if (!layer.canSetTimeRemapEnabled) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Layer does not support time remapping (canSetTimeRemapEnabled is false). Use a footage or precomp layer instead of a solid or still-image layer.");
        }

        var previousValue = layer.timeRemapEnabled;
        if (previousValue === !!args.enabled) {
            return JSON.stringify({ status: "noop", message: "Time remap is already " + (previousValue ? "enabled" : "disabled") + " on layer '" + layer.name + "'." }, null, 2);
        }
        layer.timeRemapEnabled = !!args.enabled;

        var result = {
            status: "success",
            message: "Time remap " + (layer.timeRemapEnabled ? "enabled" : "disabled") + " on layer '" + layer.name + "'.",
            layer: { name: layer.name, index: layer.index },
            timeRemapEnabled: layer.timeRemapEnabled,
            previousValue: previousValue
        };

        if (layer.timeRemapEnabled) {
            var timeRemapProp = layer.property("Time Remap");
            if (timeRemapProp) {
                var autoKeys = [];
                for (var k = 1; k <= timeRemapProp.numKeys; k++) {
                    autoKeys.push({ keyIndex: k, time: timeRemapProp.keyTime(k), value: timeRemapProp.keyValue(k) });
                }
                result.autoKeyframes = autoKeys;
                result.configurableProperties = _configurableLeaf(timeRemapProp, ["Time Remap"]);
            }
        }

        return JSON.stringify(result, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: setAnchorPoint — move anchor to a named bounding-box position; compensate Position so layer stays put.
// position: TOP_LEFT|TOP_CENTER|TOP_RIGHT|MIDDLE_LEFT|CENTER|MIDDLE_RIGHT|BOTTOM_LEFT|BOTTOM_CENTER|BOTTOM_RIGHT
function setAnchorPoint(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp = resolved.comp;
        var layer = resolved.layer;

        var position = (args.position || "CENTER").toUpperCase();
        var preservePosition = (args.preservePosition !== false);
        var overwriteKeyframes = args.overwriteKeyframes === true;

        var fxMap = {
            "TOP_LEFT": 0,    "TOP_CENTER": 0.5,    "TOP_RIGHT": 1,
            "MIDDLE_LEFT": 0, "CENTER": 0.5,         "MIDDLE_RIGHT": 1,
            "BOTTOM_LEFT": 0, "BOTTOM_CENTER": 0.5,  "BOTTOM_RIGHT": 1
        };
        var fyMap = {
            "TOP_LEFT": 0,    "TOP_CENTER": 0,     "TOP_RIGHT": 0,
            "MIDDLE_LEFT": 0.5, "CENTER": 0.5,     "MIDDLE_RIGHT": 0.5,
            "BOTTOM_LEFT": 1, "BOTTOM_CENTER": 1,  "BOTTOM_RIGHT": 1
        };

        if (fxMap[position] === undefined) {
            throw _err(ERROR_CODES.INVALID_ARGS,
                "Invalid position '" + position + "'. Use: TOP_LEFT, TOP_CENTER, TOP_RIGHT, MIDDLE_LEFT, CENTER, MIDDLE_RIGHT, BOTTOM_LEFT, BOTTOM_CENTER, BOTTOM_RIGHT.");
        }

        var rect = layer.sourceRectAtTime(comp.time, false);
        var newAnchorX = rect.left + fxMap[position] * rect.width;
        var newAnchorY = rect.top  + fyMap[position] * rect.height;

        var anchorProp = layer.property("Anchor Point");
        var posProp    = layer.property("Position");
        var oldAnchor  = anchorProp.value;
        var oldPos     = posProp.value;

        // Anchor already at the requested named position — the Position compensation delta is 0 too.
        if (_valuesEqual([newAnchorX, newAnchorY], [oldAnchor[0], oldAnchor[1]])) {
            return JSON.stringify({ status: "noop", message: "Anchor point is already at " + position + "." }, null, 2);
        }

        if (preservePosition) {
            var scale = layer.property("Scale").value;
            var sx = scale[0] / 100;
            var sy = scale[1] / 100;
            var deltaX = (newAnchorX - oldAnchor[0]) * sx;
            var deltaY = (newAnchorY - oldAnchor[1]) * sy;

            _guardKeyframeOverwrite(anchorProp, "anchorPoint", overwriteKeyframes);
            anchorProp.setValue([newAnchorX, newAnchorY]);

            _guardKeyframeOverwrite(posProp, "position", overwriteKeyframes);
            if (layer.threeDLayer) {
                posProp.setValue([oldPos[0] + deltaX, oldPos[1] + deltaY, oldPos[2]]);
            } else {
                posProp.setValue([oldPos[0] + deltaX, oldPos[1] + deltaY]);
            }
        } else {
            _guardKeyframeOverwrite(anchorProp, "anchorPoint", overwriteKeyframes);
            anchorProp.setValue([newAnchorX, newAnchorY]);
        }

        return JSON.stringify({
            status: "success",
            message: "Anchor point moved to " + position + ".",
            layer: { index: layer.index, name: layer.name },
            anchorPosition: position,
            anchor: anchorProp.value,
            position: layer.property("Position").value,
            previousValues: { anchorPoint: oldAnchor, position: oldPos }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: centerAnchorPoint — thin alias for setAnchorPoint({ position: 'CENTER' }); kept for backwards compatibility.
function centerAnchorPoint(args) {
    return setAnchorPoint({
        compName: args.compName, layerIndex: args.layerIndex, layerName: args.layerName,
        position: "CENTER", preservePosition: args.preservePosition, overwriteKeyframes: args.overwriteKeyframes
    });
}

// U: mergeLayer — inverse of splitLayer; joins two contiguous same-source layers into one
function mergeLayer(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp = resolved.comp;
        var left = resolved.layer;

        var rightIdx = args.mergeWithIndex;
        if (rightIdx === undefined || rightIdx === null) {
            throw _err(ERROR_CODES.INVALID_ARGS, "mergeWithIndex (the right-half layer) is required.");
        }
        if (rightIdx < 1 || rightIdx > comp.numLayers) {
            throw _err(ERROR_CODES.LAYER_INDEX_OOB, "mergeWithIndex out of bounds: " + rightIdx);
        }
        var right = comp.layer(rightIdx);
        if (left.index === right.index) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Cannot merge a layer with itself.");
        }

        // Source-parity check (text/shape/null layers lack .source — those layers can't be merged)
        var lSrc = null, rSrc = null;
        try { lSrc = left.source;  } catch (e) {}
        try { rSrc = right.source; } catch (e) {}
        if (!lSrc || !rSrc || lSrc.id !== rSrc.id) {
            throw _err(ERROR_CODES.INVALID_ARGS,
                "mergeLayer requires both layers to reference the same source (typical splitLayer output).");
        }

        // Continuity check: right.inPoint should match left.outPoint within 1 frame
        var tolerance = 1 / comp.frameRate;
        if (Math.abs(right.inPoint - left.outPoint) > tolerance) {
            throw _err(ERROR_CODES.INVALID_ARGS,
                "Layers are not contiguous: left.outPoint=" + left.outPoint +
                ", right.inPoint=" + right.inPoint + " (tolerance=" + tolerance + "s).");
        }

        var newOut = right.outPoint;
        var removedName  = right.name;
        var removedIndex = right.index;
        right.remove();
        left.outPoint = newOut;

        return JSON.stringify({
            status: "success",
            message: "Merged '" + removedName + "' into '" + left.name + "'.",
            layer: { index: left.index, name: left.name, inPoint: left.inPoint, outPoint: left.outPoint },
            removed: { index: removedIndex, name: removedName }
        }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: e.toString(), line: e.line }, null, 2);
    }
}

// U: decomposeLayer — inverse of precompose; lifts inner layers back into the parent comp
function decomposeLayer(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var parentComp = resolved.comp;
        var precompLayer = resolved.layer;

        if (!(precompLayer.source instanceof CompItem)) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Layer is not a precomp instance — nothing to decompose.");
        }
        var innerComp = precompLayer.source;

        // Refuse if the precomp is referenced by more than one comp
        if (innerComp.usedIn && innerComp.usedIn.length > 1) {
            throw _err(ERROR_CODES.INVALID_ARGS,
                "Precomp '" + innerComp.name + "' is used by " + innerComp.usedIn.length +
                " comps — decomposing would orphan the others. Duplicate it first.");
        }

        var precompName = precompLayer.name;
        var precompId   = innerComp.id;

        // Copy inner layers top→bottom. AE's copyToComp does NOT always land the new layer at
        // index 1 — empirically it places copies at the same index they had inside the precomp,
        // so parentComp.layer(1) would keep returning the first-copied layer. Snapshot existing
        // layer refs, copy, then find the one ref not in the snapshot. Move it immediately above
        // the precomp so each subsequent copy has a known anchor; final order = inner order.
        var copied = [];
        var innerCount = innerComp.numLayers;
        for (var i = 1; i <= innerCount; i++) {
            var pre = [];
            for (var pj = 1; pj <= parentComp.numLayers; pj++) { pre.push(parentComp.layer(pj)); }
            innerComp.layer(i).copyToComp(parentComp);
            var newLayer = null;
            for (var nj = 1; nj <= parentComp.numLayers; nj++) {
                var candidate = parentComp.layer(nj);
                var seen = false;
                for (var pk = 0; pk < pre.length; pk++) {
                    if (pre[pk] === candidate) { seen = true; break; }
                }
                if (!seen) { newLayer = candidate; break; }
            }
            if (!newLayer) {
                throw _err(ERROR_CODES.INTERNAL_ERROR, "Failed to locate newly copied layer for inner index " + i);
            }
            newLayer.moveBefore(precompLayer);
            copied.push(newLayer);
        }

        // Delete the precomp layer and the now-unused precomp item.
        precompLayer.remove();
        innerComp.remove();

        var unwrappedInfo = [];
        for (var u = 0; u < copied.length; u++) {
            unwrappedInfo.push({ index: copied[u].index, name: copied[u].name });
        }

        return JSON.stringify({
            status: "success",
            message: "Decomposed '" + precompName + "' — " + copied.length + " layer(s) unwrapped. " +
                     "Note: the precomp layer's own transforms/effects were not flattened onto children.",
            unwrappedLayers: unwrappedInfo,
            removedPrecomp: { name: precompName, id: precompId }
        }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: e.toString(), line: e.line }, null, 2);
    }
}

// D: deleteLayer
function deleteLayer(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var deletedName = layer.name;
        var deletedIndex = layer.index;
        layer.remove();

        return JSON.stringify({
            status: "success",
            message: "Layer deleted successfully",
            deleted: { name: deletedName, index: deletedIndex }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// R: getLayerProperty — read the current value (and optional value-at-time) of any layer property
//    by path. Universal "Read" before "Edit" for nested properties.
function getLayerProperty(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var propertyPath = args.propertyPath;
        if (!propertyPath || typeof propertyPath.length === "undefined" || propertyPath.length === 0) {
            throw _err(ERROR_CODES.INVALID_ARGS, "propertyPath must be a non-empty array.");
        }

        var property = _resolvePropertyByPath(layer, propertyPath);

        var propInfo = {
            name: property.name,
            path: propertyPath,
            value: property.value,
            numKeys: property.numKeys || 0,
            isTimeVarying: (property.numKeys || 0) > 0
        };

        if (args.timeInSeconds !== undefined) {
            propInfo.valueAtTime = property.valueAtTime(args.timeInSeconds, false);
            propInfo.timeInSeconds = args.timeInSeconds;
        }

        if (property.canSetExpression !== undefined) {
            propInfo.canSetExpression = property.canSetExpression;
            propInfo.hasExpression = property.canSetExpression && property.expressionEnabled;
            propInfo.expression = (property.canSetExpression && property.expressionEnabled) ? property.expression : "";
            if (propInfo.hasExpression) { propInfo.isTimeVarying = true; }
        }

        return JSON.stringify({ status: "success", property: propInfo }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: e.toString(), line: e.line }, null, 2);
    }
}

// getLayerProperties — return a layer's settable-property CATALOG ({n,p,k}) on demand, so create/mutate
// results no longer need to ship it on every call. scope: optional root propertyPath array (e.g.
// ["Transform"] or ["Effects","Gaussian Blur"]) — walk only that subtree; omit for the whole layer
// (Transform-first, capped). Same shape _configurableChildren returns elsewhere, so the agent reads it
// identically. Bad scope throws PROPERTY_NOT_FOUND via _resolvePropertyByPath (no silent guessing).
function getLayerProperties(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var rootProp = layer;
        var rootPath = [];
        if (args.scope && typeof args.scope.length !== "undefined" && args.scope.length > 0) {
            rootProp = _resolvePropertyByPath(layer, args.scope);
            rootPath = args.scope;
        }

        return JSON.stringify({ status: "success", configurableProperties: _configurableChildren(rootProp, rootPath) }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: e.toString(), line: e.line }, null, 2);
    }
}

// Compute a layer's axis-aligned comp-space bbox (ignores rotation). Shared by align/distribute.
function _getCompBbox(comp, layer) {
    var rect = layer.sourceRectAtTime(comp.time, false);
    var anchor = layer.property("Anchor Point").value;
    var pos = layer.property("Position").value;
    var scale = layer.property("Scale").value;
    var sx = scale[0] / 100;
    var sy = scale[1] / 100;
    var x1 = pos[0] + (rect.left - anchor[0]) * sx;
    var x2 = pos[0] + (rect.left + rect.width - anchor[0]) * sx;
    var y1 = pos[1] + (rect.top - anchor[1]) * sy;
    var y2 = pos[1] + (rect.top + rect.height - anchor[1]) * sy;
    return { left: Math.min(x1, x2), right: Math.max(x1, x2), top: Math.min(y1, y2), bottom: Math.max(y1, y2) };
}

// U: alignLayers — align layers horizontally or vertically to the composition bounds or selection bbox.
// alignment: LEFT|HORIZONTAL_CENTER|RIGHT|TOP|VERTICAL_CENTER|BOTTOM
// reference: COMPOSITION|SELECTION
function alignLayers(args) {
    try {
        var comp = _resolveComp(args);
        var layerIndices = args.layerIndices;
        var alignment = (args.alignment || "HORIZONTAL_CENTER").toUpperCase();
        var reference = (args.reference || "COMPOSITION").toUpperCase();

        if (!layerIndices || typeof layerIndices.length === "undefined" || layerIndices.length === 0) {
            throw _err(ERROR_CODES.INVALID_ARGS, "layerIndices must be a non-empty array.");
        }

        var validAlignments = { "LEFT": true, "HORIZONTAL_CENTER": true, "RIGHT": true, "TOP": true, "VERTICAL_CENTER": true, "BOTTOM": true };
        if (!validAlignments[alignment]) {
            throw _err(ERROR_CODES.INVALID_ARGS, "alignment must be LEFT, HORIZONTAL_CENTER, RIGHT, TOP, VERTICAL_CENTER, or BOTTOM.");
        }

        // Resolve layers
        var layers = [];
        for (var i = 0; i < layerIndices.length; i++) {
            var idx = layerIndices[i];
            if (idx < 1 || idx > comp.numLayers) throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Layer index out of bounds: " + idx);
            layers.push(comp.layer(idx));
        }

        // Determine reference bounds
        var refLeft, refRight, refTop, refBottom;
        if (reference === "COMPOSITION") {
            refLeft = 0; refRight = comp.width; refTop = 0; refBottom = comp.height;
        } else {
            // SELECTION: union of all target layer bboxes
            var allBboxes = [];
            for (var bi = 0; bi < layers.length; bi++) { allBboxes.push(_getCompBbox(comp, layers[bi])); }
            refLeft = allBboxes[0].left; refRight = allBboxes[0].right;
            refTop = allBboxes[0].top; refBottom = allBboxes[0].bottom;
            for (var ri = 1; ri < allBboxes.length; ri++) {
                if (allBboxes[ri].left   < refLeft)   refLeft   = allBboxes[ri].left;
                if (allBboxes[ri].right  > refRight)  refRight  = allBboxes[ri].right;
                if (allBboxes[ri].top    < refTop)    refTop    = allBboxes[ri].top;
                if (allBboxes[ri].bottom > refBottom) refBottom = allBboxes[ri].bottom;
            }
        }
        var refCenterX = (refLeft + refRight) / 2;
        var refCenterY = (refTop + refBottom) / 2;

        var previousPositions = [];
        var modifiedLayers = [];
        var anyChanged = false;

        for (var li = 0; li < layers.length; li++) {
            var layer = layers[li];
            var bbox = _getCompBbox(comp, layer);
            var pos = layer.property("Position").value;
            previousPositions.push({ index: layer.index, name: layer.name, position: pos });

            var deltaX = 0, deltaY = 0;
            if (alignment === "LEFT")              { deltaX = refLeft   - bbox.left;   }
            else if (alignment === "HORIZONTAL_CENTER") { deltaX = refCenterX - (bbox.left + bbox.right) / 2; }
            else if (alignment === "RIGHT")         { deltaX = refRight  - bbox.right;  }
            else if (alignment === "TOP")           { deltaY = refTop    - bbox.top;    }
            else if (alignment === "VERTICAL_CENTER")   { deltaY = refCenterY - (bbox.top + bbox.bottom) / 2; }
            else if (alignment === "BOTTOM")        { deltaY = refBottom - bbox.bottom; }

            var newPos;
            if (layer.threeDLayer) {
                newPos = [pos[0] + deltaX, pos[1] + deltaY, pos[2]];
            } else {
                newPos = [pos[0] + deltaX, pos[1] + deltaY];
            }
            if (!_valuesEqual(newPos, pos)) { anyChanged = true; }
            layer.property("Position").setValue(newPos);
            modifiedLayers.push({ index: layer.index, name: layer.name, newPosition: newPos });
        }

        // Every layer was already at its aligned position (all deltas 0) — nothing moved.
        if (!anyChanged) {
            return JSON.stringify({ status: "noop", message: "Those layers are already aligned." }, null, 2);
        }

        return JSON.stringify({
            status: "success",
            message: "Aligned " + layers.length + " layer(s) (" + alignment + ", reference: " + reference + ").",
            alignment: alignment,
            reference: reference,
            modifiedLayers: modifiedLayers,
            previousPositions: previousPositions
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: distributeLayers — evenly space layers along one axis (bounding-box-aware; only moves that axis).
// axis: horizontal|vertical · gap: optional px between adjacent boxes (omit for a comfy default)
// reference: COMPOSITION (center the run in the comp) | SELECTION (keep the group's current center;
//            classic distribute — equalize gaps, extremes fixed — when gap is omitted)
function distributeLayers(args) {
    try {
        var comp = _resolveComp(args);
        var layerIndices = args.layerIndices;
        var axis = (args.axis || "vertical").toLowerCase();
        var reference = (args.reference || "COMPOSITION").toUpperCase();
        var gap = (args.gap !== undefined && args.gap !== null) ? args.gap : null;

        if (!layerIndices || typeof layerIndices.length === "undefined" || layerIndices.length === 0) {
            throw _err(ERROR_CODES.INVALID_ARGS, "layerIndices must be a non-empty array.");
        }
        if (axis !== "horizontal" && axis !== "vertical") {
            throw _err(ERROR_CODES.INVALID_ARGS, "axis must be horizontal or vertical.");
        }
        if (reference !== "COMPOSITION" && reference !== "SELECTION") {
            throw _err(ERROR_CODES.INVALID_ARGS, "reference must be COMPOSITION or SELECTION.");
        }
        if (gap !== null && (typeof gap !== "number" || isNaN(gap))) {
            throw _err(ERROR_CODES.INVALID_ARGS, "gap must be a number (px) when provided.");
        }

        // Resolve layers
        var layers = [];
        for (var i = 0; i < layerIndices.length; i++) {
            var idx = layerIndices[i];
            if (idx < 1 || idx > comp.numLayers) throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Layer index out of bounds: " + idx);
            layers.push(comp.layer(idx));
        }
        if (layers.length < 2) {
            throw _err(ERROR_CODES.INVALID_ARGS, "distributeLayers needs at least 2 layers.");
        }

        var axisIdx = (axis === "vertical") ? 1 : 0;
        var minKey = (axis === "vertical") ? "top" : "left";
        var maxKey = (axis === "vertical") ? "bottom" : "right";
        var compAxisSize = (axis === "vertical") ? comp.height : comp.width;

        // Build entries with bbox + extent, then sort by current visual order along the axis.
        var entries = [];
        for (var e = 0; e < layers.length; e++) {
            var bb = _getCompBbox(comp, layers[e]);
            entries.push({ layer: layers[e], bbox: bb, min: bb[minKey], extent: bb[maxKey] - bb[minKey] });
        }
        entries.sort(function (a, b) { return a.min - b.min; });

        var n = entries.length;
        var sumExtent = 0;
        for (var s = 0; s < n; s++) { sumExtent += entries[s].extent; }
        var avgExtent = sumExtent / n;

        // Current group extent (for SELECTION placement / classic distribute).
        var groupMin = entries[0].min;
        var groupMax = entries[n - 1].bbox[maxKey];

        var targets = [];   // target bbox-min along the axis, in sorted order
        if (gap === null && reference === "SELECTION") {
            // Classic distribute: keep first/last fixed, equalize the gaps between.
            var gapEach = ((groupMax - groupMin) - sumExtent) / (n - 1);
            var cursorA = groupMin;
            for (var d = 0; d < n; d++) {
                targets.push(cursorA);
                cursorA += entries[d].extent + gapEach;
            }
        } else {
            // Fixed-gap layout (explicit gap, or comfy proportional default).
            var effectiveGap = (gap !== null) ? gap : 0.4 * avgExtent;
            var runLength = sumExtent + effectiveGap * (n - 1);
            var start;
            if (reference === "COMPOSITION") {
                start = (compAxisSize - runLength) / 2;
            } else {
                start = ((groupMin + groupMax) / 2) - runLength / 2;
            }
            var cursorB = start;
            for (var f = 0; f < n; f++) {
                targets.push(cursorB);
                cursorB += entries[f].extent + effectiveGap;
            }
        }

        var previousPositions = [];
        var modifiedLayers = [];
        var anyChanged = false;
        for (var li = 0; li < n; li++) {
            var layer = entries[li].layer;
            var pos = layer.property("Position").value;
            previousPositions.push({ index: layer.index, name: layer.name, position: pos });

            var delta = targets[li] - entries[li].min;
            var newPos = layer.threeDLayer ? [pos[0], pos[1], pos[2]] : [pos[0], pos[1]];
            newPos[axisIdx] = pos[axisIdx] + delta;
            if (!_valuesEqual(newPos, pos)) { anyChanged = true; }
            layer.property("Position").setValue(newPos);
            modifiedLayers.push({ index: layer.index, name: layer.name, newPosition: newPos });
        }

        if (!anyChanged) {
            return JSON.stringify({ status: "noop", message: "Those layers are already evenly distributed." }, null, 2);
        }

        return JSON.stringify({
            status: "success",
            message: "Distributed " + n + " layer(s) (" + axis + ", reference: " + reference + (gap !== null ? ", gap: " + gap + "px" : ", comfy gap") + ").",
            axis: axis,
            reference: reference,
            modifiedLayers: modifiedLayers,
            previousPositions: previousPositions
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: fitToFrame — scale a layer to the composition frame (bounding-box-aware), then center it.
// mode: fit (contain — whole layer visible) | fill (cover — frame fully covered, edges cropped) |
//       stretch (independent x/y — fills exactly, may distort). offset: [x,y] px nudge from center.
// Computes scale from the layer's natural source rect vs the comp size, so the model never
// hand-computes scale %. Centering reuses the same anchor-aware delta math as alignLayers.
function fitToFrame(args) {
    try {
        var comp = _resolveComp(args);
        var layerIndices = args.layerIndices;
        var mode = (args.mode || "fit").toLowerCase();
        var offset = args.offset || [0, 0];

        if (!layerIndices || typeof layerIndices.length === "undefined" || layerIndices.length === 0) {
            throw _err(ERROR_CODES.INVALID_ARGS, "layerIndices must be a non-empty array.");
        }
        if (mode !== "fit" && mode !== "fill" && mode !== "stretch") {
            throw _err(ERROR_CODES.INVALID_ARGS, "mode must be fit, fill, or stretch.");
        }
        var offX = (offset && offset.length > 0) ? parseFloat(offset[0]) : 0;
        var offY = (offset && offset.length > 1) ? parseFloat(offset[1]) : 0;

        // Resolve layers
        var layers = [];
        for (var i = 0; i < layerIndices.length; i++) {
            var idx = layerIndices[i];
            if (idx < 1 || idx > comp.numLayers) throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Layer index out of bounds: " + idx);
            layers.push(comp.layer(idx));
        }

        var compCenterX = comp.width / 2;
        var compCenterY = comp.height / 2;

        var previousValues = [];
        var modifiedLayers = [];
        var anyChanged = false;

        for (var li = 0; li < layers.length; li++) {
            var layer = layers[li];
            // Natural (unscaled) source bounds at the current time.
            var rect = layer.sourceRectAtTime(comp.time, false);
            if (rect.width <= 0 || rect.height <= 0) {
                throw _err(ERROR_CODES.INVALID_ARGS, "Layer '" + layer.name + "' has no measurable bounds to fit.");
            }

            var scaleProp = layer.property("Scale");
            var posProp = layer.property("Position");
            var prevScale = scaleProp.value;
            var prevPos = posProp.value;
            previousValues.push({ index: layer.index, name: layer.name, scale: prevScale, position: prevPos });

            // Scale factors (percent) to make the source exactly span each comp axis at 100% = natural size.
            var ratioX = (comp.width / rect.width) * 100;
            var ratioY = (comp.height / rect.height) * 100;
            var sx, sy;
            if (mode === "stretch")    { sx = ratioX; sy = ratioY; }
            else if (mode === "fill")  { sx = sy = Math.max(ratioX, ratioY); }
            else                       { sx = sy = Math.min(ratioX, ratioY); } // fit (contain)

            // Write scale via the current value as a template so z survives (AE Scale is [x,y,z]).
            var newScale = scaleProp.value;
            newScale[0] = sx;
            newScale[1] = sy;
            scaleProp.setValue(newScale);

            // Center anchor-awarely: recompute the bbox at the new scale, then shift Position so the
            // bbox center lands on the comp center (+ offset). Same delta math as alignLayers.
            var bbox = _getCompBbox(comp, layer);
            var deltaX = (compCenterX + offX) - (bbox.left + bbox.right) / 2;
            var deltaY = (compCenterY + offY) - (bbox.top + bbox.bottom) / 2;
            var newPos = layer.threeDLayer ? [prevPos[0] + deltaX, prevPos[1] + deltaY, prevPos[2]] : [prevPos[0] + deltaX, prevPos[1] + deltaY];
            posProp.setValue(newPos);

            if (!_valuesEqual(newScale, prevScale) || !_valuesEqual(newPos, prevPos)) { anyChanged = true; }
            modifiedLayers.push({ index: layer.index, name: layer.name, scale: newScale, position: newPos });
        }

        if (!anyChanged) {
            return JSON.stringify({ status: "noop", message: "Those layers already fit the frame." }, null, 2);
        }

        return JSON.stringify({
            status: "success",
            message: "Fit " + layers.length + " layer(s) to frame (" + mode + ").",
            mode: mode,
            modifiedLayers: modifiedLayers,
            previousValues: previousValues
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: sequenceLayers — stagger the inPoint of layers in a staircase pattern.
// orderType: TOP_DOWN (ascending layer index), BOTTOM_UP (descending), RANDOM (Fisher-Yates)
function sequenceLayers(args) {
    try {
        var comp = _resolveComp(args);
        var layerIndices = args.layerIndices;
        var offsetFrames = (args.offsetFrames !== undefined && args.offsetFrames !== null) ? args.offsetFrames : 1;
        var orderType = (args.orderType || "TOP_DOWN").toUpperCase();

        if (!layerIndices || typeof layerIndices.length === "undefined" || layerIndices.length === 0) {
            throw _err(ERROR_CODES.INVALID_ARGS, "layerIndices must be a non-empty array.");
        }
        var validOrders = { "TOP_DOWN": true, "BOTTOM_UP": true, "RANDOM": true };
        if (!validOrders[orderType]) {
            throw _err(ERROR_CODES.INVALID_ARGS, "orderType must be TOP_DOWN, BOTTOM_UP, or RANDOM.");
        }

        var layers = [];
        for (var i = 0; i < layerIndices.length; i++) {
            var idx = layerIndices[i];
            if (idx < 1 || idx > comp.numLayers) throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Layer index out of bounds: " + idx);
            layers.push(comp.layer(idx));
        }

        if (orderType === "TOP_DOWN") {
            layers.sort(function(a, b) { return a.index - b.index; });
        } else if (orderType === "BOTTOM_UP") {
            layers.sort(function(a, b) { return b.index - a.index; });
        } else {
            // Fisher-Yates shuffle
            for (var j = layers.length - 1; j > 0; j--) {
                var k = Math.floor(Math.random() * (j + 1));
                var tmp = layers[j]; layers[j] = layers[k]; layers[k] = tmp;
            }
        }

        var baseStartTime = (args.baseStartTime !== undefined && args.baseStartTime !== null)
            ? args.baseStartTime
            : layers[0].startTime;
        var frameDuration = comp.frameDuration;

        var previousStartTimes = [];
        var modifiedLayers = [];
        var anyChanged = false;
        for (var n = 0; n < layers.length; n++) {
            previousStartTimes.push({ index: layers[n].index, name: layers[n].name, startTime: layers[n].startTime });
            var newStart = baseStartTime + n * offsetFrames * frameDuration;
            if (!_valuesEqual(newStart, layers[n].startTime)) { anyChanged = true; }
            layers[n].startTime = newStart;
            modifiedLayers.push({ index: layers[n].index, name: layers[n].name, newStartTime: newStart });
        }

        // Every layer already starts at its sequenced time — nothing changed.
        if (!anyChanged) {
            return JSON.stringify({ status: "noop", message: "Those layers are already sequenced." }, null, 2);
        }

        return JSON.stringify({
            status: "success",
            message: "Sequenced " + layers.length + " layers with " + offsetFrames + " frame(s) offset (" + orderType + ").",
            orderType: orderType,
            offsetFrames: offsetFrames,
            baseStartTime: baseStartTime,
            modifiedLayers: modifiedLayers,
            previousStartTimes: previousStartTimes
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// ── 3D Distribution Helpers ────────────────────────────────────────────────────

// Internal: compute XYZ positions for cylinder/tunnel distribution.
// Layers are spread across `rings` Z-stacked circles of perRing slots each.
function _computeCylinderPositions(count, cx, cy, cz, radius, depthSpacing, rings, axis) {
    var perRing = Math.ceil(count / rings);
    var positions = [];
    for (var i = 0; i < count; i++) {
        var ring  = Math.floor(i / perRing);
        var slot  = i % perRing;
        var angle = (2 * Math.PI * slot) / perRing;
        var posX, posY, posZ;
        if (axis === "y") {
            posX = cx + radius * Math.cos(angle);
            posY = cy + ring * depthSpacing;
            posZ = cz + radius * Math.sin(angle);
        } else if (axis === "x") {
            posX = cx + ring * depthSpacing;
            posY = cy + radius * Math.cos(angle);
            posZ = cz + radius * Math.sin(angle);
        } else {
            // axis === "z" (default — tunnel going into/out of screen)
            posX = cx + radius * Math.cos(angle);
            posY = cy + radius * Math.sin(angle);
            posZ = cz + ring * depthSpacing;
        }
        positions.push([posX, posY, posZ]);
    }
    return positions;
}

// Internal: compute XYZ positions for grid distribution.
// Layers placed in rows×cols cells on successive planes spaced by spacing[2].
function _computeGridPositions(count, cx, cy, cz, rows, cols, spacing) {
    var sx = +spacing[0];
    var sy = +spacing[1];
    var sz = +spacing[2];
    var totalW = (cols - 1) * sx;
    var totalH = (rows - 1) * sy;
    var positions = [];
    for (var i = 0; i < count; i++) {
        var plane = Math.floor(i / (rows * cols));
        var local = i % (rows * cols);
        var row   = Math.floor(local / cols);
        var col   = local % cols;
        positions.push([
            cx - totalW / 2 + col * sx,
            cy - totalH / 2 + row * sy,
            cz + plane * sz
        ]);
    }
    return positions;
}

// C/U: distributeLayers3D — position an array of layers in a 3D shape.
// The backend computes all XYZ coordinates; the LLM just specifies shape + params.
// Supported shapes (v1): cylinder (tunnel), grid (planar with optional Z-step).
function distributeLayers3D(args) {
    try {
        var comp = _resolveComp(args);

        var shape = args.shape;
        if (shape !== "cylinder" && shape !== "grid") {
            throw _err(ERROR_CODES.INVALID_ARGS,
                "Invalid shape: '" + shape + "'. Supported in v1: cylinder, grid. (sphere, helix, ring, line deferred to v2)");
        }

        var layerIndices = args.layerIndices;
        if (!layerIndices || typeof layerIndices.length === "undefined" || layerIndices.length < 2) {
            throw _err(ERROR_CODES.INVALID_ARGS, "layerIndices must contain at least 2 layers.");
        }

        // Validate all indices up-front before mutating anything
        for (var vi = 0; vi < layerIndices.length; vi++) {
            var vidx = layerIndices[vi];
            if (vidx < 1 || vidx > comp.numLayers) {
                throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Layer index out of bounds: " + vidx);
            }
        }

        var count = layerIndices.length;

        // Center defaults to comp center (XY) at Z=0
        var rawCenter = args.center;
        if (rawCenter && typeof rawCenter === "string") { try { rawCenter = eval("(" + rawCenter + ")"); } catch (e2) {} }
        var cx = (rawCenter && rawCenter[0] !== undefined) ? +rawCenter[0] : comp.width  / 2;
        var cy = (rawCenter && rawCenter[1] !== undefined) ? +rawCenter[1] : comp.height / 2;
        var cz = (rawCenter && rawCenter[2] !== undefined) ? +rawCenter[2] : 0;

        var enable3D   = args.enable3D !== false; // default true
        var faceCamera = args.faceCamera === true;
        var overwrite  = args.overwriteKeyframes === true;

        // Compute target positions
        var positions;
        if (shape === "cylinder") {
            var radius       = (args.radius       !== undefined) ? +args.radius       : 400;
            var depthSpacing = (args.depthSpacing  !== undefined) ? +args.depthSpacing  : 500;
            var rings        = (args.rings         !== undefined) ? Math.max(1, Math.round(+args.rings)) : 1;
            var axis         = args.axis || "z";
            if (radius <= 0)      { throw _err(ERROR_CODES.INVALID_ARGS, "radius must be > 0."); }
            if (depthSpacing < 0) { throw _err(ERROR_CODES.INVALID_ARGS, "depthSpacing must be >= 0."); }
            positions = _computeCylinderPositions(count, cx, cy, cz, radius, depthSpacing, rings, axis);
        } else {
            var rawSpacing = args.spacing;
            if (rawSpacing && typeof rawSpacing === "string") { try { rawSpacing = eval("(" + rawSpacing + ")"); } catch (e2) {} }
            var spacing = rawSpacing || [200, 200, 0];
            var rows = args.rows ? Math.max(1, Math.round(+args.rows)) : Math.ceil(Math.sqrt(count));
            var cols = args.cols ? Math.max(1, Math.round(+args.cols)) : Math.ceil(count / rows);
            positions = _computeGridPositions(count, cx, cy, cz, rows, cols, spacing);
        }

        var positionedLayers = [];
        for (var i = 0; i < count; i++) {
            var idx   = layerIndices[i];
            var layer = comp.layer(idx);
            var pos   = positions[i];

            var prevThreeD = layer.threeDLayer;

            // Enable 3D BEFORE reading/writing Position — ordering matters (layers.jsx:456→:475 pattern)
            if (enable3D && !layer.threeDLayer) {
                layer.threeDLayer = true;
            }

            // Re-fetch after 3D toggle: property dimensionality changes 2D→3D
            var posProp = layer.property("Transform").property("Position");

            // Snapshot previous position after 3D enable so dim matches new state
            var prevPos = null;
            try { prevPos = posProp.value; } catch (e) {}

            _guardKeyframeOverwrite(posProp, "Position[L" + idx + "]", overwrite);

            posProp.setValue([+pos[0], +pos[1], +pos[2]]);

            if (faceCamera) {
                layer.autoOrient = AutoOrientType.CAMERA_OR_POINT_OF_INTEREST;
            }

            positionedLayers.push({
                layerIndex:          layer.index,
                layerName:           layer.name,
                position:            [+pos[0], +pos[1], +pos[2]],
                previousPosition:    prevPos,
                previousThreeDLayer: prevThreeD
            });
        }

        return JSON.stringify({
            status:          "success",
            shape:           shape,
            layersPositioned: count,
            positionedLayers: positionedLayers
        }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: e.toString(), line: e.line }, null, 2);
    }
}

// U: setLayerProperty — generic path-based setter (mirror of getLayerProperty).
// Respects overwriteKeyframes flag for keyframed properties.
function setLayerProperty(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;
        var overwriteKeyframes = args.overwriteKeyframes === true;

        var propertyPath = args.propertyPath;
        if (!propertyPath || typeof propertyPath.length === "undefined" || propertyPath.length === 0) {
            throw _err(ERROR_CODES.INVALID_ARGS, "propertyPath must be a non-empty array.");
        }

        var property = _resolvePropertyByPath(layer, propertyPath);

        if (property.numKeys !== undefined && property.numKeys > 0) {
            _guardKeyframeOverwrite(property, propertyPath.join(" > "), overwriteKeyframes);
        }

        if (!property.setValue) {
            throw _err(ERROR_CODES.INVALID_ARGS, "Property '" + property.name + "' is a group or read-only and cannot be set directly.");
        }

        var value = args.value;
        if (typeof value === "string") { try { value = eval("(" + value + ")"); } catch(e) {} }

        // Reconstruct as a literal array so AE always gets a native ExtendScript array type.
        var currentVal = property.value;
        var finalVal;
        if (typeof currentVal === "object" && typeof currentVal.length === "number" && currentVal.length >= 1 && value instanceof Array) {
            finalVal = [];
            for (var vi = 0; vi < currentVal.length; vi++) {
                var inVal = +value[vi];
                finalVal[vi] = isNaN(inVal) ? +currentVal[vi] : inVal;
            }
        } else {
            finalVal = value;
        }

        var previousValue = null;
        try { previousValue = property.value; } catch(e) {}
        // No keyframes and the value already matches — setting it again would change nothing.
        // (When the property is keyframed and we're overwriting keys, that IS a change — don't noop.)
        var hasKeys = (property.numKeys !== undefined && property.numKeys > 0);
        if (!hasKeys && _valuesEqual(finalVal, previousValue)) {
            return JSON.stringify({ status: "noop", message: "Property '" + property.name + "' is already set to that value." }, null, 2);
        }
        property.setValue(finalVal);

        return JSON.stringify({
            status: "success",
            message: "Property '" + property.name + "' updated.",
            property: { path: propertyPath, name: property.name, value: property.value },
            previousValue: previousValue
        }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: e.toString(), line: e.line }, null, 2);
    }
}

// ── Camera moves & backgrounds ──────────────────────────────────────────────

// Find the topmost camera layer in a comp, or null.
function _findCamera(comp) {
    for (var i = 1; i <= comp.numLayers; i++) {
        try { if (comp.layer(i) instanceof CameraLayer) { return comp.layer(i); } } catch (e) {}
    }
    return null;
}

// C/U: cameraMove — create/animate a camera for push-in, orbit, or parallax in ONE call instead of
// hand-keyframing the camera rig. Keyframes are eased via _recipeSetKey (consistent with recipes).
function cameraMove(args) {
    var createdCamera = null;  // tracked for atomic-create rollback
    try {
        var comp = _resolveComp(args);
        var move = args.move ? String(args.move) : "pushIn";
        var startTime = args.startTime !== undefined ? +args.startTime : 0;
        var duration  = args.duration  !== undefined ? +args.duration  : 2;
        var ease      = args.ease ? String(args.ease) : "easyEase";
        var amount    = (args.amount !== undefined && args.amount !== null) ? +args.amount : null;
        var overwrite = args.overwriteKeyframes === true;
        var createIfMissing = (args.createIfMissing !== undefined) ? !!args.createIfMissing : true;

        if (duration <= 0) { throw _err(ERROR_CODES.INVALID_ARGS, "duration must be > 0."); }
        if (startTime + duration > comp.duration + 0.001) {
            throw _err(ERROR_CODES.TIME_OUT_OF_RANGE, "Move extends to " + (startTime + duration).toFixed(3) + "s, past comp duration " + comp.duration.toFixed(3) + "s.");
        }
        var t1 = startTime + duration;

        var cam = _findCamera(comp);
        if (!cam) {
            if (!createIfMissing) { throw _err(ERROR_CODES.LAYER_NOT_FOUND, "No camera in the comp (pass createIfMissing:true to add one)."); }
            cam = comp.layers.addCamera("Camera", [comp.width / 2, comp.height / 2]);
            createdCamera = cam;
        }

        var camOpts  = cam.property("Camera Options");
        var zoomProp = camOpts.property("Zoom");
        var posProp  = cam.property("Position");
        var prevVals = {};

        if (move === "pushIn") {
            var z0 = (args.zoomFrom !== undefined && args.zoomFrom !== null) ? +args.zoomFrom : zoomProp.value;
            var z1 = (args.zoomTo   !== undefined && args.zoomTo   !== null) ? +args.zoomTo   : z0 * (1 + (amount !== null ? amount : 0.3));
            try { prevVals.zoom = zoomProp.value; } catch (e) {}
            if (overwrite) { while (zoomProp.numKeys > 0) { zoomProp.removeKey(1); } }
            _recipeSetKey(zoomProp, startTime, z0, ease);
            _recipeSetKey(zoomProp, t1, z1, ease);

        } else if (move === "orbit") {
            var degrees = (amount !== null) ? amount : 30;
            var poi;
            try { poi = cam.property("Point of Interest").value; } catch (e) { poi = [comp.width / 2, comp.height / 2, 0]; }
            var p = posProp.value;
            var dx = p[0] - poi[0];
            var dz = (p[2] !== undefined ? p[2] : 0) - (poi[2] !== undefined ? poi[2] : 0);
            var radius = Math.sqrt(dx * dx + dz * dz);
            if (radius < 1) { radius = (p[2] !== undefined ? Math.abs(p[2]) : comp.width); }
            var a0 = Math.atan2(dz, dx);
            var y = p[1];
            try { prevVals.position = posProp.value; } catch (e) {}
            if (overwrite) { while (posProp.numKeys > 0) { posProp.removeKey(1); } }
            // Sample the arc so interpolation curves around the POI instead of cutting a chord through it.
            var steps = 6;
            for (var s = 0; s <= steps; s++) {
                var frac = s / steps;
                var ang = a0 + (degrees * Math.PI / 180) * frac;
                var px = poi[0] + radius * Math.cos(ang);
                var pz = (poi[2] !== undefined ? poi[2] : 0) + radius * Math.sin(ang);
                _recipeSetKey(posProp, startTime + duration * frac, [px, y, pz], ease);
            }

        } else if (move === "parallax") {
            var pan = (amount !== null) ? amount : 200;
            // Spread the listed layers in Z so the camera pan reveals depth; then pan the camera.
            var layerIndices = args.layerIndices;
            var layerSnaps = [];
            if (layerIndices && layerIndices.length) {
                var nn = layerIndices.length;
                for (var li = 0; li < nn; li++) {
                    var L = comp.layer(layerIndices[li]);
                    var wasThreeD = L.threeDLayer;
                    L.threeDLayer = true;
                    var lp = L.property("Position").value;
                    var z = -400 + (800 * (nn > 1 ? li / (nn - 1) : 0.5));
                    layerSnaps.push({ index: L.index, prevThreeD: wasThreeD, prevPos: lp });
                    L.property("Position").setValue([lp[0], lp[1], z]);
                }
            }
            try { prevVals.position = posProp.value; } catch (e) {}
            if (overwrite) { while (posProp.numKeys > 0) { posProp.removeKey(1); } }
            var cp = posProp.value;
            var cz = (cp[2] !== undefined ? cp[2] : 0);
            _recipeSetKey(posProp, startTime, [cp[0] - pan / 2, cp[1], cz], ease);
            _recipeSetKey(posProp, t1, [cp[0] + pan / 2, cp[1], cz], ease);
            prevVals.layers = layerSnaps;

        } else {
            throw _err(ERROR_CODES.INVALID_ARGS, "move must be pushIn, orbit, or parallax.");
        }

        return JSON.stringify({
            status: "success",
            message: "Camera " + move + " over " + duration + "s" + (createdCamera ? " (added a camera)" : "") + ".",
            move: move,
            camera: { name: cam.name, index: cam.index, created: (createdCamera !== null) },
            previousValues: prevVals
        }, null, 2);
    } catch (error) {
        if (createdCamera !== null) { try { createdCamera.remove(); } catch (e2) {} }
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: createBackground — add a base background layer (solid + optional Gradient Ramp), placed at the
// BOTTOM of the stack. Gradient colors use the Ramp effect because shape gradient stops aren't
// scriptable (see shapes.jsx header). Optional subtle animated drift via a wiggle expression.
function createBackground(args) {
    var bgLayer = null;  // tracked for atomic-create rollback
    try {
        var comp = _resolveComp(args);
        var color    = args.color || [0.05, 0.05, 0.08];
        var gradient = (args.gradient !== undefined) ? !!args.gradient : true;
        var name     = args.name || "Background";
        var animate  = args.animate === true;

        bgLayer = comp.layers.addSolid(color, name, comp.width, comp.height, 1);

        var rampInfo = null;
        if (gradient) {
            var startColor = args.startColor || [0.10, 0.12, 0.20];
            var endColor   = args.endColor   || [0.02, 0.02, 0.05];
            var gradientShape = args.gradientShape ? String(args.gradientShape) : "linear";
            var ramp = bgLayer.Effects.addProperty("ADBE Ramp");
            // Reach Ramp props by display name (DFS) — robust across AE versions.
            var sc = _findPropByName(ramp, "Start Color");
            var ec = _findPropByName(ramp, "End Color");
            var sr = _findPropByName(ramp, "Start of Ramp");
            var er = _findPropByName(ramp, "End of Ramp");
            var shp = _findPropByName(ramp, "Ramp Shape");
            if (sc) { try { sc.setValue(startColor); } catch (e) {} }
            if (ec) { try { ec.setValue(endColor); } catch (e) {} }
            if (sr) { try { sr.setValue([comp.width / 2, 0]); } catch (e) {} }
            if (er) { try { er.setValue([comp.width / 2, comp.height]); } catch (e) {} }
            if (shp) { try { shp.setValue(gradientShape === "radial" ? 2 : 1); } catch (e) {} }
            if (animate && sr) {
                var driftAmount = (args.driftAmount !== undefined) ? +args.driftAmount : 30;
                try { sr.expression = _buildPresetExpression("WIGGLE", { freq: 0.4, amp: driftAmount }); } catch (e) {}
            }
            rampInfo = { shape: gradientShape };
        }

        // Place at the bottom of the stack so it renders behind everything (highest index).
        try { bgLayer.moveToEnd(); } catch (e) {}

        return JSON.stringify({
            status: "success",
            message: "Added a " + (gradient ? "gradient " : "") + "background" + (animate ? " with drift" : "") + ".",
            layer: { name: bgLayer.name, index: bgLayer.index, type: "solid" },
            gradient: rampInfo,
            configurableProperties: _configurableChildren(bgLayer, [])
        }, null, 2);
    } catch (error) {
        if (bgLayer !== null) { try { bgLayer.remove(); } catch (e2) {} }
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: addNullToLayers — add a parent null and parent the layers to it. mode "single" = one null centered
// on the selection's combined bbox (the canonical control-rig move); "perLayer" = one null per layer.
// Reuses _getCompBbox so the null lands on the real visual center, not a raw anchor point.
function addNullToLayers(args) {
    var createdNulls = [];  // tracked for atomic-create rollback
    try {
        var comp = _resolveComp(args);
        var layerIndices = args.layerIndices;
        if (!layerIndices || typeof layerIndices.length === "undefined" || layerIndices.length === 0) {
            throw _err(ERROR_CODES.INVALID_ARGS, "layerIndices must be a non-empty array.");
        }
        var mode = args.mode ? String(args.mode) : "single";
        var baseName = args.name || "Control";

        var layers = [];
        for (var i = 0; i < layerIndices.length; i++) {
            var idx = layerIndices[i];
            if (idx < 1 || idx > comp.numLayers) { throw _err(ERROR_CODES.LAYER_INDEX_OOB, "Layer index out of bounds: " + idx); }
            layers.push(comp.layer(idx));
        }

        var result = [];
        if (mode === "perLayer") {
            for (var p = 0; p < layers.length; p++) {
                var L = layers[p];
                var bb = _getCompBbox(comp, L);
                var nul = comp.layers.addNull();
                createdNulls.push(nul);
                nul.name = baseName + " " + L.name;
                nul.property("Position").setValue([(bb.left + bb.right) / 2, (bb.top + bb.bottom) / 2]);
                try { nul.moveBefore(L); } catch (e) {}
                var prevParent = L.parent ? { name: L.parent.name, index: L.parent.index } : null;
                L.parent = nul;
                result.push({ nullName: nul.name, child: L.name, prevParent: prevParent, configurableProperties: _configurableChildren(nul, []) });
            }
        } else {
            var left = null, right = null, top = null, bottom = null, minIdx = layers[0].index;
            for (var u = 0; u < layers.length; u++) {
                var b = _getCompBbox(comp, layers[u]);
                if (left === null || b.left < left) { left = b.left; }
                if (right === null || b.right > right) { right = b.right; }
                if (top === null || b.top < top) { top = b.top; }
                if (bottom === null || b.bottom > bottom) { bottom = b.bottom; }
                if (layers[u].index < minIdx) { minIdx = layers[u].index; }
            }
            var nul2 = comp.layers.addNull();
            createdNulls.push(nul2);
            nul2.name = baseName;
            nul2.property("Position").setValue([(left + right) / 2, (top + bottom) / 2]);
            try { nul2.moveBefore(comp.layer(minIdx)); } catch (e) {}
            var children = [];
            for (var c = 0; c < layers.length; c++) {
                var prevP = layers[c].parent ? { name: layers[c].parent.name, index: layers[c].parent.index } : null;
                layers[c].parent = nul2;
                children.push({ name: layers[c].name, prevParent: prevP });
            }
            result.push({ nullName: nul2.name, children: children, configurableProperties: _configurableChildren(nul2, []) });
        }

        return JSON.stringify({
            status: "success",
            message: "Added " + createdNulls.length + " control null" + (createdNulls.length === 1 ? "" : "s") + " (" + mode + ") and parented " + layers.length + " layer(s).",
            mode: mode,
            nulls: result
        }, null, 2);
    } catch (error) {
        for (var r = createdNulls.length - 1; r >= 0; r--) { try { createdNulls[r].remove(); } catch (e2) {} }
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// R/C: getLayerColors — collect a layer's colors (text fill + shape fills/strokes) and, unless
// createController:false, drop them onto a "Colors" controller null as ADBE Color Control effects.
function getLayerColors(args) {
    var controller = null;  // tracked for atomic-create rollback
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp = resolved.comp;
        var layer = resolved.layer;

        var colors = [];
        function pushColor(c) {
            if (!c || c.length < 3) { return; }
            var r = Math.round(c[0] * 1000) / 1000, g = Math.round(c[1] * 1000) / 1000, bl = Math.round(c[2] * 1000) / 1000;
            for (var i = 0; i < colors.length; i++) {
                if (Math.abs(colors[i][0] - r) < 0.004 && Math.abs(colors[i][1] - g) < 0.004 && Math.abs(colors[i][2] - bl) < 0.004) { return; }
            }
            colors.push([r, g, bl]);
        }
        try { var td = layer.property("Text"); if (td) { pushColor(td.property("ADBE Text Document").value.fillColor); } } catch (e) {}
        function scanShape(group) {
            for (var i = 1; i <= group.numProperties; i++) {
                var p = group.property(i);
                var mn = null; try { mn = p.matchName; } catch (e) {}
                if (mn === "ADBE Vector Graphic - Fill" || mn === "ADBE Vector Graphic - Stroke") {
                    try { pushColor(p.property("Color").value); } catch (e) {}
                } else if (p.numProperties && p.numProperties > 0) { scanShape(p); }
            }
        }
        try { var cont = layer.property("Contents"); if (cont) { scanShape(cont); } } catch (e) {}

        if (colors.length === 0) { return JSON.stringify({ status: "noop", message: "No fill/stroke colors found on '" + layer.name + "'." }, null, 2); }

        if (args.createController === false) {
            return JSON.stringify({ status: "success", message: "Found " + colors.length + " color(s) on '" + layer.name + "'.", colors: colors, controller: null }, null, 2);
        }

        controller = comp.layers.addNull();
        controller.name = layer.name + " Colors";
        for (var k = 0; k < colors.length; k++) {
            try {
                var fx = controller.Effects.addProperty("ADBE Color Control");
                fx.name = "Color " + (k + 1);
                var cp = null;
                try { cp = fx.property("Color"); } catch (e) {}
                if (!cp) { for (var pi = 1; pi <= fx.numProperties; pi++) { if (fx.property(pi).name === "Color") { cp = fx.property(pi); break; } } }
                if (cp) { var col = colors[k]; try { cp.setValue([col[0], col[1], col[2], 1]); } catch (e) { try { cp.setValue(col); } catch (e2) {} } }
            } catch (e) {}
        }

        return JSON.stringify({
            status: "success",
            message: "Extracted " + colors.length + " color(s) from '" + layer.name + "' into a controller null.",
            colors: colors,
            controller: { name: controller.name, index: controller.index, count: colors.length }
        }, null, 2);
    } catch (error) {
        if (controller !== null) { try { controller.remove(); } catch (e2) {} }
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}
