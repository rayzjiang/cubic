import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, Message, ChatOptions, ChatResponse, StreamChunk } from './types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 4096;

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    this.client = new Anthropic({ apiKey });
  }

  async chat(messages: Message[], opts: ChatOptions): Promise<ChatResponse> {
    const response = await this.client.messages.create({
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature ?? 1,
      system: opts.systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    const textBlock = response.content.find(b => b.type === 'text');
    return {
      content: textBlock?.type === 'text' ? textBlock.text : '',
      stopReason: response.stop_reason ?? 'end_turn',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  async *stream(messages: Message[], opts: ChatOptions): AsyncIterable<StreamChunk> {
    const stream = await this.client.messages.stream({
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature ?? 1,
      system: opts.systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text', text: event.delta.text };
      }
    }
    yield { type: 'done' };
  }
}
