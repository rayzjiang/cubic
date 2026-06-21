import Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { LLMProvider, Message, ChatOptions, ChatResponse, StreamChunk, ContentBlock, SystemPromptInput } from './types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 4096;

/** Friendly aliases for the CUBIC_MODEL env var (so you can flip models without the full id). */
const MODEL_ALIASES: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
  opus: 'claude-opus-4-8',
};

/**
 * The model used when a call doesn't specify one. Reads `CUBIC_MODEL` at CALL time (not import time)
 * so the backend's `.env` — loaded at boot — is honored; accepts a friendly alias (sonnet|haiku|opus)
 * or a full model id. Defaults to Sonnet. Lets you flip Sonnet↔Haiku for cheap dev without a rebuild.
 */
export function defaultModel(): string {
  const raw = process.env.CUBIC_MODEL?.trim();
  if (!raw) return DEFAULT_MODEL;
  return MODEL_ALIASES[raw.toLowerCase()] ?? raw;
}

// ─── Per-model metadata (the API does not report any of this) ──────────────────
// Each provider owns its own tables; an OpenAI provider added later brings its own.
const DEFAULT_CONTEXT_WINDOW = 200_000; // conservative fallback for an unmapped model id
const CONTEXT_WINDOWS: Record<string, number> = {
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5': 200_000,
  // add Opus / future models here as they are wired up
};

/** USD per 1M tokens. cache reads bill at ~0.1× input; cache writes at ~1.25× input. */
const MODEL_PRICING: Record<string, { inPerM: number; outPerM: number }> = {
  'claude-sonnet-4-6': { inPerM: 3, outPerM: 15 },
  'claude-haiku-4-5': { inPerM: 1, outPerM: 5 },
};
const DEFAULT_PRICING = { inPerM: 3, outPerM: 15 };

/** Rough USD cost of one call, accounting for the discounted cache tiers. */
export function estimateCost(model: string | undefined, usage: ChatResponse['usage']): number {
  const p = (model ? MODEL_PRICING[model] : undefined) ?? DEFAULT_PRICING;
  const cacheWrite = usage.cacheCreationInputTokens ?? 0;
  const cacheRead = usage.cacheReadInputTokens ?? 0;
  return (
    (usage.inputTokens * p.inPerM +
      cacheWrite * p.inPerM * 1.25 +
      cacheRead * p.inPerM * 0.1 +
      usage.outputTokens * p.outPerM) /
    1_000_000
  );
}

// Running tally of debug-logged calls (only accumulates while CUBIC_LLM_DEBUG is on). Lets the live
// test scripts print a per-run cost total that includes calls made deep inside the agent loop.
const _debugTally = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 };
export function getDebugCost(): typeof _debugTally { return { ..._debugTally }; }

/**
 * Pretty-prints one model round-trip to the terminal, gated by the CUBIC_LLM_DEBUG level:
 * unset/0 = off, 1 = on (compact — tool_results shown as a [tool_result] placeholder),
 * 2 = full (tool_result bodies printed too, clipped — for inspecting handler payloads).
 * Real calls spend API money (and compaction adds an extra summary call), so this makes
 * every input, output, and dollar visible. Mirrors the shared tests/lib/format.mjs output.
 */
function logCall(
  model: string,
  messages: Message[],
  system: Anthropic.MessageCreateParams['system'],
  tools: ChatOptions['tools'],
  response: ChatResponse,
): void {
  const level = Number(process.env.CUBIC_LLM_DEBUG) || 0;
  if (level < 1) return;
  const full = level >= 2;
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
  const clip = (s: string, n = 600) => (s.length > n ? s.slice(0, n) + dim(` …(+${s.length - n} chars)`) : s);
  const render = (c: Message['content']): string =>
    typeof c === 'string'
      ? clip(c)
      : c.map(b =>
          b.type === 'text' ? clip(b.text)
          // level 2 prints tool_result bodies (clipped) so you can inspect handler payloads
          // (e.g. configurableProperties); level 1 keeps the compact placeholder.
          : (full && b.type === 'tool_result') ? `[tool_result ${clip(typeof b.content === 'string' ? b.content : JSON.stringify(b.content), 1500)}]`
          : `[${b.type}${'name' in b ? ` ${b.name}` : ''}]`
        ).join(' ');

  const sysLen = typeof system === 'string' ? system.length : (system ?? []).reduce((n, b) => n + ('text' in b ? b.text.length : 0), 0);
  console.log(bold(`\n╭─ LLM call · ${model}`));
  console.log(dim(`│  system: ${sysLen} chars · tools: ${tools?.map(t => t.name).join(', ') || 'none'}`));
  for (const m of messages) console.log(`│  ${cyan(m.role)}: ${render(m.content)}`);
  if (response.content) console.log(`│  ${cyan('→ assistant')}: ${clip(response.content)}`);
  for (const tu of response.toolUses) console.log(`│  ${cyan('→ tool_use')}: ${tu.name} ${dim(clip(JSON.stringify(tu.input), 200))}`);
  const u = response.usage;
  // ctx = the true prefill size that counts against the context window (input + cache-creation +
  // cache-read) — matches contextTokensOf() in agent/compaction.ts. Surfaced so the §C compaction
  // test can size CUBIC_CONTEXT_WINDOW off the real number, not just the visible `input`.
  const ctx = u.inputTokens + (u.cacheCreationInputTokens ?? 0) + (u.cacheReadInputTokens ?? 0);
  console.log(dim(`╰─ ${u.inputTokens} in · ${u.outputTokens} out · ${u.cacheCreationInputTokens ?? 0} cache-create · ${u.cacheReadInputTokens ?? 0} cache-read · ctx=${ctx} · ~$${estimateCost(model, u).toFixed(5)}`));

  _debugTally.calls++;
  _debugTally.inputTokens += u.inputTokens;
  _debugTally.outputTokens += u.outputTokens;
  _debugTally.cacheReadTokens += u.cacheReadInputTokens ?? 0;
  _debugTally.costUsd += estimateCost(model, u);
}

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

  contextWindow(model?: string): number {
    return CONTEXT_WINDOWS[model ?? defaultModel()] ?? DEFAULT_CONTEXT_WINDOW;
  }

  async chat(messages: Message[], opts: ChatOptions): Promise<ChatResponse> {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: opts.model ?? defaultModel(),
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

    const response = await this.client.messages.create(
      params,
      opts.signal ? { signal: opts.signal } : undefined,
    );

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

    const result: ChatResponse = {
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

    logCall(params.model, messages, params.system, opts.tools, result);
    return result;
  }

  async *stream(messages: Message[], opts: ChatOptions): AsyncIterable<StreamChunk> {
    const stream = await this.client.messages.stream({
      model: opts.model ?? defaultModel(),
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
