import type { AnthropicUsage } from './metering.js';

/**
 * Pull Anthropic's token counts out of a response body (§A-6). Handles both shapes:
 *  - non-streaming JSON (today's path — the loop uses `messages.create`): read `.usage` off the object.
 *  - streaming SSE (forward-compat for the later `chat()`→`stream()` swap): `input`/cache tokens land in
 *    `message_start`; the final cumulative `output_tokens` lands in `message_delta`.
 * Reads the WHOLE (teed) body to completion — this is the metering branch, so consuming it fully also
 * relieves backpressure on the client branch. Returns null when no usage is present.
 */
export async function parseUsageFromResponse(
  body: ReadableStream<Uint8Array> | null,
  contentType: string,
): Promise<AnthropicUsage | null> {
  if (!body) return null;
  // P5W2 audit (L5, latent): buffers the WHOLE teed body before parsing. Fine today (non-streaming
  // `messages.create` always completes), but once streaming lands (`chat()`→`stream()`) a client abort
  // mid-stream means `message_delta` never arrives → this records ZERO usage. When streaming ships,
  // parse incrementally as chunks arrive (reuse parseSse's running output_tokens accumulator) so an
  // aborted stream still meters what was generated. Tracked in TODOS/POSTMVP.md.
  const text = await new Response(body).text();
  return contentType.includes('text/event-stream') ? parseSse(text) : parseJson(text);
}

function parseJson(text: string): AnthropicUsage | null {
  try {
    const obj = JSON.parse(text) as { usage?: AnthropicUsage };
    return obj.usage ?? null;
  } catch {
    return null;
  }
}

function parseSse(text: string): AnthropicUsage | null {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreate = 0;
  let cacheRead = 0;
  let seen = false;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let ev: {
      type?: string;
      message?: { usage?: Record<string, number> };
      usage?: Record<string, number>;
    };
    try {
      ev = JSON.parse(payload);
    } catch {
      continue;
    }
    // message_start carries the input side (+ cache tiers) and an initial output_tokens.
    if (ev.type === 'message_start' && ev.message?.usage) {
      const u = ev.message.usage;
      inputTokens = u.input_tokens ?? 0;
      cacheCreate = u.cache_creation_input_tokens ?? 0;
      cacheRead = u.cache_read_input_tokens ?? 0;
      outputTokens = u.output_tokens ?? 0;
      seen = true;
    // message_delta carries the running/final cumulative output_tokens.
    } else if (ev.type === 'message_delta' && ev.usage) {
      outputTokens = ev.usage.output_tokens ?? outputTokens;
      seen = true;
    }
  }
  if (!seen) return null;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_input_tokens: cacheCreate,
    cache_read_input_tokens: cacheRead,
  };
}
