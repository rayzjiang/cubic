import { AnthropicProvider } from './anthropic.js';
import type { LLMProvider } from './types.js';

let _llm: LLMProvider | undefined;
export function getLLM(): LLMProvider {
  return (_llm ??= new AnthropicProvider());
}
export { AnthropicProvider } from './anthropic.js';
export type { LLMProvider, Message, ChatOptions, ChatResponse, StreamChunk } from './types.js';
