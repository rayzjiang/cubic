// project.jsx
// CRUD: C –  R ✓  U ✓ (saveProject writes to disk)  D –


// R: getProjectPath — return project file path + dirty flag
function getProjectPath() {
    try {
        var project = app.project;
        return JSON.stringify({
            status: "success",
            path:  project.file ? project.file.fsName : null,
            name:  project.file ? project.file.name   : null,
            dirty: project.dirty
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// U: saveProject — save the current project; pass saveAs (fsName) to save as a new file
function saveProject(args) {
    try {
        var project = app.project;
        var saveAsPath = (args && args.saveAs) ? args.saveAs : null;

        if (saveAsPath) {
            project.save(new File(saveAsPath));
        } else {
            if (!project.file) {
                throw new Error("Project has never been saved. Pass saveAs with an absolute file path (e.g. '/Users/you/my-project.aep').");
            }
            project.save();
        }

        return JSON.stringify({
            status: "success",
            message: "Project saved.",
            path: project.file ? project.file.fsName : null,
            name: project.file ? project.file.name   : null
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}
