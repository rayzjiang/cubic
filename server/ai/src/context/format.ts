import { LiveAEState } from "./buildContext.js";

export function formatStateForPrompt(state: LiveAEState): string {
  const payload: Record<string, unknown> = {};

  if (state.project) {
    payload.project = {
      name: state.project.name,
      itemCount: state.project.itemCount,
      compositionCount: state.project.compositionCount,
    };
  }

  if (state.activeComp) {
    payload.activeComp = {
      name: state.activeComp.name,
      width: state.activeComp.width,
      height: state.activeComp.height,
      fps: state.activeComp.fps,
      duration: state.activeComp.duration,
      numLayers: state.activeComp.numLayers,
    };
  }

  payload.playhead = state.playhead;

  payload.selectedLayers =
    state.selectedLayers.length > 0
      ? state.selectedLayers.map((l) => ({
          index: l.index,
          name: l.name,
          type: l.type,
          enabled: l.enabled,
          threeDLayer: l.threeDLayer,
          parent: l.parent,
        }))
      : [];

  return `<live_ae_state>\n${JSON.stringify(payload, null, 2)}\n</live_ae_state>`;
}
