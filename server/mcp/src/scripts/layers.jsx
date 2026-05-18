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

            // Type-specific fields (Item 7b)
            if (layer instanceof CameraLayer) {
                var camOpts = layer.property("Camera Options");
                layerInfo.zoom = camOpts ? camOpts.property("Zoom").value : null;
                var poi = layer.property("Point of Interest");
                layerInfo.pointOfInterest = poi ? poi.value : null;
                layerInfo.autoOrient = layer.autoOrient;
            } else if (layer instanceof LightLayer) {
                var lightOpts = layer.property("Light Options");
                layerInfo.intensity = lightOpts ? lightOpts.property("Intensity").value : null;
                layerInfo.lightColor = lightOpts ? lightOpts.property("Color").value : null;
                var lightTypeLabels = {};
                lightTypeLabels[LightType.PARALLEL] = "parallel";
                lightTypeLabels[LightType.SPOT]     = "spot";
                lightTypeLabels[LightType.POINT]    = "point";
                lightTypeLabels[LightType.AMBIENT]  = "ambient";
                layerInfo.lightType = lightTypeLabels[layer.lightType] || "unknown";
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
        var solidLayer;
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
            layer: { name: solidLayer.name, index: solidLayer.index, type: isAdjustment ? "adjustment" : "solid", inPoint: solidLayer.inPoint, outPoint: solidLayer.outPoint, position: solidLayer.property("Position").value, isAdjustment: solidLayer.adjustmentLayer }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: createCamera
function createCamera(args) {
    try {
        var comp = _resolveComp(args);
        var name = args.name || "Camera";
        var zoom = args.zoom || 1777.78; // Default ~50mm equivalent
        var position = args.position; // Optional [x, y, z]
        var pointOfInterest = args.pointOfInterest; // Optional [x, y, z]
        var oneNode = args.oneNode || false; // If true, create a one-node camera (no point of interest)

        var centerPoint = [comp.width / 2, comp.height / 2];
        var cameraLayer = comp.layers.addCamera(name, centerPoint);
        cameraLayer.property("Camera Options").property("Zoom").setValue(zoom);

        if (oneNode) {
            cameraLayer.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
        }

        if (position !== undefined && position !== null) {
            cameraLayer.property("Position").setValue(position);
        }

        if (pointOfInterest !== undefined && pointOfInterest !== null && !oneNode) {
            cameraLayer.property("Point of Interest").setValue(pointOfInterest);
        }

        var result = {
            name: cameraLayer.name,
            index: cameraLayer.index,
            zoom: cameraLayer.property("Camera Options").property("Zoom").value,
            position: cameraLayer.property("Position").value,
            oneNode: oneNode
        };
        if (!oneNode) {
            result.pointOfInterest = cameraLayer.property("Point of Interest").value;
        }

        return JSON.stringify({
            status: "success",
            message: "Camera created successfully",
            layer: result
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: createLightLayer
function createLightLayer(args) {
    try {
        var comp = _resolveComp(args);
        var name = args.name || "Light";
        var lightType = args.lightType || "point";
        var intensity = args.intensity !== undefined ? args.intensity : 100;
        var color = args.color || [1, 1, 1];
        var position = args.position;
        var startTime = args.startTime || 0;
        var duration = args.duration || 5;

        var centerPoint = [comp.width / 2, comp.height / 2];
        var lightLayer = comp.layers.addLight(name, centerPoint);
        var lightTypes = { "parallel": LightType.PARALLEL, "spot": LightType.SPOT, "point": LightType.POINT, "ambient": LightType.AMBIENT };
        if (lightTypes[lightType] !== undefined) { lightLayer.lightType = lightTypes[lightType]; }
        lightLayer.property("Light Options").property("Intensity").setValue(intensity);
        lightLayer.property("Light Options").property("Color").setValue(color);
        if (position !== undefined && position !== null) { lightLayer.property("Position").setValue(position); }
        lightLayer.startTime = startTime;
        if (duration > 0) { lightLayer.outPoint = startTime + duration; }
        return JSON.stringify({
            status: "success", message: "Light layer created successfully",
            layer: { name: lightLayer.name, index: lightLayer.index, type: "light", lightType: lightType, inPoint: lightLayer.inPoint, outPoint: lightLayer.outPoint, position: lightLayer.property("Position").value }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: createNullLayer
function createNullLayer(args) {
    try {
        var comp = _resolveComp(args);
        var name = args.name || "Null";
        var position = args.position;
        var threeDLayer = args.threeDLayer || false;
        var startTime = args.startTime || 0;
        var duration = args.duration || 5;

        var nullLayer = comp.layers.addNull();
        nullLayer.name = name;
        nullLayer.threeDLayer = !!threeDLayer;
        if (position !== undefined && position !== null) { nullLayer.property("Position").setValue(position); }
        nullLayer.startTime = startTime;
        if (duration > 0) { nullLayer.outPoint = startTime + duration; }
        return JSON.stringify({
            status: "success", message: "Null layer created successfully",
            layer: { name: nullLayer.name, index: nullLayer.index, type: "null", threeDLayer: nullLayer.threeDLayer, inPoint: nullLayer.inPoint, outPoint: nullLayer.outPoint, position: nullLayer.property("Position").value }
        }, null, 2);
    } catch (error) {
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
            duplicate: { name: newLayer.name, index: newLayer.index }
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
                if (fontFamily !== undefined && fontFamily !== null && currentTextDocument.font !== fontFamily) {
                    currentTextDocument.font = fontFamily;
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

        if (args.blendMode !== undefined && args.blendMode !== null) {
            var modes = {
                "normal": BlendingMode.NORMAL, "add": BlendingMode.ADD, "multiply": BlendingMode.MULTIPLY,
                "screen": BlendingMode.SCREEN, "overlay": BlendingMode.OVERLAY, "softLight": BlendingMode.SOFT_LIGHT,
                "hardLight": BlendingMode.HARD_LIGHT, "colorDodge": BlendingMode.COLOR_DODGE, "colorBurn": BlendingMode.COLOR_BURN,
                "darken": BlendingMode.DARKEN, "lighten": BlendingMode.LIGHTEN, "difference": BlendingMode.DIFFERENCE,
                "exclusion": BlendingMode.EXCLUSION, "hue": BlendingMode.HUE, "saturation": BlendingMode.SATURATION,
                "color": BlendingMode.COLOR, "luminosity": BlendingMode.LUMINOSITY
            };
            if (modes[args.blendMode] !== undefined) {
                layer.blendingMode = modes[args.blendMode];
                changedProperties.push("blendMode");
            }
        }

        if (args.trackMatteType !== undefined && args.trackMatteType !== null) {
            var matteTypes = {
                "none": TrackMatteType.NO_TRACK_MATTE, "alpha": TrackMatteType.ALPHA, "alphaInverted": TrackMatteType.ALPHA_INVERTED,
                "luma": TrackMatteType.LUMA, "lumaInverted": TrackMatteType.LUMA_INVERTED
            };
            if (matteTypes[args.trackMatteType] !== undefined) {
                layer.trackMatteType = matteTypes[args.trackMatteType];
                changedProperties.push("trackMatteType");
            }
        }

        if (args.threeDLayer !== undefined && args.threeDLayer !== null) { layer.threeDLayer = !!args.threeDLayer; changedProperties.push("threeDLayer"); }
        if (args.motionBlur !== undefined && args.motionBlur !== null) { layer.motionBlur = !!args.motionBlur; changedProperties.push("motionBlur"); }
        if (args.collapseTransformation !== undefined && args.collapseTransformation !== null) { layer.collapseTransformation = !!args.collapseTransformation; changedProperties.push("collapseTransformation"); }
        if (args.shy !== undefined && args.shy !== null) { layer.shy = !!args.shy; changedProperties.push("shy"); }
        if (args.solo !== undefined && args.solo !== null) { layer.solo = !!args.solo; changedProperties.push("solo"); }
        if (args.guideLayer !== undefined && args.guideLayer !== null) { layer.guideLayer = !!args.guideLayer; changedProperties.push("guideLayer"); }

        if (args.quality !== undefined && args.quality !== null) {
            var qualityMap = { "best": LayerQuality.BEST, "draft": LayerQuality.DRAFT, "wireframe": LayerQuality.WIREFRAME };
            if (qualityMap[args.quality] !== undefined) { layer.quality = qualityMap[args.quality]; changedProperties.push("quality"); }
        }

        if (args.autoOrient !== undefined && args.autoOrient !== null) {
            var orientMap = { "off": AutoOrientType.NO_AUTO_ORIENT, "alongPath": AutoOrientType.ALONG_PATH, "cameraOrPOI": AutoOrientType.CAMERA_OR_POINT_OF_INTEREST, "charactersTowardsCamera": AutoOrientType.CHARACTERS_TOWARDS_CAMERA };
            if (orientMap[args.autoOrient] !== undefined) { layer.autoOrient = orientMap[args.autoOrient]; changedProperties.push("autoOrient"); }
        }

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
            layer: returnLayerInfo
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
                var changed = [];

                if (layer instanceof TextLayer && (op.text !== undefined || op.fontFamily !== undefined || op.fontSize !== undefined || op.fillColor !== undefined)) {
                    var sourceTextProp = layer.property("Source Text");
                    if (sourceTextProp && sourceTextProp.value) {
                        var td = sourceTextProp.value;
                        var tdUpdated = false;
                        if (op.text !== undefined && op.text !== null) { td.text = op.text; changed.push("text"); tdUpdated = true; }
                        if (op.fontFamily !== undefined && op.fontFamily !== null) { td.font = op.fontFamily; changed.push("fontFamily"); tdUpdated = true; }
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

                if (op.blendMode !== undefined && op.blendMode !== null) {
                    var bModes = {"normal":BlendingMode.NORMAL,"add":BlendingMode.ADD,"multiply":BlendingMode.MULTIPLY,"screen":BlendingMode.SCREEN,"overlay":BlendingMode.OVERLAY,"softLight":BlendingMode.SOFT_LIGHT,"hardLight":BlendingMode.HARD_LIGHT,"colorDodge":BlendingMode.COLOR_DODGE,"colorBurn":BlendingMode.COLOR_BURN,"darken":BlendingMode.DARKEN,"lighten":BlendingMode.LIGHTEN,"difference":BlendingMode.DIFFERENCE,"exclusion":BlendingMode.EXCLUSION,"hue":BlendingMode.HUE,"saturation":BlendingMode.SATURATION,"color":BlendingMode.COLOR,"luminosity":BlendingMode.LUMINOSITY};
                    if (bModes[op.blendMode] !== undefined) { layer.blendingMode = bModes[op.blendMode]; changed.push("blendMode"); }
                }
                if (op.startTime !== undefined && op.startTime !== null) { layer.startTime = op.startTime; changed.push("startTime"); }
                if (op.duration !== undefined && op.duration !== null && op.duration > 0) {
                    var opStartTime = (op.startTime !== undefined && op.startTime !== null) ? op.startTime : layer.startTime;
                    layer.outPoint = opStartTime + op.duration;
                    changed.push("duration");
                }
                if (op.outPoint !== undefined && op.outPoint !== null) { layer.outPoint = op.outPoint; changed.push("outPoint"); }
                if (op.motionBlur !== undefined && op.motionBlur !== null) { layer.motionBlur = !!op.motionBlur; changed.push("motionBlur"); }
                if (op.collapseTransformation !== undefined && op.collapseTransformation !== null) { layer.collapseTransformation = !!op.collapseTransformation; changed.push("collapseTransformation"); }
                if (op.shy !== undefined && op.shy !== null) { layer.shy = !!op.shy; changed.push("shy"); }
                if (op.solo !== undefined && op.solo !== null) { layer.solo = !!op.solo; changed.push("solo"); }
                if (op.guideLayer !== undefined && op.guideLayer !== null) { layer.guideLayer = !!op.guideLayer; changed.push("guideLayer"); }
                if (op.quality !== undefined && op.quality !== null) {
                    var bQualityMap = { "best": LayerQuality.BEST, "draft": LayerQuality.DRAFT, "wireframe": LayerQuality.WIREFRAME };
                    if (bQualityMap[op.quality] !== undefined) { layer.quality = bQualityMap[op.quality]; changed.push("quality"); }
                }
                if (op.autoOrient !== undefined && op.autoOrient !== null) {
                    var bOrientMap = { "off": AutoOrientType.NO_AUTO_ORIENT, "alongPath": AutoOrientType.ALONG_PATH, "cameraOrPOI": AutoOrientType.CAMERA_OR_POINT_OF_INTEREST, "charactersTowardsCamera": AutoOrientType.CHARACTERS_TOWARDS_CAMERA };
                    if (bOrientMap[op.autoOrient] !== undefined) { layer.autoOrient = bOrientMap[op.autoOrient]; changed.push("autoOrient"); }
                }
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
                    changedProperties: changed
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

        if (args.position === "before") {
            layer.moveBefore(target);
        } else {
            layer.moveAfter(target);
        }
        return JSON.stringify({ status: "success", message: "Layer moved successfully." }, null, 2);
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

        if ((parentIndex === undefined || parentIndex === null) && !parentName) {
            layer.parent = null;
            return JSON.stringify({ status: "success", message: "Parent cleared", layer: { name: layer.name, index: layer.index, parent: null } }, null, 2);
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
        layer.parent = parentLayer;
        return JSON.stringify({
            status: "success", message: "Layer parent set successfully",
            layer: { name: layer.name, index: layer.index, parent: { name: parentLayer.name, index: parentLayer.index } }
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

// U: setSelectedLayers — select layers by index or name; deselects all others by default
function setSelectedLayers(args) {
    try {
        var comp = (args && args.compName) ? _resolveComp(args) : app.project.activeItem;
        if (!(comp instanceof CompItem)) { throw _err(ERROR_CODES.COMP_NOT_FOUND, "No active composition. Pass compName or open a comp."); }

        var clearOthers = (args.clearOthers !== false); // default true
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

        return JSON.stringify({
            status: "success",
            activeComp: { name: comp.name, id: comp.id, numLayers: comp.numLayers },
            selectedLayers: selectedLayers,
            count: selectedLayers.length
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

        if (args.startTime !== undefined && args.startTime !== null) { layer.startTime = parseFloat(args.startTime); }
        if (inPoint  !== undefined && inPoint  !== null) { layer.inPoint  = parseFloat(inPoint);  }
        if (outPoint !== undefined && outPoint !== null) { layer.outPoint = parseFloat(outPoint); }

        return JSON.stringify({
            status: "success",
            message: "Layer trimmed.",
            layer: { index: layer.index, name: layer.name, startTime: layer.startTime, inPoint: layer.inPoint, outPoint: layer.outPoint }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// U: centerAnchorPoint — move anchor to content center; adjust position so layer stays put
function centerAnchorPoint(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp = resolved.comp;
        var layer = resolved.layer;

        var preservePosition = (args.preservePosition !== false); // default true
        var overwriteKeyframes = args.overwriteKeyframes === true;

        var rect = layer.sourceRectAtTime(comp.time, false);
        var newAnchorX = rect.left + rect.width  / 2;
        var newAnchorY = rect.top  + rect.height / 2;

        var anchorProp = layer.property("Anchor Point");
        var oldAnchor  = anchorProp.value; // read at comp.time before any changes

        if (preservePosition) {
            var posProp = layer.property("Position");
            var oldPos  = posProp.value;   // read at comp.time before any changes
            var scale   = layer.property("Scale").value;
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
            message: "Anchor point centered on content.",
            layer: { index: layer.index, name: layer.name },
            anchor: anchorProp.value,
            position: layer.property("Position").value
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
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

        property.setValue(finalVal);

        return JSON.stringify({
            status: "success",
            message: "Property '" + property.name + "' updated.",
            property: { path: propertyPath, name: property.name, value: property.value }
        }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || ERROR_CODES.INTERNAL_ERROR, message: e.toString(), line: e.line }, null, 2);
    }
}
