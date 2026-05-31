import Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { LLMProvider, Message, ChatOptions, ChatResponse, StreamChunk, ContentBlock, SystemPromptInput } from './types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Converts our SystemPromptInput into the Anthropic `system` param. A split
 * prompt becomes two text blocks: the stable `cached` prefix carries a
 * `cache_control: ephemeral` breakpoint (so it — plus the tools declared before
 * it — is cached and ~90% cheaper to re-read on later turns), while the
 * `volatile` live-state block is left uncached so it never busts that cache.
 * A plain string passes through unchanged (no caching).
 */
function toSystemParam(sp: SystemPromptInput): Anthropic.MessageCreateParams['system'] {
  if (typeof sp === 'string') return sp;
  const blocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: sp.cached, cache_control: { type: 'ephemeral' } },
  ];
  if (sp.volatile && sp.volatile.length > 0) {
    blocks.push({ type: 'text', text: sp.volatile });
  }
  return blocks;
}

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
      system: toSystemParam(opts.systemPrompt),
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
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? undefined,
        cacheReadInputTokens: response.usage.cache_read_input_tokens ?? undefined,
      },
      toolUses,
    };
  }

  async *stream(messages: Message[], opts: ChatOptions): AsyncIterable<StreamChunk> {
    const stream = await this.client.messages.stream({
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature ?? 1,
      system: toSystemParam(opts.systemPrompt),
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
