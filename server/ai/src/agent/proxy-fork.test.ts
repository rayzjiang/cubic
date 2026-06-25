import { describe, it, expect, afterEach } from 'vitest';
import { runAgentTurn, type AgentDeps } from './loop.js';
import { Session } from './session.js';
import type { ChatOptions, ChatResponse, LLMProvider, Message } from '../llm/types.js';

/**
 * WT-PROXY-CORE — the CUBIC_ENV fork (loop.ts). In proxy mode (CUBIC_ENV=prod) the
 * loop sends a BARE request (no system, no tools) so the Worker injects the crown
 * jewels server-side. In direct-local mode it builds + sends them itself.
 */

const nullState = { project: null, activeComp: null, playhead: null, frame: null, selectedLayers: [] };

/** Mock provider that records the ChatOptions of every call and returns one text turn. */
function captureLLM() {
  const opts: ChatOptions[] = [];
  const provider: LLMProvider = {
    chat: async (_messages: Message[], o: ChatOptions): Promise<ChatResponse> => {
      opts.push(o);
      return { content: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 }, toolUses: [] };
    },
    // eslint-disable-next-line require-yield
    stream: async function* () { yield { type: 'done' as const }; },
    contextWindow: () => 200_000,
  };
  return { provider, opts };
}

function deps(llm: LLMProvider): Partial<AgentDeps> {
  return {
    llm,
    executeTool: async (t) => ({ block: { type: 'tool_result', tool_use_id: t.id, content: '{}' }, ok: true, retried: false }),
    buildContext: async () => nullState,
    takeSnapshot: false,
    // NOTE: do NOT inject buildSystemPrompt — we want the loop's real @secrets default
    // so the test exercises the actual direct-local prompt assembly.
  };
}

const PRIOR = process.env.CUBIC_ENV;
afterEach(() => {
  if (PRIOR === undefined) delete process.env.CUBIC_ENV;
  else process.env.CUBIC_ENV = PRIOR;
});

describe('CUBIC_ENV fork', () => {
  it('proxy mode (prod): sends NO system prompt and NO tools — the Worker injects them', async () => {
    process.env.CUBIC_ENV = 'prod';
    const { provider, opts } = captureLLM();
    await runAgentTurn(new Session(), 'hello', () => {}, deps(provider));
    expect(opts).toHaveLength(1);
    expect(opts[0].systemPrompt).toBeUndefined();
    expect(opts[0].tools).toBeUndefined();
  });

  it('direct-local mode (local): sends the locally-built system prompt + the full tool catalog', async () => {
    process.env.CUBIC_ENV = 'local';
    const { provider, opts } = captureLLM();
    await runAgentTurn(new Session(), 'hello', () => {}, deps(provider));
    expect(opts).toHaveLength(1);
    expect(opts[0].systemPrompt).toBeDefined();
    // Real AE_TOOLS from the proxy secrets (runScript / batch / createComposition).
    expect(opts[0].tools?.map((t) => t.name)).toEqual(['runScript', 'batch', 'createComposition']);
  });
});
