// footage.jsx
// CRUD for project-level FootageItem objects (imported files, solids, placeholders).
// Note: solid LAYERS are created via createSolidLayer in layers.jsx — this file
// manages the footage sources in the project panel, not the layers that reference them.
// CRUD: C ✗  R ✗  U ✗  D ✓

// D: deleteUnusedSolids — removes all solid footage items not referenced by any comp
function deleteUnusedSolids() {
    var removed = [];
    // iterate backwards so index shifts from remove() don't skip items
    for (var i = app.project.numItems; i >= 1; i--) {
        var item = app.project.item(i);
        if (item instanceof FootageItem && item.mainSource instanceof SolidSource) {
            if (item.usedIn.length === 0) {
                removed.push(item.name);
                item.remove();
            }
        }
    }
    return JSON.stringify({ status: "success", removed: removed, count: removed.length }, null, 2);
}
