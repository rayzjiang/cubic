export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  systemPrompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResponse {
  content: string;
  stopReason: 'end_turn' | 'max_tokens' | 'tool_use' | string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface StreamChunk {
  type: 'text' | 'done';
  text?: string;
}

export interface LLMProvider {
  chat(messages: Message[], opts: ChatOptions): Promise<ChatResponse>;
  stream(messages: Message[], opts: ChatOptions): AsyncIterable<StreamChunk>;
}
