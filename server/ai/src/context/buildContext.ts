import { getCurrentTime, getSelectedLayers, SelectedLayer, CompositionSummary } from "../mcp/tools.js";
import { sessionCache } from "./cache.js";

export interface ActiveComp {
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  numLayers: number;
}

export interface LiveAEState {
  project: { name: string; itemCount: number; compositionCount: number } | null;
  activeComp: ActiveComp | null;
  playhead: number | null;
  selectedLayers: SelectedLayer[];
}

export async function buildContext(): Promise<LiveAEState> {
  const [selectedResult, timeResult, projectInfo, compsList] = await Promise.all([
    getSelectedLayers().catch(() => null),
    getCurrentTime().catch(() => null),
    sessionCache.getProjectInfo().catch(() => null),
    sessionCache.getCompositionsList().catch(() => null),
  ]);

  // Resolve active comp dims from cached compositions list
  let activeComp: ActiveComp | null = null;
  const activeCompName = selectedResult?.activeComp?.name ?? timeResult?.compName;

  if (activeCompName && compsList) {
    const found = compsList.compositions.find((c: CompositionSummary) => c.name === activeCompName);
    if (found) {
      activeComp = {
        name: found.name,
        width: found.width,
        height: found.height,
        fps: found.frameRate,
        duration: found.duration,
        numLayers: found.numLayers,
      };
    }
  }

  const project =
    projectInfo
      ? {
          name: projectInfo.projectName,
          itemCount: projectInfo.numItems,
          compositionCount: projectInfo.itemCounts.compositions,
        }
      : null;

  return {
    project,
    activeComp,
    playhead: timeResult?.timeInSeconds ?? null,
    selectedLayers: selectedResult?.selectedLayers ?? [],
  };
}
