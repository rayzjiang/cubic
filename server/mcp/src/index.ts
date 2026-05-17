import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { z } from "zod";
import { bridge } from "./bridge/wsBridge.js";

const server = new McpServer({
  name: "AfterEffectsServer",
  version: "2.0.0"
});

const AE_MCP_PORT = parseInt(process.env.AE_MCP_PORT ?? "17923", 10);


// ============================================================
// RESOURCE
// ============================================================

server.registerResource(
  "compositions",
  "aftereffects://compositions",
  {},
  async (uri) => {
    try {
      const result = await bridge.sendCommand("listCompositions", {}, 10000);
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: result
        }]
      };
    } catch (e) {
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ error: String(e) })
        }]
      };
    }
  }
);


// ============================================================
// PROMPTS
// ============================================================

server.registerPrompt(
  "listCompositions",
  { description: "List compositions in the current After Effects project" },
  () => ({
    messages: [{
      role: "user",
      content: { type: "text", text: "Please list all compositions in the current After Effects project." }
    }]
  })
);

server.registerPrompt(
  "analyzeComposition",
  {
    argsSchema: {
      compositionName: z.string().describe("Name of the composition to analyze")
    }
  },
  (args) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Please analyze the composition named "${args.compositionName}" in the current After Effects project. Provide details about its duration, frame rate, resolution, and layers.`
      }
    }]
  })
);

server.registerPrompt(
  "createComposition",
  { description: "Create a new composition with specified settings" },
  () => ({
    messages: [{
      role: "user",
      content: { type: "text", text: "Please create a new composition with custom settings. You can specify parameters like name, width, height, frame rate, etc." }
    }]
  })
);


// ============================================================
// TOOLS — shared schemas
// ============================================================

const LayerIdentifierSchema = {
  compName: z.string().describe("Name of the target composition."),
  layerIndex: z.number().int().positive().describe("1-based index of the target layer within the composition.")
};

const KeyframeValueSchema = z.unknown().describe("The value for the keyframe (e.g., [x,y] for Position, [w,h] for Scale, angle for Rotation, percentage for Opacity)");


// ============================================================
// TOOLS — general
// ============================================================

server.registerTool(
  "runScript",
  {
    description: "Run a script command in After Effects via the UXP bridge. Results are returned synchronously.",
    inputSchema: {
      script: z.string().describe("Name of the bridge command to run"),
      parameters: z.record(z.string(), z.unknown()).optional().describe("Optional parameters for the command")
    }
  },
  async ({ script, parameters = {} }) => {
    const allowedScripts = [
      "listCompositions",
      "getProjectInfo",
      "getLayerInfo",
      "createComposition",
      "createTextLayer",
      "createShapeLayer",
      "createSolidLayer",
      "setLayerProperties",
      "setLayerKeyframe",
      "setLayerExpression",
      "getLayerEffects",
      "applyEffect",
      "applyEffectTemplate",
      "setEffectProperty",
      "deleteEffect",
      "createCamera",
      "createLightLayer",
      "createNullLayer",
      "setLayerParent",
      "batchSetLayerProperties",
      "setCompositionProperties",
      "deleteComposition",
      "deleteUnusedSolids",
      "duplicateLayer",
      "deleteLayer",
      "getLayerMasks",
      "setLayerMask",
      "deleteLayerMask",
      "moveLayer",
      "setKeyframeEasing",
      "getLayerExpressions",
      "getLayerKeyframes",
      "removePropertyKeyframes",
      "batch",
      "getSelectedLayers",
      "listProjectItems",
      "importFootage",
      "addFootageToComp",
      "deleteProjectItem",
      "undoAction"
    ];

    if (!allowedScripts.includes(script)) {
      return {
        content: [{ type: "text", text: `Error: "${script}" is not an allowed command. Allowed: ${allowedScripts.join(", ")}` }],
        isError: true
      };
    }

    try {
      const timeoutMs = script === "batch" ? 30000 : 10000;
      const result = await bridge.sendCommand(script, parameters, timeoutMs);
      return { content: [{ type: "text", text: result }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${String(e)}` }], isError: true };
    }
  }
);

server.registerTool(
  "getResults",
  {
    description: "[DEPRECATED] Results are now returned synchronously by each tool. Returns the last cached result for backwards compatibility."
  },
  async () => ({
    content: [{ type: "text", text: bridge.lastResult || JSON.stringify({ status: "no_result", message: "No result cached yet. Tools now return results directly." }) }]
  })
);

server.registerTool(
  "getHelp",
  { description: "Get help and available commands for the After Effects MCP integration" },
  async () => ({
    content: [{
      type: "text",
      text: `# After Effects MCP Integration (UXP WebSocket Bridge)

## Workflow
1. Run \`npm start\` to start the MCP server (hosts WS bridge on 127.0.0.1:${AE_MCP_PORT}).
2. Open After Effects and open the **MCP Bridge** CEP panel (Window → Extensions → MCP Bridge).
3. Call any tool — results are returned synchronously, no \`getResults\` needed.
4. Use \`runScript\` with \`batch\` to run multiple commands in one call.

## Available Commands (via runScript or dedicated tools)

**Compositions:** getProjectInfo, listCompositions, createComposition, setCompositionProperties, deleteComposition
**Project:** undoAction — undo the most recent N actions (1–20); use in the self-healing retry loop
**Layers:** getLayerInfo, getSelectedLayers, createTextLayer, createShapeLayer, createSolidLayer, createCamera, createLightLayer, createNullLayer, duplicateLayer, setLayerProperties, batchSetLayerProperties, setLayerParent, moveLayer, deleteLayer
**Keyframes:** getLayerKeyframes, setLayerKeyframe, setKeyframeEasing, removePropertyKeyframes
**Expressions:** getLayerExpressions, setLayerExpression
**Masks:** getLayerMasks, setLayerMask, deleteLayerMask
**Effects:** getLayerEffects, applyEffect, applyEffectTemplate, setEffectProperty, deleteEffect
**Footage / Project Panel:** listProjectItems, importFootage, addFootageToComp, deleteProjectItem, deleteUnusedSolids
**Batch:** batch — run multiple commands in one call (strongly preferred for multiple operations)

## Context tip
Call getSelectedLayers at the start of each interactive turn — it returns the layers the user has highlighted in the AE timeline (like highlighted code in VSCode). Use this as the primary targeting signal before falling back to prompts.

## Effect Templates
gaussian-blur, directional-blur, color-balance, brightness-contrast, curves, glow, drop-shadow, cinematic-look, text-pop

## Common Effect Match Names
- Gaussian Blur: "ADBE Gaussian Blur 2"
- Directional Blur: "ADBE Directional Blur"
- Brightness & Contrast: "ADBE Brightness & Contrast 2"
- Curves: "ADBE CurvesCustom"
- Glow: "ADBE Glow"
- Drop Shadow: "ADBE Drop Shadow"
- Hue/Saturation: "ADBE HUE SATURATION"
- Vibrance: "ADBE Vibrance"
`
    }]
  })
);

server.registerTool(
  "runBridgeTest",
  { description: "Run the bridge test to verify MCP ↔ After Effects communication" },
  async () => {
    try {
      const result = await bridge.sendCommand("getProjectInfo", {}, 10000);
      return { content: [{ type: "text", text: result }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${String(e)}` }], isError: true };
    }
  }
);

server.registerTool(
  "testAnimation",
  {
    description: "Test animation functionality by writing a one-shot script file to run manually in After Effects",
    inputSchema: {
      operation: z.enum(["keyframe", "expression"]).describe("The animation operation to test"),
      compIndex: z.number().int().positive().describe("Composition index (usually 1)"),
      layerIndex: z.number().int().positive().describe("Layer index (usually 1)")
    }
  },
  async (params) => {
    try {
      const timestamp = new Date().getTime();
      const tempFile = path.join(os.tmpdir(), `ae_test_${timestamp}.jsx`);

      let scriptContent = "";
      if (params.operation === "keyframe") {
        scriptContent = `
          try {
            var comp = app.project.items[${params.compIndex}];
            var layer = comp.layers[${params.layerIndex}];
            var prop = layer.property("Transform").property("Opacity");
            prop.setValueAtTime(1, 25);
            alert("Test successful: Added opacity keyframe at 1s with value 25%");
          } catch (e) { alert("Test failed: " + e.toString()); }
        `;
      } else if (params.operation === "expression") {
        scriptContent = `
          try {
            var comp = app.project.items[${params.compIndex}];
            var layer = comp.layers[${params.layerIndex}];
            layer.property("Transform").property("Position").expression = "wiggle(3, 30)";
            alert("Test successful: Added wiggle expression to Position");
          } catch (e) { alert("Test failed: " + e.toString()); }
        `;
      }

      fs.writeFileSync(tempFile, scriptContent);

      return {
        content: [{
          type: "text",
          text: `Test script written. Run it manually in After Effects:\nFile > Scripts > Run Script File… → ${tempFile}`
        }]
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Error creating test script: ${String(error)}` }], isError: true };
    }
  }
);


// ============================================================
// TOOLS — compositions
// ============================================================

server.registerTool(
  "createComposition",
  {
    description: "Create a new composition in After Effects",
    inputSchema: {
      name: z.string().describe("Name of the composition"),
      width: z.number().int().positive().describe("Width in pixels"),
      height: z.number().int().positive().describe("Height in pixels"),
      pixelAspect: z.number().positive().optional().describe("Pixel aspect ratio (default: 1.0)"),
      duration: z.number().positive().optional().describe("Duration in seconds (default: 10.0)"),
      frameRate: z.number().positive().optional().describe("Frame rate (default: 30.0)"),
      backgroundColor: z.object({
        r: z.number().int().min(0).max(255),
        g: z.number().int().min(0).max(255),
        b: z.number().int().min(0).max(255)
      }).optional().describe("Background color (RGB 0-255)")
    }
  },
  async (params) => {
    try {
      const result = await bridge.sendCommand("createComposition", params, 10000);
      return { content: [{ type: "text", text: result }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${String(e)}` }], isError: true };
    }
  }
);


// ============================================================
// TOOLS — keyframes & expressions
// ============================================================

server.registerTool(
  "setLayerKeyframe",
  {
    description: "Set a keyframe for a specific layer property at a given time.",
    inputSchema: {
      ...LayerIdentifierSchema,
      propertyName: z.string().describe("Property to keyframe (e.g. 'Position', 'Scale', 'Rotation', 'Opacity')."),
      timeInSeconds: z.number().describe("Time in seconds for the keyframe."),
      value: KeyframeValueSchema
    }
  },
  async (parameters) => {
    try {
      const result = await bridge.sendCommand("setLayerKeyframe", parameters, 10000);
      return { content: [{ type: "text", text: result }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${String(e)}` }], isError: true };
    }
  }
);

server.registerTool(
  "setLayerExpression",
  {
    description: "Set or remove an expression on a layer property.",
    inputSchema: {
      ...LayerIdentifierSchema,
      propertyName: z.string().describe("Property to apply the expression to."),
      expressionString: z.string().describe("The expression string. Pass \"\" to remove.")
    }
  },
  async (parameters) => {
    try {
      const result = await bridge.sendCommand("setLayerExpression", parameters, 10000);
      return { content: [{ type: "text", text: result }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${String(e)}` }], isError: true };
    }
  }
);

server.registerTool(
  "setKeyframeEasing",
  {
    description: "Set easing type and Bezier handle influence for keyframes on a layer property.",
    inputSchema: {
      ...LayerIdentifierSchema,
      propertyName: z.string().describe("Property to target (e.g. 'Scale', 'Opacity', 'Position')."),
      easeType: z.enum(["easyEase", "easeIn", "easeOut", "linear", "hold", "bezier"])
        .optional()
        .describe("Interpolation type. Defaults to 'easyEase' (F9)."),
      keyIndex: z.number().int().positive().optional().describe("1-based index of a single keyframe. Omit to apply to all."),
      keyIndices: z.array(z.number().int().positive()).optional().describe("Apply to multiple keyframes by 1-based index."),
      keyTime: z.number().optional().describe("Target a keyframe by time in seconds."),
      inInfluence: z.number().min(0.1).max(100).optional().describe("In-handle influence (0.1–100)."),
      outInfluence: z.number().min(0.1).max(100).optional().describe("Out-handle influence (0.1–100)."),
      inSpeed: z.number().optional().describe("In-handle speed."),
      outSpeed: z.number().optional().describe("Out-handle speed.")
    }
  },
  async (parameters) => {
    try {
      const result = await bridge.sendCommand("setKeyframeEasing", parameters, 10000);
      return { content: [{ type: "text", text: result }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${String(e)}` }], isError: true };
    }
  }
);


// ============================================================
// TOOLS — effects
// ============================================================

server.registerTool(
  "applyEffect",
  {
    description: "Apply an effect to a layer in After Effects",
    inputSchema: {
      compName: z.string().describe("Name of the target composition."),
      layerIndex: z.number().int().positive().describe("1-based layer index."),
      effectName: z.string().optional().describe("Display name of the effect (e.g. 'Gaussian Blur')."),
      effectMatchName: z.string().optional().describe("Internal AE match name (e.g. 'ADBE Gaussian Blur 2'). Preferred over effectName."),
      effectCategory: z.string().optional().describe("Optional category for filtering."),
      presetPath: z.string().optional().describe("Path to an effect preset file (.ffx)."),
      effectSettings: z.record(z.string(), z.unknown()).optional().describe("Property values to set on the effect.")
    }
  },
  async (parameters) => {
    try {
      const result = await bridge.sendCommand("applyEffect", parameters, 10000);
      return { content: [{ type: "text", text: result }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${String(e)}` }], isError: true };
    }
  }
);

server.registerTool(
  "applyEffectTemplate",
  {
    description: "Apply a predefined effect template to a layer in After Effects",
    inputSchema: {
      compName: z.string().describe("Name of the target composition."),
      layerIndex: z.number().int().positive().describe("1-based layer index."),
      templateName: z.enum([
        "gaussian-blur", "directional-blur", "color-balance", "brightness-contrast",
        "curves", "glow", "drop-shadow", "cinematic-look", "text-pop"
      ]).describe("Effect template to apply."),
      customSettings: z.record(z.string(), z.unknown()).optional().describe("Override default template settings.")
    }
  },
  async (parameters) => {
    try {
      const result = await bridge.sendCommand("applyEffectTemplate", parameters, 10000);
      return { content: [{ type: "text", text: result }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${String(e)}` }], isError: true };
    }
  }
);


// ============================================================
// TOOLS — selection & context
// ============================================================

server.registerTool(
  "getSelectedLayers",
  {
    description: "Get the layers the user currently has highlighted in the After Effects timeline — the agent's primary context signal, equivalent to highlighted code in VSCode. Call this first before acting on user intent.",
    inputSchema: {
      compName: z.string().optional().describe("Target a specific composition by name. Omit to read from the currently active composition (the default for interactive use).")
    }
  },
  async () => {
    try {
      const result = await bridge.sendCommand("getSelectedLayers", {}, 10000);
      return { content: [{ type: "text", text: result }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${String(e)}` }], isError: true };
    }
  }
);


// ============================================================
// TOOLS — footage / project panel
// ============================================================

server.registerTool(
  "importFootage",
  {
    description: "Import a file (image, video, audio) from disk into the After Effects project panel.",
    inputSchema: {
      filePath: z.string().describe("Absolute path to the file on disk."),
      sequence: z.boolean().optional().describe("If true and the file is part of a numbered image sequence, import as a sequence.")
    }
  },
  async (params) => {
    try {
      const result = await bridge.sendCommand("importFootage", params, 10000);
      return { content: [{ type: "text", text: result }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${String(e)}` }], isError: true };
    }
  }
);

server.registerTool(
  "addFootageToComp",
  {
    description: "Place an existing project-panel item (footage, comp, or solid) onto a composition's timeline as a new layer.",
    inputSchema: {
      compName: z.string().describe("Target composition name."),
      itemName: z.string().optional().describe("Source item name from the project panel."),
      itemId: z.number().int().positive().optional().describe("Source item id (preferred over itemName — unambiguous when names collide)."),
      itemIndex: z.number().int().positive().optional().describe("Source item index in the project panel (1-based)."),
      position: z.array(z.number()).optional().describe("[x, y] or [x, y, z] position override."),
      startTime: z.number().optional().describe("Layer start time in seconds."),
      duration: z.number().positive().optional().describe("Layer duration in seconds."),
      name: z.string().optional().describe("Rename the newly created layer.")
    }
  },
  async (params) => {
    try {
      const result = await bridge.sendCommand("addFootageToComp", params, 10000);
      return { content: [{ type: "text", text: result }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${String(e)}` }], isError: true };
    }
  }
);


// ============================================================
// TOOLS — undo
// ============================================================

server.registerTool(
  "undoAction",
  {
    description: "Undo the most recent N After Effects actions (clamped 1–20). Use this in the self-healing retry loop to roll back a bad LLM-generated operation before reattempting.",
    inputSchema: {
      steps: z.number().int().min(1).max(20).optional().describe("Number of undo steps. Defaults to 1.")
    }
  },
  async (params) => {
    try {
      const result = await bridge.sendCommand("undoAction", params, 10000);
      return { content: [{ type: "text", text: result }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${String(e)}` }], isError: true };
    }
  }
);


// ============================================================
// START
// ============================================================

async function main() {
  console.error("After Effects MCP Server starting...");
  await bridge.start(AE_MCP_PORT);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("After Effects MCP Server running...");
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
