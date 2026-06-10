import { getCurrentTime, getSelectedLayers, getSelectionDetails, SelectedLayer, CompositionSummary } from "../bridge/tools.js";
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
  frame: number | null;
  selectedLayers: SelectedLayer[];
}

export async function buildContext(): Promise<LiveAEState> {
  const [selectedResult, timeResult, selectionDetails, projectInfo, compsList] = await Promise.all([
    getSelectedLayers().catch(() => null),
    getCurrentTime().catch(() => null),
    getSelectionDetails().catch(() => null),
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

  // Merge per-layer selection detail (selectedProperties) into the selectedLayers list.
  const detailByLayer = new Map<number, { selectedProperties: SelectedLayer["selectedProperties"]; _truncated: SelectedLayer["_truncated"] }>();
  if (selectionDetails?.layers) {
    for (const dl of selectionDetails.layers) {
      detailByLayer.set(dl.layerIndex, {
        selectedProperties: dl.selectedProperties.length > 0 ? dl.selectedProperties : undefined,
        _truncated: dl._truncated,
      });
    }
  }

  const selectedLayers: SelectedLayer[] = (selectedResult?.selectedLayers ?? []).map((l) => {
    const detail = detailByLayer.get(l.index);
    if (!detail?.selectedProperties) return l;
    return {
      ...l,
      selectedProperties: detail.selectedProperties,
      ...(detail._truncated ? { _truncated: detail._truncated } : {}),
    };
  });

  return {
    project,
    activeComp,
    playhead: timeResult?.timeInSeconds ?? null,
    frame: timeResult?.frame ?? null,
    selectedLayers,
  };
}
