import type { ZodTypeAny } from 'zod';

// ─── Content block types (Anthropic / CC / Cursor standard representation) ───
// Message.content accepts a plain string (simple user/assistant messages) OR a
// ContentBlock array (tool-call turns). The union keeps simple cases simple while
// matching the API's actual wire model — item 4 just appends tool_result blocks
// with no migration needed.

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

/** Defined now; consumed by the agent loop in item 4 to return tool results. */
export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

// ─── Message ─────────────────────────────────────────────────────────────────

export interface Message {
  role: 'user' | 'assistant';
  /** Plain string for ordinary turns; ContentBlock[] for tool-call turns. */
  content: string | ContentBlock[];
}

// ─── Tool definitions (provider-neutral) ────────────────────────────────────

/** A single emitted tool call from the model. */
export interface ToolUse {
  id: string;
  name: string;
  input: unknown;
}

/**
 * Provider-neutral tool definition. `schema` is a zod type; anthropic.ts
 * converts it to `input_schema` via zodToJsonSchema — the only place that
 * conversion happens (single-chokepoint rule).
 */
export interface ToolDefinition {
  name: string;
  description: string;
  schema: ZodTypeAny;
}

// ─── System prompt ────────────────────────────────────────────────────────────

/**
 * A split system prompt: the stable `cached` prefix (role + rules + command
 * catalog) is marked as a prompt-cache breakpoint by anthropic.ts; the `volatile`
 * suffix (per-turn live AE state) is left uncached so timeline changes never bust
 * the catalog cache. A plain string is also accepted (no caching).
 */
export interface SystemPrompt {
  cached: string;
  volatile?: string;
}

export type SystemPromptInput = string | SystemPrompt;

// ─── Chat API types ──────────────────────────────────────────────────────────

export interface ChatOptions {
  systemPrompt: SystemPromptInput;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** When provided, the request includes these tools with tool_choice:auto. */
  tools?: ToolDefinition[];
}

export interface ChatResponse {
  /** Joined text from all text blocks in the response (empty string if tool-only turn). */
  content: string;
  stopReason: 'end_turn' | 'max_tokens' | 'tool_use' | string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    /** Tokens written to the prompt cache this turn (first turn of a session). */
    cacheCreationInputTokens?: number;
    /** Tokens read from the prompt cache this turn (~90% cheaper than input). */
    cacheReadInputTokens?: number;
  };
  /** Tool calls emitted by the model this turn (empty array when none). */
  toolUses: ToolUse[];
}

export interface StreamChunk {
  type: 'text' | 'done';
  text?: string;
}

export interface LLMProvider {
  chat(messages: Message[], opts: ChatOptions): Promise<ChatResponse>;
  stream(messages: Message[], opts: ChatOptions): AsyncIterable<StreamChunk>;
  /**
   * Total context window (tokens) for `model` — or this provider's default model when omitted.
   * The API never reports this (responses carry tokens USED, not the limit), so each provider
   * keeps its own per-model table. Used by the agent loop to decide when to auto-compact history.
   */
  contextWindow(model?: string): number;
}
