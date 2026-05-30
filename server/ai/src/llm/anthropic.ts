import Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { LLMProvider, Message, ChatOptions, ChatResponse, StreamChunk, ContentBlock } from './types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Normalises a Message's content to the Anthropic SDK's param shape.
 * - Plain string → passed through as-is (simple user/assistant messages).
 * - ContentBlock[] → mapped to Anthropic content-block params.
 */
function toAnthropicContent(
  content: string | ContentBlock[]
): string | Anthropic.MessageParam['content'] {
  if (typeof content === 'string') return content;
  return content.map(block => {
    if (block.type === 'text') {
      return { type: 'text' as const, text: block.text };
    }
    if (block.type === 'tool_use') {
      return { type: 'tool_use' as const, id: block.id, name: block.name, input: block.input as Record<string, unknown> };
    }
    // tool_result
    return {
      type: 'tool_result' as const,
      tool_use_id: block.tool_use_id,
      content: block.content,
      is_error: block.is_error,
    };
  });
}

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    this.client = new Anthropic({ apiKey });
  }

  async chat(messages: Message[], opts: ChatOptions): Promise<ChatResponse> {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature ?? 1,
      system: opts.systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: toAnthropicContent(m.content) })),
    };

    if (opts.tools?.length) {
      params.tools = opts.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: zodToJsonSchema(t.schema) as Anthropic.Tool['input_schema'],
      }));
      params.tool_choice = { type: 'auto' };
    }

    const response = await this.client.messages.create(params);

    // Join all text blocks → content; collect all tool_use blocks → toolUses.
    let content = '';
    const toolUses: ChatResponse['toolUses'] = [];
    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolUses.push({ id: block.id, name: block.name, input: block.input });
      }
    }

    return {
      content,
      stopReason: response.stop_reason ?? 'end_turn',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      toolUses,
    };
  }

  async *stream(messages: Message[], opts: ChatOptions): AsyncIterable<StreamChunk> {
    const stream = await this.client.messages.stream({
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature ?? 1,
      system: opts.systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: toAnthropicContent(m.content) })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text', text: event.delta.text };
      }
    }
    yield { type: 'done' };
  }
}
