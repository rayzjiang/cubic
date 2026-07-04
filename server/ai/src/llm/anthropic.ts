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
 * Converts our SystemPromptInput into the Anthropic `system` param. The `cached`
 * prefix carries a `cache_control: ephemeral` breakpoint, so it — plus the tools
 * declared before it — is cached and ~90% cheaper to re-read on later turns. Live
 * AE state is NOT here anymore: it rides at the tail of the message stream (see
 * appendLiveStateAndCacheBreakpoint) so it never sits inside the cached prefix.
 * A plain string passes through unchanged (no caching).
 */
function toSystemParam(sp: SystemPromptInput): Anthropic.MessageCreateParams['system'] {
  if (typeof sp === 'string') return sp;
  return [{ type: 'text', text: sp.cached, cache_control: { type: 'ephemeral' } }];
}

/**
 * Makes the conversation itself prompt-cacheable (the big lever): on every request we drop a rolling
 * `cache_control` breakpoint on the LAST real content block, so the whole prefix — tools + system +
 * entire conversation so far — is cached and re-read at ~0.1× on the next call instead of re-billed
 * at full price. Within a multi-tool turn this turns "re-read the whole transcript every iteration"
 * into write-once-read-many; across turns the prior conversation is a cache hit.
 *
 * The per-turn live AE state (which changes every turn) is appended AFTER that breakpoint as an
 * uncached trailing text block, so it never sits inside the cached prefix and bust it. A trailing
 * text block after tool_result blocks in the same user turn is valid.
 *
 * Mutates the last message of `apiMessages` in place. No-op when there are no messages.
 * Exported for unit testing (free — asserts cache placement without a real API call).
 */
export function appendLiveStateAndCacheBreakpoint(
  apiMessages: Anthropic.MessageParam[],
  liveState?: string,
): void {
  if (apiMessages.length === 0) return;
  const last = apiMessages[apiMessages.length - 1];
  // Normalize content to a mutable block array (a plain-string message becomes one text block).
  const blocks: Anthropic.ContentBlockParam[] =
    typeof last.content === 'string'
      ? [{ type: 'text', text: last.content }]
      : [...last.content];
  if (blocks.length === 0) return;
  // Rolling breakpoint on the newest real block — caches everything up to and including it.
  const lastBlock = blocks[blocks.length - 1];
  blocks[blocks.length - 1] = { ...lastBlock, cache_control: { type: 'ephemeral' } } as Anthropic.ContentBlockParam;
  // Uncached live-state tail (after the breakpoint).
  if (liveState && liveState.length > 0) {
    blocks.push({ type: 'text', text: liveState });
  }
  last.content = blocks;
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
  /** Proxy mode (CUBIC_ENV=prod): route through the Worker + attach the caller's Supabase JWT per call. */
  private readonly proxyMode: boolean;

  constructor() {
    const proxyMode = process.env.CUBIC_ENV === 'prod';
    this.proxyMode = proxyMode;
    // Proxy mode MUST route through the Worker via ANTHROPIC_BASE_URL (set by app config from
    // CUBIC_PROXY_URL). Without it the SDK would silently call api.anthropic.com with a placeholder
    // key (a confusing 401) AND a bare, ruleless request — fail loud on the misconfiguration instead.
    if (proxyMode && !process.env.ANTHROPIC_BASE_URL) {
      throw new Error('CUBIC_ENV=prod requires CUBIC_PROXY_URL (→ ANTHROPIC_BASE_URL); refusing to call Anthropic directly with no key.');
    }
    // Direct-local needs a real key; proxy mode has none on-device (the Worker holds it).
    // The SDK still requires a non-empty apiKey string, so pass a placeholder in proxy mode —
    // baseURL (ANTHROPIC_BASE_URL, set by app config from CUBIC_PROXY_URL) routes to the Worker,
    // which overwrites x-api-key with the real key before forwarding to Anthropic.
    const apiKey = process.env.ANTHROPIC_API_KEY ?? (proxyMode ? 'cubic-proxy-placeholder' : undefined);
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    // Auth (Wave 2 / WT-PROXY-GATING): the Supabase JWT is now attached PER REQUEST in chat()/stream()
    // (opts.authToken), not baked once here — a session's token refreshes ~hourly, so a fixed
    // construction-time header would go stale. Direct mode sends no such header.
    this.client = new Anthropic({ apiKey });
  }

  /** Per-request options: the abort signal + (proxy mode) the caller's Supabase JWT as `Authorization`. */
  private requestOptions(opts: ChatOptions): { signal?: AbortSignal; headers?: Record<string, string> } {
    const req: { signal?: AbortSignal; headers?: Record<string, string> } = {};
    if (opts.signal) req.signal = opts.signal;
    // Proxy-only headers: the caller's JWT (Worker verifies it) + a utility-call flag (Worker skips AE
    // injection for it). A utility call still needs the token — both are attached when present.
    if (this.proxyMode && (opts.authToken || opts.utility)) {
      req.headers = {
        ...(opts.authToken ? { authorization: `Bearer ${opts.authToken}` } : {}),
        ...(opts.utility ? { 'x-cubic-request': 'utility' } : {}),
      };
    }
    return req;
  }

  contextWindow(model?: string): number {
    return CONTEXT_WINDOWS[model ?? defaultModel()] ?? DEFAULT_CONTEXT_WINDOW;
  }

  async chat(messages: Message[], opts: ChatOptions): Promise<ChatResponse> {
    const apiMessages: Anthropic.MessageParam[] = messages.map(m => ({ role: m.role, content: toAnthropicContent(m.content) }));
    // Rolling conversation-cache breakpoint + uncached live-state tail (mutates the last message).
    appendLiveStateAndCacheBreakpoint(apiMessages, opts.liveState);

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: opts.model ?? defaultModel(),
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature ?? 1,
      messages: apiMessages,
    };
    // Proxy mode omits the system prompt — the Worker injects it server-side. Direct mode sends it.
    if (opts.systemPrompt !== undefined) params.system = toSystemParam(opts.systemPrompt);

    if (opts.tools?.length) {
      params.tools = opts.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: zodToJsonSchema(t.schema) as Anthropic.Tool['input_schema'],
      }));
      params.tool_choice = { type: 'auto' };
    }

    const response = await this.client.messages.create(params, this.requestOptions(opts));

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
    const params: Anthropic.MessageStreamParams = {
      model: opts.model ?? defaultModel(),
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature ?? 1,
      messages: messages.map(m => ({ role: m.role, content: toAnthropicContent(m.content) })),
    };
    if (opts.systemPrompt !== undefined) params.system = toSystemParam(opts.systemPrompt);
    const stream = await this.client.messages.stream(params, this.requestOptions(opts));

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text', text: event.delta.text };
      }
    }
    yield { type: 'done' };
  }
}
