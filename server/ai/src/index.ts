export { BridgeClient, bridgeClient } from "./bridge/client.js";
export { SessionCache, sessionCache } from "./context/cache.js";
export { buildContext } from "./context/buildContext.js";
export { formatStateForPrompt } from "./context/format.js";
export type { LiveAEState, ActiveComp } from "./context/buildContext.js";
export type { ProjectInfo, CompositionsList, CompositionSummary, SelectedLayer, SelectedProperty } from "./bridge/tools.js";
export { getSelectionDetails, getProjectInfo } from "./bridge/tools.js";

export { getLLM, AnthropicProvider, estimateCost, getDebugCost, defaultModel } from "./llm/index.js";
export type { LLMProvider, Message, ChatOptions, ChatResponse, StreamChunk, ContentBlock, TextBlock, ToolUseBlock, ToolResultBlock, ToolUse, ToolDefinition } from "./llm/index.js";
export { buildSystemPrompt } from "./prompt/buildSystemPrompt.js";
export { renderCommandCatalog } from "./prompt/renderCatalog.js";
export { STATIC_RULES } from "./prompt/rules.js";
export { AE_TOOLS, COMMAND_NAMES } from "./tools/definitions.js";
export { COMMAND_PARAMS } from "./tools/command-params.js";
export type { CommandName, CommandSpec } from "./tools/command-params.js";

// Agent loop / self-healing loop (Phase 2 item 4)
export { runAgentTurn, Session, nextQueueId, executeTool, snapshotProject, describeToolCall, describeToolNoop, describeToolResult } from "./agent/index.js";
export type { AgentDeps, ToolExecution, SnapshotResult, AgentEvent, EmitFn, QueuedMessage } from "./agent/index.js";
// History compaction (Phase 2 item 7)
export { compactSession, contextTokensOf, findCompactionCut, COMPACT_THRESHOLD, HARD_CEILING, KEEP_RECENT_TURNS } from "./agent/index.js";
