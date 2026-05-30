export { McpClient, mcpClient } from "./mcp/client.js";
export { SessionCache, sessionCache } from "./context/cache.js";
export { buildContext } from "./context/buildContext.js";
export { formatStateForPrompt } from "./context/format.js";
export type { LiveAEState, ActiveComp } from "./context/buildContext.js";
export type { ProjectInfo, CompositionsList, CompositionSummary, SelectedLayer, SelectedProperty } from "./mcp/tools.js";
export { getSelectionDetails } from "./mcp/tools.js";

export { getLLM, AnthropicProvider } from "./llm/index.js";
export type { LLMProvider, Message, ChatOptions, ChatResponse, StreamChunk } from "./llm/index.js";
export { buildSystemPrompt } from "./prompt/buildSystemPrompt.js";
export { STATIC_RULES } from "./prompt/rules.js";
