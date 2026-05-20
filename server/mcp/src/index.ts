import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { z } from "zod";
import { bridge, BridgeError } from "./bridge/wsBridge.js";

const server = new McpServer({
  name: "AfterEffectsServer",
  version: "2.0.0"
});

const AE_MCP_PORT = parseInt(process.env.AE_MCP_PORT ?? "17923", 10);

const FRAMES_DIR = path.join(os.homedir(), '.cubic', 'frames');
function defaultFramePath(): string {
  if (!fs.existsSync(FRAMES_DIR)) fs.mkdirSync(FRAMES_DIR, { recursive: true });
  return path.join(FRAMES_DIR, `frame_${Date.now()}.png`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dispatchTool(command: string, args: object, timeoutMs = 10000): Promise<any> {
  try {
    const raw = await bridge.sendCommand(command, args, timeoutMs);
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { return { content: [{ type: "text", text: raw }] }; }
    if (parsed?.status === "error") {
      return {
        content: [{ type: "text", text: raw }],
        isError: true,
        structuredContent: {
          ok: false,
          errorCode: parsed.errorCode ?? "INTERNAL_ERROR",
          message: parsed.message ?? "Unknown error",
          command,
          line: parsed.line,
          stack: parsed.stack
        }
      };
    }
    const contentBlocks: any[] = [{ type: "text", text: raw }];
    if (command === "saveFrameToPng" && parsed?.path) {
      try {
        const buf = fs.readFileSync(parsed.path);
        contentBlocks.push({ type: "image", data: buf.toString("base64"), mimeType: "image/png" });
      } catch (e) {
        // File missing — fall through with text-only; structuredContent carries the path
      }
    }
    return { content: contentBlocks, structuredContent: { ok: true, command, result: parsed } };
  } catch (e: any) {
    return {
      content: [{ type: "text", text: `Error: ${e?.message ?? String(e)}` }],
      isError: true,
      structuredContent: {
        ok: false,
        errorCode: (e instanceof BridgeError ? e.code : undefined) ?? "INTERNAL_ERROR",
        message: e?.message ?? String(e),
        command
      }
    };
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
      "getCompositionInfo",
      "getLayerInfo",
      "createComposition",
      "setLayerProperties",
      "setLayerKeyframe",
      "setLayerExpression",
      "getLayerEffects",
      "applyEffect",
      "applyEffectTemplate",
      "setEffectProperty",
      "deleteEffect",
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
      "createLayer",
      "precompose",
      "setTrackMatte",
      "addShapeOperator",
      "setShapeOperatorProperty",
      "addTextAnimator",
      "setTextAnimatorProperty",
      "setTextAnimatorRangeSelector",
      "getLayerProperty",
      "setLayerProperty",
      "splitLayer",
      "mergeLayer",
      "trimLayer",
      "setSelectedLayers",
      "centerAnchorPoint",
      "getCurrentTime",
      "setCurrentTime",
      "addMarker",
      "listMarkers",
      "updateMarker",
      "removeMarker",
      "getProjectPath",
      "saveProject",
      "saveFrameToPng",
      "decomposeLayer",
      "setTimeRemapEnabled",
      "setKeyframeSpatial",
      "setAnchorPoint",
      "alignLayers",
      "sequenceLayers",
      "copyKeyframeEasing",
      "explodeTextLayer",
      "duplicateComposition",
      "convertToShape",
      "importAssetToComp"
    ];

    if (!allowedScripts.includes(script)) {
      return {
        content: [{ type: "text", text: `Error: "${script}" is not an allowed command. Allowed: ${allowedScripts.join(", ")}` }],
        isError: true
      };
    }

    const timeoutMs = (script === "batch" || script === "saveFrameToPng") ? 30000 : 10000;
    return dispatchTool(script, parameters, timeoutMs);
  }
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

## Available Commands (all via runScript or batch)

All commands are invoked via \`runScript({ script, parameters })\` or wrapped in \`batch\`. The typed \`createComposition\` tool is kept as a schema example; everything else routes through \`runScript\`.

**Compositions:** getProjectInfo, listCompositions, getCompositionInfo, createComposition, setCompositionProperties, deleteComposition, duplicateComposition (deep:true recursively duplicates all nested pre-comps)
**Playhead:** getCurrentTime, setCurrentTime
**Layers:** getLayerInfo, getSelectedLayers, setSelectedLayers, createLayer (single entry point — use \`type\` field: text|shape|solid|adjustment|null|camera|light), duplicateLayer, setLayerProperties, batchSetLayerProperties, setLayerParent, moveLayer, deleteLayer
**Layer time ops:** splitLayer, mergeLayer (inverse of splitLayer), trimLayer (inPoint/outPoint/startTime/mode)
**Anchor & Alignment:** setAnchorPoint (position: TOP_LEFT|TOP_CENTER|TOP_RIGHT|MIDDLE_LEFT|CENTER|MIDDLE_RIGHT|BOTTOM_LEFT|BOTTOM_CENTER|BOTTOM_RIGHT; preserves layer position), centerAnchorPoint (alias for CENTER), alignLayers (alignment: LEFT|HORIZONTAL_CENTER|RIGHT|TOP|VERTICAL_CENTER|BOTTOM; reference: COMPOSITION|SELECTION), sequenceLayers (stagger inPoints; orderType: TOP_DOWN|BOTTOM_UP|RANDOM)
**Nesting / Mattes:** precompose, decomposeLayer (inverse of precompose), setTrackMatte
**Shape Operators:** addShapeOperator (type: trimPaths|repeater|roundedCorners|gradientFill|gradientStroke), setShapeOperatorProperty, convertToShape (text→shapes or vector→shapes via menu command; may be CEP-gated)
**Text:** createLayer({type:"text"}), addTextAnimator, setTextAnimatorProperty, setTextAnimatorRangeSelector, explodeTextLayer (splitMethod: CHARACTERS|WORDS|LINES; animator-mask preserves kerning/layout)
**Property Reads/Writes:** getLayerProperty, setLayerProperty (path-based — address any nested property, e.g. ['Contents','Group 1','Stroke 1','Color'])
**Keyframes:** getLayerKeyframes (includes inTemporalEase/outTemporalEase/spatial tangents), setLayerKeyframe, setKeyframeEasing, setKeyframeSpatial, copyKeyframeEasing (copy easing curve between layers without changing values), removePropertyKeyframes
**Expressions:** getLayerExpressions, setLayerExpression (expressionString or preset: INERTIAL_BOUNCE|ELASTIC|OVERSHOOT|WIGGLE|AUTO_FADE|LOOP_OUT|LOOP_IN|LOOP_PINGPONG with optional presetParams)
**Masks:** getLayerMasks, setLayerMask (returns previousValues for revert), deleteLayerMask
**Effects:** getLayerEffects, applyEffect (matchName, effectName, or presetPath for .ffx files), applyEffectTemplate, setEffectProperty (returns previousValue for revert), deleteEffect
**Markers:** addMarker, listMarkers, updateMarker, removeMarker (comp or layer; omit layerIndex for comp marker)
**Footage / Project Panel:** listProjectItems, importFootage, addFootageToComp, importAssetToComp (one-shot import+place), deleteProjectItem, deleteUnusedSolids
**Project:** getProjectPath, saveProject
**Batch:** batch — run multiple commands in one call (strongly preferred for multiple operations). Accepts an optional \`groupLabel\` (human-readable turn summary, e.g. "apply cinematic look to logo") that becomes the single Edit > Undo entry the user sees in AE — one ⌘Z reverts the entire turn.

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
  async () => dispatchTool("getProjectInfo", {}, 10000)
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
