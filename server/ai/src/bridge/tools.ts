import { bridgeClient } from "./client.js";

// Return shapes mirror the ExtendScript handler output in server/ae-bridge/src/scripts/

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

export interface SelectedProperty {
  propertyPath: string[];
  isGroup?: true;
  // Leaf-only fields (absent on groups):
  value?: unknown;
  expression?: string;
  selectedKeys?: Array<{ keyIndex: number; time: number; value: unknown }>;
}

export interface SelectionDetailsLayer {
  layerIndex: number;
  selectedProperties: SelectedProperty[];
  _truncated?: {
    properties?: number;
    expressionChars?: number;
    keyframes?: number;
  };
}

export interface SelectionDetailsResult {
  status: "success";
  activeComp: { name: string; id: number } | null;
  layers: SelectionDetailsLayer[];
  count: number;
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
  // Populated by buildContext() from getSelectionDetails (absent when no props are highlighted)
  selectedProperties?: SelectedProperty[];
  _truncated?: SelectionDetailsLayer["_truncated"];
}

export interface SelectedLayersResult {
  status: "success";
  activeComp: { name: string; id: number; numLayers: number } | null;
  selectedLayers: SelectedLayer[];
  count: number;
  message?: string;
}

export async function getProjectInfo(): Promise<ProjectInfo> {
  return bridgeClient.callRunScript("getProjectInfo") as Promise<ProjectInfo>;
}

export async function listCompositions(): Promise<CompositionsList> {
  return bridgeClient.callRunScript("listCompositions") as Promise<CompositionsList>;
}

export async function getCurrentTime(): Promise<CurrentTimeResult> {
  return bridgeClient.callRunScript("getCurrentTime") as Promise<CurrentTimeResult>;
}

export async function getSelectedLayers(): Promise<SelectedLayersResult> {
  return bridgeClient.callRunScript("getSelectedLayers") as Promise<SelectedLayersResult>;
}

export async function getSelectionDetails(): Promise<SelectionDetailsResult> {
  return bridgeClient.callRunScript("getSelectionDetails") as Promise<SelectionDetailsResult>;
}
