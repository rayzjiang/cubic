// layers.jsx
// CRUD: C ✓  R ✓  U ✓  D ✓

// R: getLayerInfo
function getLayerInfo(args) {
    try {
        var project = app.project;
        var activeComp = null;

        if (args && args.compName) {
            for (var ci = 1; ci <= project.numItems; ci++) {
                var ci_item = project.item(ci);
                if (ci_item instanceof CompItem && ci_item.name === args.compName) { activeComp = ci_item; break; }
            }
            if (!activeComp) { throw new Error("No composition found with name '" + args.compName + "'"); }
        } else if (app.project.activeItem instanceof CompItem) {
            activeComp = app.project.activeItem;
        } else {
            throw new Error("compName is required — project item indices are unreliable");
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

            result.layers.push(layerInfo);
        }

        return JSON.stringify(result, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}

// C: createTextLayer
function createTextLayer(args) {
    try {
        var compName = args.compName || "";
        var text = args.text || "Text Layer";
        var position = args.position;
        var fontSize = args.fontSize || 72;
        var color = args.color || [1, 1, 1];
        var startTime = args.startTime || 0;
        var duration = args.duration || 5;
        var fontFamily = args.fontFamily || "Arial";
        var alignment = args.alignment || "center";
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }
        if (!position) { position = [comp.width / 2, comp.height / 2]; }
        var textLayer = comp.layers.addText(text);
        var textProp = textLayer.property("ADBE Text Properties").property("ADBE Text Document");
        var textDocument = textProp.value;
        textDocument.fontSize = fontSize;
        textDocument.fillColor = color;
        textDocument.font = fontFamily;
        if (alignment === "left") { textDocument.justification = ParagraphJustification.LEFT_JUSTIFY; }
        else if (alignment === "center") { textDocument.justification = ParagraphJustification.CENTER_JUSTIFY; }
        else if (alignment === "right") { textDocument.justification = ParagraphJustification.RIGHT_JUSTIFY; }
        textProp.setValue(textDocument);
        textLayer.property("Position").setValue(position);
        textLayer.startTime = startTime;
        if (duration > 0) { textLayer.outPoint = startTime + duration; }
        return JSON.stringify({
            status: "success", message: "Text layer created successfully",
            layer: { name: textLayer.name, index: textLayer.index, type: "text", inPoint: textLayer.inPoint, outPoint: textLayer.outPoint, position: textLayer.property("Position").value }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}

// C: createShapeLayer
function createShapeLayer(args) {
    try {
        var compName = args.compName || "";
        var shapeType = args.shapeType || "rectangle";
        var position = args.position;
        var size = args.size || [200, 200];
        var fillColor = args.fillColor || [1, 0, 0];
        var strokeColor = args.strokeColor || [0, 0, 0];
        var strokeWidth = args.strokeWidth || 0;
        var roundness = args.roundness || 0;
        var startTime = args.startTime || 0;
        var duration = args.duration || 5;
        var name = args.name || "Shape Layer";
        var points = args.points || 5;
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }
        if (!position) { position = [comp.width / 2, comp.height / 2]; }
        var shapeLayer = comp.layers.addShape();
        shapeLayer.name = name;
        var contents = shapeLayer.property("Contents");
        var shapeGroup = contents.addProperty("ADBE Vector Group");
        var groupContents = shapeGroup.property("Contents");
        var shapePathProperty;
        if (shapeType === "rectangle") {
            shapePathProperty = groupContents.addProperty("ADBE Vector Shape - Rect");
            shapePathProperty.property("Size").setValue(size);
            if (roundness > 0) { shapePathProperty.property("Roundness").setValue(roundness); }
        } else if (shapeType === "ellipse") {
            shapePathProperty = groupContents.addProperty("ADBE Vector Shape - Ellipse");
            shapePathProperty.property("Size").setValue(size);
        } else if (shapeType === "polygon" || shapeType === "star") {
            shapePathProperty = groupContents.addProperty("ADBE Vector Shape - Star");
            shapePathProperty.property("Type").setValue(shapeType === "polygon" ? 1 : 2);
            shapePathProperty.property("Points").setValue(points);
            shapePathProperty.property("Outer Radius").setValue(size[0] / 2);
            if (shapeType === "star") { shapePathProperty.property("Inner Radius").setValue(size[0] / 3); }
        }
        var fill = groupContents.addProperty("ADBE Vector Graphic - Fill");
        fill.property("Color").setValue(fillColor);
        fill.property("Opacity").setValue(100);
        if (strokeWidth > 0) {
            var stroke = groupContents.addProperty("ADBE Vector Graphic - Stroke");
            stroke.property("Color").setValue(strokeColor);
            stroke.property("Stroke Width").setValue(strokeWidth);
            stroke.property("Opacity").setValue(100);
        }
        shapeLayer.property("Position").setValue(position);
        shapeLayer.startTime = startTime;
        if (duration > 0) { shapeLayer.outPoint = startTime + duration; }
        return JSON.stringify({
            status: "success", message: "Shape layer created successfully",
            layer: { name: shapeLayer.name, index: shapeLayer.index, type: "shape", shapeType: shapeType, inPoint: shapeLayer.inPoint, outPoint: shapeLayer.outPoint, position: shapeLayer.property("Position").value }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}

// C: createSolidLayer
function createSolidLayer(args) {
    try {
        var compName = args.compName || "";
        var color = args.color || [1, 1, 1];
        var name = args.name || "Solid Layer";
        var position = args.position;
        var size = args.size;
        var startTime = args.startTime || 0;
        var duration = args.duration || 5;
        var isAdjustment = args.isAdjustment || false;
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }
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
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}

// C: createCamera
function createCamera(args) {
    try {
        var compName = args.compName || "";
        var name = args.name || "Camera";
        var zoom = args.zoom || 1777.78; // Default ~50mm equivalent
        var position = args.position; // Optional [x, y, z]
        var pointOfInterest = args.pointOfInterest; // Optional [x, y, z]
        var oneNode = args.oneNode || false; // If true, create a one-node camera (no point of interest)

        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }

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
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}

// C: createLightLayer
function createLightLayer(args) {
    try {
        var compName = args.compName || "";
        var name = args.name || "Light";
        var lightType = args.lightType || "point";
        var intensity = args.intensity !== undefined ? args.intensity : 100;
        var color = args.color || [1, 1, 1];
        var position = args.position;
        var startTime = args.startTime || 0;
        var duration = args.duration || 5;
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }
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
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}

// C: createNullLayer
function createNullLayer(args) {
    try {
        var compName = args.compName || "";
        var name = args.name || "Null";
        var position = args.position;
        var threeDLayer = args.threeDLayer || false;
        var startTime = args.startTime || 0;
        var duration = args.duration || 5;
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }
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
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}

// C: duplicateLayer
function duplicateLayer(args) {
    try {
        var compName = args.compName || "";
        var layerIndex = args.layerIndex;
        var layerName = args.layerName || "";
        var newName = args.newName; // optional rename

        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }

        var layer = null;
        if (layerIndex !== undefined && layerIndex !== null) {
            if (layerIndex > 0 && layerIndex <= comp.numLayers) { layer = comp.layer(layerIndex); }
            else { throw new Error("Layer index out of bounds: " + layerIndex); }
        } else if (layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found: " + (layerName || "index " + layerIndex)); }

        var newLayer = layer.duplicate();
        if (newName) { newLayer.name = newName; }

        return JSON.stringify({
            status: "success",
            message: "Layer duplicated successfully",
            original: { name: layer.name, index: layer.index },
            duplicate: { name: newLayer.name, index: newLayer.index }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}

// U: setLayerProperties
function setLayerProperties(args) {
    try {
        var compName = args.compName || "";
        var layerName = args.layerName || "";
        var layerIndex = args.layerIndex;

        // General Properties
        var position = args.position;
        var scale = args.scale;
        var rotation = args.rotation;
        var opacity = args.opacity;
        var startTime = args.startTime;
        var duration = args.duration;

        // Text Specific Properties
        var textContent = args.text;
        var fontFamily = args.fontFamily;
        var fontSize = args.fontSize;
        var fillColor = args.fillColor;

        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }

        var layer = null;
        if (layerIndex !== undefined && layerIndex !== null) {
            if (layerIndex > 0 && layerIndex <= comp.numLayers) { layer = comp.layer(layerIndex); }
            else { throw new Error("Layer index out of bounds: " + layerIndex); }
        } else if (layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found: " + (layerName || "index " + layerIndex)); }

        var changedProperties = [];
        var textDocument = null;

        // --- Text Property Handling ---
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

                if (updated) {
                    sourceTextProp.setValue(currentTextDocument);
                }
                textDocument = currentTextDocument;

            }
        }

        // --- Enabled/Visible ---
        var enabled = args.enabled;
        if (enabled !== undefined && enabled !== null) { layer.enabled = !!enabled; changedProperties.push("enabled"); }

        // --- Selected ---
        var selected = args.selected;
        if (selected !== undefined && selected !== null) { layer.selected = !!selected; changedProperties.push("selected"); }

        // --- Blend Mode ---
        var blendMode = args.blendMode;
        if (blendMode !== undefined && blendMode !== null) {
            var modes = {
                "normal": BlendingMode.NORMAL,
                "add": BlendingMode.ADD,
                "multiply": BlendingMode.MULTIPLY,
                "screen": BlendingMode.SCREEN,
                "overlay": BlendingMode.OVERLAY,
                "softLight": BlendingMode.SOFT_LIGHT,
                "hardLight": BlendingMode.HARD_LIGHT,
                "colorDodge": BlendingMode.COLOR_DODGE,
                "colorBurn": BlendingMode.COLOR_BURN,
                "darken": BlendingMode.DARKEN,
                "lighten": BlendingMode.LIGHTEN,
                "difference": BlendingMode.DIFFERENCE,
                "exclusion": BlendingMode.EXCLUSION,
                "hue": BlendingMode.HUE,
                "saturation": BlendingMode.SATURATION,
                "color": BlendingMode.COLOR,
                "luminosity": BlendingMode.LUMINOSITY
            };
            if (modes[blendMode] !== undefined) {
                layer.blendingMode = modes[blendMode];
                changedProperties.push("blendMode");
            }
        }

        // --- Track Matte ---
        var trackMatteType = args.trackMatteType;
        if (trackMatteType !== undefined && trackMatteType !== null) {
            var matteTypes = {
                "none": TrackMatteType.NO_TRACK_MATTE,
                "alpha": TrackMatteType.ALPHA,
                "alphaInverted": TrackMatteType.ALPHA_INVERTED,
                "luma": TrackMatteType.LUMA,
                "lumaInverted": TrackMatteType.LUMA_INVERTED
            };
            if (matteTypes[trackMatteType] !== undefined) {
                layer.trackMatteType = matteTypes[trackMatteType];
                changedProperties.push("trackMatteType");
            }
        }

        // --- General Property Handling ---
        var threeDLayer = args.threeDLayer;
        if (threeDLayer !== undefined && threeDLayer !== null) { layer.threeDLayer = !!threeDLayer; changedProperties.push("threeDLayer"); }

        // --- Layer Toggles (Tier 4) ---
        var motionBlur = args.motionBlur;
        if (motionBlur !== undefined && motionBlur !== null) { layer.motionBlur = !!motionBlur; changedProperties.push("motionBlur"); }

        var collapseTransformation = args.collapseTransformation;
        if (collapseTransformation !== undefined && collapseTransformation !== null) { layer.collapseTransformation = !!collapseTransformation; changedProperties.push("collapseTransformation"); }

        var shy = args.shy;
        if (shy !== undefined && shy !== null) { layer.shy = !!shy; changedProperties.push("shy"); }

        var solo = args.solo;
        if (solo !== undefined && solo !== null) { layer.solo = !!solo; changedProperties.push("solo"); }

        var guideLayer = args.guideLayer;
        if (guideLayer !== undefined && guideLayer !== null) { layer.guideLayer = !!guideLayer; changedProperties.push("guideLayer"); }

        var quality = args.quality;
        if (quality !== undefined && quality !== null) {
            var qualityMap = { "best": LayerQuality.BEST, "draft": LayerQuality.DRAFT, "wireframe": LayerQuality.WIREFRAME };
            if (qualityMap[quality] !== undefined) { layer.quality = qualityMap[quality]; changedProperties.push("quality"); }
        }

        var autoOrient = args.autoOrient;
        if (autoOrient !== undefined && autoOrient !== null) {
            var orientMap = { "off": AutoOrientType.NO_AUTO_ORIENT, "alongPath": AutoOrientType.ALONG_PATH, "cameraOrPOI": AutoOrientType.CAMERA_OR_POINT_OF_INTEREST, "charactersTowardsCamera": AutoOrientType.CHARACTERS_TOWARDS_CAMERA };
            if (orientMap[autoOrient] !== undefined) { layer.autoOrient = orientMap[autoOrient]; changedProperties.push("autoOrient"); }
        }

        var label = args.label;
        if (label !== undefined && label !== null) { layer.label = label; changedProperties.push("label"); }

        var comment = args.comment;
        if (comment !== undefined && comment !== null) { layer.comment = comment; changedProperties.push("comment"); }

        if (position !== undefined && position !== null) {
            var posProp = layer.property("Position");
            if (posProp.numKeys > 0) { throw new Error("position has keyframes — use setLayerKeyframe instead"); }
            posProp.setValue(position);
            changedProperties.push("position");
        }
        if (scale !== undefined && scale !== null) { layer.property("Scale").setValue(scale); changedProperties.push("scale"); }
        if (rotation !== undefined && rotation !== null) {
            if (layer.threeDLayer) {
                layer.property("Z Rotation").setValue(rotation);
            } else {
                layer.property("Rotation").setValue(rotation);
            }
            changedProperties.push("rotation");
        }
        if (opacity !== undefined && opacity !== null) { layer.property("Opacity").setValue(opacity); changedProperties.push("opacity"); }
        if (startTime !== undefined && startTime !== null) { layer.startTime = startTime; changedProperties.push("startTime"); }
        if (duration !== undefined && duration !== null && duration > 0) {
            var actualStartTime = (startTime !== undefined && startTime !== null) ? startTime : layer.startTime;
            layer.outPoint = actualStartTime + duration;
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
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}

// U: batchSetLayerProperties
function batchSetLayerProperties(args) {
    try {
        var compName = args.compName || "";
        var operations = args.operations; // Array of {layerIndex, threeDLayer, position, scale, rotation, opacity, ...}

        if (!operations || !operations.length) {
            throw new Error("No operations provided. Pass an array of {layerIndex, ...properties}");
        }

        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }

        var results = [];
        for (var o = 0; o < operations.length; o++) {
            var op = operations[o];
            var layer = null;
            if (op.layerIndex !== undefined && op.layerIndex !== null) {
                if (op.layerIndex > 0 && op.layerIndex <= comp.numLayers) { layer = comp.layer(op.layerIndex); }
                else { results.push({ layerIndex: op.layerIndex, status: "error", message: "Layer index out of bounds" }); continue; }
            } else if (op.layerName) {
                for (var j = 1; j <= comp.numLayers; j++) {
                    if (comp.layer(j).name === op.layerName) { layer = comp.layer(j); break; }
                }
            }
            if (!layer) { results.push({ layerIndex: op.layerIndex, layerName: op.layerName, status: "error", message: "Layer not found" }); continue; }

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
                if (posProp.numKeys > 0) {
                    while (posProp.numKeys > 0) { posProp.removeKey(1); }
                }
                posProp.setValue(op.position);
                changed.push("position");
            }
            if (op.scale !== undefined && op.scale !== null) { layer.property("Scale").setValue(op.scale); changed.push("scale"); }
            if (op.rotation !== undefined && op.rotation !== null) {
                if (layer.threeDLayer) { layer.property("Z Rotation").setValue(op.rotation); }
                else { layer.property("Rotation").setValue(op.rotation); }
                changed.push("rotation");
            }
            if (op.opacity !== undefined && op.opacity !== null) { layer.property("Opacity").setValue(op.opacity); changed.push("opacity"); }
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
                changedProperties: changed
            });
        }

        return JSON.stringify({ status: "success", results: results }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}

// U: moveLayer
function moveLayer(args) {
    try {
        var compName = args.compName || "";
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }

        var layer = null;
        if (args.layerIndex !== undefined && args.layerIndex !== null) {
            if (args.layerIndex > 0 && args.layerIndex <= comp.numLayers) { layer = comp.layer(args.layerIndex); }
            else { throw new Error("Layer index out of bounds: " + args.layerIndex); }
        } else if (args.layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === args.layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found: " + (args.layerName || "index " + args.layerIndex)); }

        var target = null;
        if (args.targetIndex !== undefined && args.targetIndex !== null) {
            if (args.targetIndex > 0 && args.targetIndex <= comp.numLayers) { target = comp.layer(args.targetIndex); }
            else { throw new Error("Target layer index out of bounds: " + args.targetIndex); }
        } else if (args.targetName) {
            for (var k = 1; k <= comp.numLayers; k++) {
                if (comp.layer(k).name === args.targetName) { target = comp.layer(k); break; }
            }
        }
        if (!target) { throw new Error("Target layer not found: " + (args.targetName || "index " + args.targetIndex)); }

        if (args.position === "before") {
            layer.moveBefore(target);
        } else {
            layer.moveAfter(target);
        }
        return JSON.stringify({ status: "success", message: "Layer moved successfully." });
    } catch (e) {
        return JSON.stringify({ status: "error", errorCode: e.code || "INTERNAL_ERROR", message: e.toString(), line: e.line });
    }
}

// U: setLayerParent
function setLayerParent(args) {
    try {
        var compName = args.compName || "";
        var layerIndex = args.layerIndex;
        var layerName = args.layerName || "";
        var parentIndex = args.parentIndex;
        var parentName = args.parentName || "";
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }
        var layer = null;
        if (layerIndex !== undefined && layerIndex !== null) {
            if (layerIndex > 0 && layerIndex <= comp.numLayers) { layer = comp.layer(layerIndex); }
            else { throw new Error("Layer index out of bounds: " + layerIndex); }
        } else if (layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found: " + (layerName || "index " + layerIndex)); }
        if ((parentIndex === undefined || parentIndex === null) && !parentName) {
            layer.parent = null;
            return JSON.stringify({ status: "success", message: "Parent cleared", layer: { name: layer.name, index: layer.index, parent: null } }, null, 2);
        }
        var parentLayer = null;
        if (parentIndex !== undefined && parentIndex !== null) {
            if (parentIndex > 0 && parentIndex <= comp.numLayers) { parentLayer = comp.layer(parentIndex); }
            else { throw new Error("Parent layer index out of bounds: " + parentIndex); }
        } else if (parentName) {
            for (var k = 1; k <= comp.numLayers; k++) {
                if (comp.layer(k).name === parentName) { parentLayer = comp.layer(k); break; }
            }
        }
        if (!parentLayer) { throw new Error("Parent layer not found: " + (parentName || "index " + parentIndex)); }
        if (parentLayer.index === layer.index) { throw new Error("A layer cannot be its own parent"); }
        layer.parent = parentLayer;
        return JSON.stringify({
            status: "success", message: "Layer parent set successfully",
            layer: { name: layer.name, index: layer.index, parent: { name: parentLayer.name, index: parentLayer.index } }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}

// R: getSelectedLayers — returns layers the user has highlighted in the AE timeline
// Accepts optional compName to target a specific comp (useful for tests/scripts).
// Without compName, falls back to app.project.activeItem (the live user-context case).
function getSelectedLayers(args) {
    try {
        var activeItem = null;
        if (args && args.compName) {
            for (var ci = 1; ci <= app.project.numItems; ci++) {
                var ci_it = app.project.item(ci);
                if (ci_it instanceof CompItem && ci_it.name === args.compName) { activeItem = ci_it; break; }
            }
            if (!activeItem) { throw new Error("No composition '" + args.compName + "'"); }
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
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
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
            return JSON.stringify({ status: "error", message: "Unknown layer type: '" + type + "'. Use: text, shape, solid, adjustment, null, camera, light." }, null, 2);
    }
}

// C: precompose — group layers into a nested sub-comp
function precompose(args) {
    try {
        var compName = args.compName || "";
        var layerIndices = args.layerIndices;
        var newCompName = args.newCompName || "Precomp";
        var moveAttributes = (args.moveAttributes !== false);
        var openNewComp = args.openNewComp === true;

        if (!layerIndices || typeof layerIndices.length === "undefined" || layerIndices.length === 0) {
            throw new Error("layerIndices must be a non-empty array.");
        }

        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }

        for (var k = 0; k < layerIndices.length; k++) {
            if (layerIndices[k] < 1 || layerIndices[k] > comp.numLayers) {
                throw new Error("Layer index out of bounds: " + layerIndices[k]);
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
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
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
            throw new Error("Invalid matteType '" + matteType + "'. Use: none, alpha, alphaInverted, luma, lumaInverted.");
        }

        var matteLayerIndex = args.matteLayerIndex;
        var matteLayerName = args.matteLayerName;
        var mattingLayer = null;

        if (matteLayerIndex !== undefined && matteLayerIndex !== null) {
            if (matteLayerIndex < 1 || matteLayerIndex > comp.numLayers) {
                throw new Error("matteLayerIndex out of bounds: " + matteLayerIndex);
            }
            mattingLayer = comp.layer(matteLayerIndex);
        } else if (matteLayerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === matteLayerName) { mattingLayer = comp.layer(j); break; }
            }
            if (!mattingLayer) { throw new Error("Matte layer not found: " + matteLayerName); }
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
            layer: { index: layer.index, name: layer.name, trackMatteType: matteType, matteLayerIndex: mattingLayer ? mattingLayer.index : null }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}

// C: addShapeOperator — add Trim Paths / Repeater / Rounded Corners to a shape layer's Contents group
function addShapeOperator(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var type = args.type;
        var matchNames = {
            "trimPaths":      "ADBE Vector Filter - Trim",
            "repeater":       "ADBE Vector Filter - Repeater",
            "roundedCorners": "ADBE Vector Filter - RC",
            "gradientFill":   "ADBE Vector Graphic - G-Fill",
            "gradientStroke": "ADBE Vector Graphic - G-Stroke"
        };

        if (!matchNames[type]) {
            throw new Error("Invalid operator type '" + type + "'. Use: trimPaths, repeater, roundedCorners.");
        }

        var groupContents;
        var groupPath = args.groupPath;
        if (groupPath && groupPath.length > 0) {
            var targetGroup = _resolvePropertyByPath(layer, groupPath);
            var inner = targetGroup.property("Contents");
            groupContents = inner || targetGroup;
        } else {
            var contents = layer.property("Contents");
            if (!contents) { throw new Error("Layer has no Contents group — is it a shape layer?"); }
            var firstGroup = contents.property(1);
            if (!firstGroup) { throw new Error("Contents group is empty."); }
            var firstContents = firstGroup.property("Contents");
            groupContents = firstContents || firstGroup;
        }

        var operator = groupContents.addProperty(matchNames[type]);

        var settings = args.settings;
        if (settings) {
            for (var propName in settings) {
                if (settings.hasOwnProperty(propName)) {
                    try {
                        var prop = null;
                        try { prop = operator.property(propName); } catch(e) {}
                        if (!prop) {
                            for (var pi = 1; pi <= operator.numProperties; pi++) {
                                if (operator.property(pi).name === propName) { prop = operator.property(pi); break; }
                            }
                        }
                        if (prop) {
                            var v = settings[propName];
                            if (typeof v === "string") { try { v = eval("(" + v + ")"); } catch(e) {} }
                            prop.setValue(v);
                        }
                    } catch(e2) {}
                }
            }
        }

        var opProps = [];
        for (var oi = 1; oi <= operator.numProperties; oi++) {
            try { opProps.push({ name: operator.property(oi).name, value: operator.property(oi).value }); } catch(e3) {}
        }

        return JSON.stringify({
            status: "success",
            message: "Shape operator '" + type + "' added to layer '" + layer.name + "'.",
            operator: { type: type, name: operator.name, matchName: matchNames[type], properties: opProps }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}

// U: setShapeOperatorProperty — update a property on an existing shape operator
function setShapeOperatorProperty(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var operatorPath = args.operatorPath;
        var propertyName = args.propertyName;
        var value = args.value;

        if (!operatorPath || operatorPath.length === 0) { throw new Error("operatorPath must be a non-empty array."); }
        if (!propertyName) { throw new Error("propertyName is required."); }

        var operator = _resolvePropertyByPath(layer, operatorPath);

        var prop = null;
        try { prop = operator.property(propertyName); } catch(e) {}
        if (!prop) {
            for (var pi = 1; pi <= operator.numProperties; pi++) {
                if (operator.property(pi).name === propertyName) { prop = operator.property(pi); break; }
            }
        }
        if (!prop) { throw new Error("Property '" + propertyName + "' not found on operator."); }

        if (typeof value === "string") { try { value = eval("(" + value + ")"); } catch(e) {} }
        prop.setValue(value);

        return JSON.stringify({
            status: "success",
            message: "Shape operator property '" + propertyName + "' set.",
            operator: { path: operatorPath },
            property: { name: prop.name, value: prop.value }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}

// C: addTextAnimator — add a text animator with one or more animated properties
function addTextAnimator(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var textProp = layer.property("Text");
        if (!textProp) { throw new Error("Layer '" + layer.name + "' is not a text layer."); }

        var animators = textProp.property("Animators");
        if (!animators) { throw new Error("Text layer has no Animators group."); }

        var properties = args.properties;
        if (!properties || typeof properties.length === "undefined" || properties.length === 0) {
            throw new Error("properties must be a non-empty array of property names.");
        }

        var animator = animators.addProperty("ADBE Text Animator");
        if (args.name) { animator.name = args.name; }

        // AE's UI auto-creates Range Selector 1 when adding an animator; scripting doesn't.
        try {
            var selectorsGroup = animator.property("ADBE Text Selectors");
            if (selectorsGroup && selectorsGroup.numProperties === 0) {
                selectorsGroup.addProperty("ADBE Text Selector");
            }
        } catch (selErr) {}

        var propMatchNames = {
            "Position":        "ADBE Text Position 3D",
            "Scale":           "ADBE Text Scale 3D",
            "Skew":            "ADBE Text Skew",
            "Rotation":        "ADBE Text Rotation",
            "Opacity":         "ADBE Text Opacity",
            "Fill Color":      "ADBE Text Fill Color",
            "Stroke Color":    "ADBE Text Stroke Color",
            "Tracking Amount": "ADBE Text Tracking Amount",
            "Character Offset":"ADBE Text Character Offset",
            "Line Anchor":     "ADBE Text Line Anchor",
            "Line Spacing":    "ADBE Text Line Spacing"
        };

        var animatorProps = animator.property("ADBE Text Animator Properties");
        var addedProperties = [];

        for (var i = 0; i < properties.length; i++) {
            var propName = properties[i];
            var matchName = propMatchNames[propName] || propName;
            try {
                var addedProp = animatorProps.addProperty(matchName);
                addedProperties.push({ name: propName, matchName: matchName });

                if (args.initialValues && args.initialValues[propName] !== undefined) {
                    var initVal = args.initialValues[propName];
                    if (typeof initVal === "string") { try { initVal = eval("(" + initVal + ")"); } catch(e) {} }
                    var curVal = addedProp.value;
                    var finalVal;
                    if (typeof curVal === "object" && typeof curVal.length === "number" && curVal.length >= 1) {
                        finalVal = [];
                        for (var vi = 0; vi < curVal.length; vi++) {
                            finalVal[vi] = (initVal[vi] !== undefined) ? +initVal[vi] : +curVal[vi];
                        }
                    } else {
                        finalVal = +initVal;
                    }
                    addedProp.setValue(finalVal);
                }
            } catch(propErr) {
                addedProperties.push({ name: propName, matchName: matchName, error: propErr.toString() });
            }
        }

        var animatorIndex = animators.numProperties;

        return JSON.stringify({
            status: "success",
            message: "Text animator '" + animator.name + "' added to layer '" + layer.name + "'.",
            animator: {
                index: animatorIndex,
                name: animator.name,
                propertyPath: ["Text", "Animators", animator.name],
                properties: addedProperties
            }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}

// U: setTextAnimatorProperty — update an animated property value on a text animator
function setTextAnimatorProperty(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var animatorIndex = args.animatorIndex;
        var propertyName = args.propertyName;
        var value = args.value;

        if (!animatorIndex) { throw new Error("animatorIndex is required."); }
        if (!propertyName)  { throw new Error("propertyName is required."); }

        var textProp = layer.property("Text");
        if (!textProp) { throw new Error("Layer is not a text layer."); }

        var animators = textProp.property("Animators");
        if (animatorIndex > animators.numProperties) {
            throw new Error("animatorIndex " + animatorIndex + " out of bounds (" + animators.numProperties + " animators).");
        }

        var animator = animators.property(animatorIndex);
        var animatorProps = animator.property("ADBE Text Animator Properties");

        var prop = null;
        try { prop = animatorProps.property(propertyName); } catch(e) {}
        if (!prop) {
            for (var pi = 1; pi <= animatorProps.numProperties; pi++) {
                if (animatorProps.property(pi).name === propertyName) { prop = animatorProps.property(pi); break; }
            }
        }
        if (!prop) { throw new Error("Property '" + propertyName + "' not found on animator " + animatorIndex + "."); }

        if (typeof value === "string") { try { value = eval("(" + value + ")"); } catch(e) {} }
        var curVal = prop.value;
        var finalVal;
        if (typeof curVal === "object" && typeof curVal.length === "number" && curVal.length >= 1) {
            finalVal = [];
            for (var vi = 0; vi < curVal.length; vi++) {
                finalVal[vi] = (value[vi] !== undefined) ? +value[vi] : +curVal[vi];
            }
        } else {
            finalVal = +value;
        }
        prop.setValue(finalVal);

        return JSON.stringify({
            status: "success",
            message: "Text animator property '" + propertyName + "' set.",
            animator: { index: animatorIndex, name: animator.name },
            property: { name: prop.name, value: prop.value }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}

// U: setTextAnimatorRangeSelector — configure the Range Selector on a text animator
function setTextAnimatorRangeSelector(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var layer = resolved.layer;

        var animatorIndex = args.animatorIndex;
        var rangeSelectorIndex = args.rangeSelectorIndex || 1;

        if (!animatorIndex) { throw new Error("animatorIndex is required."); }

        var textProp = layer.property("Text");
        if (!textProp) { throw new Error("Layer is not a text layer."); }

        var animators = textProp.property("Animators");
        if (animatorIndex > animators.numProperties) { throw new Error("animatorIndex out of bounds."); }

        var animator = animators.property(animatorIndex);
        var selectors = animator.property("ADBE Text Selectors");
        if (rangeSelectorIndex > selectors.numProperties) {
            throw new Error("rangeSelectorIndex " + rangeSelectorIndex + " out of bounds (" + selectors.numProperties + " selectors).");
        }

        var selector = selectors.property(rangeSelectorIndex);
        var changed = [];

        if (args.start !== undefined)  { selector.property("Start").setValue(args.start);   changed.push("start");  }
        if (args.end !== undefined)    { selector.property("End").setValue(args.end);         changed.push("end");    }
        if (args.offset !== undefined) { selector.property("Offset").setValue(args.offset); changed.push("offset"); }

        var advanced = null;
        try { advanced = selector.property("ADBE Text Range Advanced"); } catch(e) {}
        if (advanced) {
            if (args.units !== undefined) {
                var unitMap = { "percentage": 1, "index": 2 };
                if (unitMap[args.units] !== undefined) {
                    advanced.property("ADBE Text Range Units").setValue(unitMap[args.units]);
                    changed.push("units");
                }
            }
            if (args.basedOn !== undefined) {
                var basedOnMap = { "characters": 1, "charactersExcludingSpaces": 2, "words": 3, "lines": 4 };
                if (basedOnMap[args.basedOn] !== undefined) {
                    // AE uses "ADBE Text Selector Based On" (not "Range") — inconsistent naming; scan by display name as fallback.
                    var basedOnProp = null;
                    try { basedOnProp = advanced.property("ADBE Text Selector Based On"); } catch(e) {}
                    if (!basedOnProp) { try { basedOnProp = advanced.property("ADBE Text Range Based On"); } catch(e) {} }
                    if (!basedOnProp) {
                        for (var bi = 1; bi <= advanced.numProperties; bi++) {
                            try { if (advanced.property(bi).name === "Based On") { basedOnProp = advanced.property(bi); break; } } catch(e) {}
                        }
                    }
                    if (basedOnProp) { basedOnProp.setValue(basedOnMap[args.basedOn]); changed.push("basedOn"); }
                }
            }
            if (args.shape !== undefined) {
                var shapeMap = { "square": 1, "rampUp": 2, "rampDown": 3, "triangle": 4, "round": 5, "smooth": 6 };
                if (shapeMap[args.shape] !== undefined) {
                    advanced.property("ADBE Text Range Shape").setValue(shapeMap[args.shape]);
                    changed.push("shape");
                }
            }
        }

        return JSON.stringify({
            status: "success",
            message: "Range selector updated: " + (changed.length ? changed.join(", ") : "no fields changed") + ".",
            animator: { index: animatorIndex, name: animator.name },
            selector: {
                index: rangeSelectorIndex,
                name: selector.name,
                start: selector.property("Start").value,
                end: selector.property("End").value,
                offset: selector.property("Offset").value
            }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
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
            throw new Error("Split time " + time + "s is outside the layer's active range [" + layer.inPoint + ", " + layer.outPoint + "]");
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
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
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
            throw new Error("inPoint (" + newIn + ") must be less than outPoint (" + newOut + ")");
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
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}

// U: setSelectedLayers — select layers by index or name; deselects all others by default
function setSelectedLayers(args) {
    try {
        var compName = (args && args.compName) ? args.compName : "";
        var comp = null;
        if (compName) {
            for (var ci = 1; ci <= app.project.numItems; ci++) {
                var ci_it = app.project.item(ci);
                if (ci_it instanceof CompItem && ci_it.name === compName) { comp = ci_it; break; }
            }
            if (!comp) { throw new Error("No composition '" + compName + "'"); }
        } else {
            comp = app.project.activeItem;
        }
        if (!(comp instanceof CompItem)) { throw new Error("No active composition. Pass compName or open a comp."); }

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
                if (idx < 1 || idx > comp.numLayers) { throw new Error("Layer index out of bounds: " + idx); }
                comp.layer(idx).selected = true;
            }
        } else if (layerNames && layerNames.length > 0) {
            for (var ni = 0; ni < layerNames.length; ni++) {
                var nm = layerNames[ni];
                var found = false;
                for (var li = 1; li <= comp.numLayers; li++) {
                    if (comp.layer(li).name === nm) { comp.layer(li).selected = true; found = true; break; }
                }
                if (!found) { throw new Error("Layer not found: '" + nm + "'"); }
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
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}

// U: centerAnchorPoint — move anchor to content center; adjust position so layer stays put
function centerAnchorPoint(args) {
    try {
        var resolved = _resolveCompAndLayer(args);
        var comp = resolved.comp;
        var layer = resolved.layer;

        var preservePosition = (args.preservePosition !== false); // default true

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

            // Clear keyframes first (matches setLayerProperties pattern)
            if (anchorProp.numKeys > 0) { while (anchorProp.numKeys > 0) { anchorProp.removeKey(1); } }
            anchorProp.setValue([newAnchorX, newAnchorY]);

            if (posProp.numKeys > 0) { while (posProp.numKeys > 0) { posProp.removeKey(1); } }
            if (layer.threeDLayer) {
                posProp.setValue([oldPos[0] + deltaX, oldPos[1] + deltaY, oldPos[2]]);
            } else {
                posProp.setValue([oldPos[0] + deltaX, oldPos[1] + deltaY]);
            }
        } else {
            if (anchorProp.numKeys > 0) { while (anchorProp.numKeys > 0) { anchorProp.removeKey(1); } }
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
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}

// D: deleteLayer
function deleteLayer(args) {
    try {
        var compName = args.compName || "";
        var layerIndex = args.layerIndex;
        var layerName = args.layerName || "";

        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }

        var layer = null;
        if (layerIndex !== undefined && layerIndex !== null) {
            if (layerIndex > 0 && layerIndex <= comp.numLayers) { layer = comp.layer(layerIndex); }
            else { throw new Error("Layer index out of bounds: " + layerIndex); }
        } else if (layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found: " + (layerName || "index " + layerIndex)); }

        var deletedName = layer.name;
        var deletedIndex = layer.index;
        layer.remove();

        return JSON.stringify({
            status: "success",
            message: "Layer deleted successfully",
            deleted: { name: deletedName, index: deletedIndex }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || "INTERNAL_ERROR", message: error.toString(), line: error.line }, null, 2);
    }
}
