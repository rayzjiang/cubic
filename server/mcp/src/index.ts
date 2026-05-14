import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { z } from "zod";
import { fileURLToPath } from 'url';

const server = new McpServer({
  name: "AfterEffectsServer",
  version: "1.0.0"
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPTS_DIR = path.join(__dirname, "scripts");

function getAETempDir(): string {
  const homeDir = os.homedir();
  const bridgeDir = path.join(homeDir, '.ae-mcp-bridge');
  if (!fs.existsSync(bridgeDir)) {
    fs.mkdirSync(bridgeDir, { recursive: true });
  }
  return bridgeDir;
}

function readResultsFromTempFile(): string {
  try {
    const tempFilePath = path.join(getAETempDir(), 'ae_mcp_result.json');

    console.error(`Checking for results at: ${tempFilePath}`);

    if (fs.existsSync(tempFilePath)) {
      const stats = fs.statSync(tempFilePath);
      console.error(`Result file exists, last modified: ${stats.mtime.toISOString()}`);

      const content = fs.readFileSync(tempFilePath, 'utf8');
      console.error(`Result file content length: ${content.length} bytes`);

      const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
      if (stats.mtime < thirtySecondsAgo) {
        console.error(`WARNING: Result file is older than 30 seconds.`);
        return JSON.stringify({
          warning: "Result file appears to be stale (not recently updated).",
          message: "This could indicate After Effects is not properly writing results or the MCP Bridge Auto panel isn't running.",
          lastModified: stats.mtime.toISOString(),
          originalContent: content
        });
      }

      return content;
    } else {
      console.error(`Result file not found at: ${tempFilePath}`);
      return JSON.stringify({ error: "No results file found. Please run a script in After Effects first." });
    }
  } catch (error) {
    console.error("Error reading results file:", error);
    return JSON.stringify({ error: `Failed to read results: ${String(error)}` });
  }
}

async function waitForBridgeResult(expectedCommand?: string, timeoutMs: number = 5000, pollMs: number = 250): Promise<string> {
  const start = Date.now();
  const resultPath = path.join(getAETempDir(), 'ae_mcp_result.json');
  let lastSize = -1;

  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(resultPath)) {
      try {
        const content = fs.readFileSync(resultPath, 'utf8');
        if (content && content.length > 0 && content.length !== lastSize) {
          lastSize = content.length;
          try {
            const parsed = JSON.parse(content);
            if (!expectedCommand || parsed._commandExecuted === expectedCommand) {
              return content;
            }
          } catch {
            // not JSON yet; continue polling
          }
        }
      } catch {
        // transient read error; continue polling
      }
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
  return JSON.stringify({ error: `Timed out waiting for bridge result${expectedCommand ? ` for command '${expectedCommand}'` : ''}.` });
}

function writeCommandFile(command: string, args: Record<string, any> = {}): void {
  try {
    const commandFile = path.join(getAETempDir(), 'ae_command.json');
    const commandData = {
      command,
      args,
      timestamp: new Date().toISOString(),
      status: "pending"
    };
    fs.writeFileSync(commandFile, JSON.stringify(commandData, null, 2));
    console.error(`Command "${command}" written to ${commandFile}`);
  } catch (error) {
    console.error("Error writing command file:", error);
  }
}

function clearResultsFile(): void {
  try {
    const resultFile = path.join(getAETempDir(), 'ae_mcp_result.json');
    const resetData = {
      status: "waiting",
      message: "Waiting for new result from After Effects...",
      timestamp: new Date().toISOString()
    };
    fs.writeFileSync(resultFile, JSON.stringify(resetData, null, 2));
    console.error(`Results file cleared at ${resultFile}`);
  } catch (error) {
    console.error("Error clearing results file:", error);
  }
}


// ============================================================
// RESOURCE
// ============================================================

server.registerResource(
  "compositions",
  "aftereffects://compositions",
  {},
  async (uri) => {
    clearResultsFile();
    writeCommandFile("listCompositions", {});
    const result = await waitForBridgeResult("listCompositions", 6000, 250);
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: result
      }]
    };
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
  compIndex: z.number().int().positive().describe("1-based index of the target composition in the project panel."),
  layerIndex: z.number().int().positive().describe("1-based index of the target layer within the composition.")
};

const KeyframeValueSchema = z.unknown().describe("The value for the keyframe (e.g., [x,y] for Position, [w,h] for Scale, angle for Rotation, percentage for Opacity)");


// ============================================================
// TOOLS — general
// ============================================================

server.registerTool(
  "runScript",
  {
    description: "Run a script command in After Effects via the bridge panel. Queue the command then call getResults after ~2 seconds.",
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
      "applyEffect",
      "applyEffectTemplate",
      "bridgeTestEffects",
      "createCamera",
      "batchSetLayerProperties",
      "setCompositionProperties",
      "duplicateLayer",
      "deleteLayer",
      "setLayerMask",
      "moveLayer",
      "setKeyframeEasing",
      "getLayerExpressions",
      "removePropertyKeyframes",
      "batch"
    ];

    if (!allowedScripts.includes(script)) {
      return {
        content: [{ type: "text", text: `Error: "${script}" is not an allowed command. Allowed: ${allowedScripts.join(", ")}` }],
        isError: true
      };
    }

    try {
      clearResultsFile();
      writeCommandFile(script, parameters);
      return {
        content: [{ type: "text", text: `Command "${script}" queued. Call getResults after ~2 seconds.` }]
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Error queuing command: ${String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "getResults",
  { description: "Get results from the last command executed in After Effects" },
  async () => {
    try {
      return { content: [{ type: "text", text: readResultsFromTempFile() }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Error getting results: ${String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "getHelp",
  { description: "Get help and available commands for the After Effects MCP integration" },
  async () => ({
    content: [{
      type: "text",
      text: `# After Effects MCP Integration

## Workflow
1. Open After Effects and dock the **mcp-bridge-auto.jsx** panel (Window menu).
2. Call a tool to queue a command.
3. Call \`getResults\` after ~2 seconds to read the output.
4. Use \`runScript\` with \`batch\` to run multiple commands in one round-trip.

## Available Commands (via runScript or dedicated tools)

**Compositions:** getProjectInfo, listCompositions, createComposition, setCompositionProperties
**Layers:** getLayerInfo, createTextLayer, createShapeLayer, createSolidLayer, createCamera, duplicateLayer, setLayerProperties, batchSetLayerProperties, moveLayer, deleteLayer
**Keyframes:** setLayerKeyframe, setKeyframeEasing, removePropertyKeyframes
**Expressions:** getLayerExpressions, setLayerExpression
**Masks:** setLayerMask
**Effects:** applyEffect, applyEffectTemplate, bridgeTestEffects
**Batch:** batch — run multiple commands in one round-trip (strongly preferred)

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
      clearResultsFile();
      writeCommandFile("bridgeTestEffects", {});
      return {
        content: [{ type: "text", text: `Bridge test queued. Call getResults after ~2 seconds.` }]
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Error queuing bridge test: ${String(error)}` }], isError: true };
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
      clearResultsFile();
      writeCommandFile("createComposition", params);
      return {
        content: [{ type: "text", text: `createComposition queued. Call getResults after ~2 seconds.` }]
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Error queuing createComposition: ${String(error)}` }], isError: true };
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
      clearResultsFile();
      writeCommandFile("setLayerKeyframe", parameters);
      return {
        content: [{ type: "text", text: `setLayerKeyframe queued for "${parameters.propertyName}" on layer ${parameters.layerIndex}. Call getResults after ~2 seconds.` }]
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Error queuing setLayerKeyframe: ${String(error)}` }], isError: true };
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
      clearResultsFile();
      writeCommandFile("setLayerExpression", parameters);
      return {
        content: [{ type: "text", text: `setLayerExpression queued for "${parameters.propertyName}" on layer ${parameters.layerIndex}. Call getResults after ~2 seconds.` }]
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Error queuing setLayerExpression: ${String(error)}` }], isError: true };
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
      clearResultsFile();
      writeCommandFile("setKeyframeEasing", parameters);
      return {
        content: [{ type: "text", text: `setKeyframeEasing queued for "${parameters.propertyName}" on layer ${parameters.layerIndex}. Call getResults after ~2 seconds.` }]
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Error queuing setKeyframeEasing: ${String(error)}` }], isError: true };
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
      compIndex: z.number().int().positive().describe("1-based composition index."),
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
      clearResultsFile();
      writeCommandFile("applyEffect", parameters);
      return {
        content: [{ type: "text", text: `applyEffect queued for layer ${parameters.layerIndex} in comp ${parameters.compIndex}. Call getResults after ~2 seconds.` }]
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Error queuing applyEffect: ${String(error)}` }], isError: true };
    }
  }
);

server.registerTool(
  "applyEffectTemplate",
  {
    description: "Apply a predefined effect template to a layer in After Effects",
    inputSchema: {
      compIndex: z.number().int().positive().describe("1-based composition index."),
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
      clearResultsFile();
      writeCommandFile("applyEffectTemplate", parameters);
      return {
        content: [{ type: "text", text: `applyEffectTemplate "${parameters.templateName}" queued for layer ${parameters.layerIndex}. Call getResults after ~2 seconds.` }]
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Error queuing applyEffectTemplate: ${String(error)}` }], isError: true };
    }
  }
);


// ============================================================
// START
// ============================================================

async function main() {
  console.error("After Effects MCP Server starting...");
  console.error(`Scripts directory: ${SCRIPTS_DIR}`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("After Effects MCP Server running...");
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
