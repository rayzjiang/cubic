export { BridgeClient, bridgeClient } from "./bridge/client.js";
export { SessionCache, sessionCache } from "./context/cache.js";
export { buildContext } from "./context/buildContext.js";
export { formatStateForPrompt } from "./context/format.js";
export type { LiveAEState, ActiveComp } from "./context/buildContext.js";
export type { ProjectInfo, CompositionsList, CompositionSummary, SelectedLayer, SelectedProperty } from "./bridge/tools.js";
export { getSelectionDetails, getProjectInfo } from "./bridge/tools.js";

export { getLLM, AnthropicProvider, estimateCost, getDebugCost, defaultModel } from "./llm/index.js";
export type { LLMProvider, Message, ChatOptions, ChatResponse, StreamChunk, ContentBlock, TextBlock, ToolUseBlock, ToolResultBlock, ToolUse, ToolDefinition } from "./llm/index.js";
// The system prompt + tool catalog (STATIC_RULES, COMMAND_PARAMS, AE_TOOLS, buildSystemPrompt,
// renderCommandCatalog) are the crown jewels — they now live server-side in the proxy/ Worker
// (proxy/src/secrets) and are NOT re-exported here, so they can't ship in the desktop binary.
// Only the non-secret command NAMES (codegen'd mirror) remain, for the dispatch guard.
export { COMMAND_NAMES, INTERNAL_COMMANDS } from "./tools/command-names.generated.js";
export type { CommandName } from "./tools/command-names.generated.js";

// Agent loop / self-healing loop (Phase 2 item 4)
export { runAgentTurn, Session, nextQueueId, executeTool, snapshotProject, describeToolCall, describeToolNoop, describeToolResult, INTERRUPTED_MARKER, setAnalyticsSink, emitAnalytics } from "./agent/index.js";
export type { AgentDeps, ToolExecution, SnapshotResult, AgentEvent, EmitFn, QueuedMessage } from "./agent/index.js";
// History compaction (Phase 2 item 7)
export { compactSession, contextTokensOf, findCompactionCut, buildSummaryMessage, COMPACT_THRESHOLD, HARD_CEILING, KEEP_RECENT_TURNS } from "./agent/index.js";
