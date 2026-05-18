// shapes.jsx
// Shape layers + vector operators (Trim Paths, Repeater, Rounded Corners, gradients).
// CRUD: C ✓  R via getLayerInfo/getLayerProperty  U ✓  D via deleteLayer

// NOTE: ADBE Vector Grad Colors (gradient color stops on shape operators) is NOT scriptable
// in AE 2026. PropertyValueType.NO_VALUE blocks all approaches: setValue, setValueAtTime,
// GradientColor constructor — all throw from AE's C++ layer. No workaround exists within
// ExtendScript. For controllable gradient colors use applyEffect("ADBE Ramp") + setEffectProperty.

// C: createShapeLayer
function createShapeLayer(args) {
    try {
        var comp = _resolveComp(args);
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
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}

// C: addShapeOperator — add Trim Paths / Repeater / Rounded Corners / gradient to a shape layer's Contents
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
            throw _err(ERROR_CODES.INVALID_ARGS, "Invalid operator type '" + type + "'. Use: trimPaths, repeater, roundedCorners, gradientFill, gradientStroke.");
        }

        var groupContents;
        var groupPath = args.groupPath;
        if (groupPath && groupPath.length > 0) {
            var targetGroup = _resolvePropertyByPath(layer, groupPath);
            var inner = targetGroup.property("Contents");
            groupContents = inner || targetGroup;
        } else {
            var contents = layer.property("Contents");
            if (!contents) { throw _err(ERROR_CODES.PROPERTY_NOT_FOUND, "Layer has no Contents group — is it a shape layer?"); }
            var firstGroup = contents.property(1);
            if (!firstGroup) { throw _err(ERROR_CODES.PROPERTY_NOT_FOUND, "Contents group is empty."); }
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

        // Gradient color stops (args.colors) are not scriptable in AE 2026 — see file header NOTE.

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
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
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

        if (!operatorPath || operatorPath.length === 0) { throw _err(ERROR_CODES.INVALID_ARGS, "operatorPath must be a non-empty array."); }
        if (!propertyName) { throw _err(ERROR_CODES.INVALID_ARGS, "propertyName is required."); }

        var operator = _resolvePropertyByPath(layer, operatorPath);

        var prop = null;
        try { prop = operator.property(propertyName); } catch(e) {}
        if (!prop) {
            for (var pi = 1; pi <= operator.numProperties; pi++) {
                if (operator.property(pi).name === propertyName) { prop = operator.property(pi); break; }
            }
        }
        if (!prop) { throw _err(ERROR_CODES.PROPERTY_NOT_FOUND, "Property '" + propertyName + "' not found on operator."); }

        if (typeof value === "string") { try { value = eval("(" + value + ")"); } catch(e) {} }
        var previousValue = null;
        try { previousValue = prop.value; } catch(e) {}
        prop.setValue(value);

        return JSON.stringify({
            status: "success",
            message: "Shape operator property '" + propertyName + "' set.",
            operator: { path: operatorPath },
            property: { name: prop.name, value: prop.value },
            previousValue: previousValue
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", errorCode: error.code || ERROR_CODES.INTERNAL_ERROR, message: error.toString(), line: error.line }, null, 2);
    }
}
