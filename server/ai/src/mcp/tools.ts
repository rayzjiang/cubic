import { mcpClient } from "./client.js";

// Return shapes mirror the ExtendScript handler output in server/mcp/src/scripts/

export interface ProjectInfo {
  projectName: string;
  path: string;
  numItems: number;
  bitsPerChannel: number;
  timeMode: "Frames" | "Timecode";
  items: Array<{ id: number; name: string; type: "Composition" | "Folder" | "Solid" | "Footage" }>;
  itemCounts: { compositions: number; footage: number; folders: number; solids: number };
  activeComp?: { id: number; name: string; width: number; height: number; duration: number; frameRate: number; numLayers: number };
}

export interface CompositionSummary {
  id: number;
  itemIndex: number;
  name: string;
  duration: number;
  frameRate: number;
  width: number;
  height: number;
  numLayers: number;
}

export interface CompositionsList {
  compositions: CompositionSummary[];
  count: number;
}

export interface CurrentTimeResult {
  status: "success";
  compName?: string;
  timeInSeconds?: number;
  frame?: number;
  frameRate?: number;
  duration?: number;
  activeComp?: false;
  message?: string;
}

export interface SelectedLayer {
  index: number;
  name: string;
  type: "text" | "shape" | "camera" | "light" | "null" | "adjustment" | "solid" | "unknown";
  enabled: boolean;
  threeDLayer: boolean;
  inPoint: number;
  outPoint: number;
  parent: { name: string; index: number } | null;
}

export interface SelectedLayersResult {
  status: "success";
  activeComp: { name: string; id: number; numLayers: number } | null;
  selectedLayers: SelectedLayer[];
  count: number;
  message?: string;
}

export async function getProjectInfo(): Promise<ProjectInfo> {
  return mcpClient.callRunScript("getProjectInfo") as Promise<ProjectInfo>;
}

export async function listCompositions(): Promise<CompositionsList> {
  return mcpClient.callRunScript("listCompositions") as Promise<CompositionsList>;
}

export async function getCurrentTime(): Promise<CurrentTimeResult> {
  return mcpClient.callRunScript("getCurrentTime") as Promise<CurrentTimeResult>;
}

export async function getSelectedLayers(): Promise<SelectedLayersResult> {
  return mcpClient.callRunScript("getSelectedLayers") as Promise<SelectedLayersResult>;
}
