## General Roadmap
✅ Phase 1 — MCP validation
✅ Phase 1.5 - **Fixing the MCP + Finishing/adding all functionality that I need + Organizing it for CRUD for each operation + Comprehensive testing suite
➡️ Phase 2 — Build the LLM brain + agent architecture (system prompt + Claude API backend)
Phase 3 (self-healing/correcting/bug checking loop)
Phase 4 (After effects panel UI)
Phase 5 (Post MVP stuff?)

---
# Distribution steps (post mvp)
1. Obfuscation (meaningful protection, not foolproof)
    - Run javascript-obfuscator on the bundled JSX + compiled MCP server before distribution
    - Makes casual reading/copying painful; deters 95% of people
    - Determined reverse engineers can still work through it

2. Package the MCP server as a binary
    - Tools like pkg or nexe bundle Node.js + your JS into a single executable
    - Much harder to reverse engineer than plain JS
    - This is actually realistic for your MCP server specifically

---

# post mvp (hot swappable models)
Do later. Design for it now by keeping all LLM calls behind a single wrapper (one file to change).

How Cursor does it: direct provider SDKs (Anthropic SDK, OpenAI SDK, Google SDK) + their own
adapter interface — NOT Vercel AI SDK. Reason: need direct access to provider-specific features
(extended thinking, o1 reasoning, etc.) that abstraction layers lag on.

  interface LLMProvider {
    chat(messages, opts): Promise<Response>
    stream(messages, opts): AsyncIterable<Chunk>
  }
  class AnthropicProvider implements LLMProvider { ... }
  class OpenAIProvider implements LLMProvider { ... }

For MVP: implement AnthropicProvider only. Add others when needed.

# somewhat post mvp (billing/usage limiting)
Model: you own ONE Anthropic API key. All user requests go through your key — you pay Anthropic's
bill. Users pay you via Stripe monthly subscription. Margin = what you charge - what Anthropic charges.

Typical economics (Cursor-like):
  - Charge users: ~$15-20/mo
  - Anthropic cost per avg user: ~$3-8/mo (use Sonnet for most ops, Haiku for routing)
  - Margin: ~60-85%

Usage model: Cursor's "monthly credit pool where heavier models drain faster" is better than
time-based limits (Claude Code style). Power users who use Opus pay effectively more — fair.
Route simple tasks to Haiku, complex to Sonnet. Soft-cap heavy usage.

For MVP: single API key, no billing, no limits. Build billing in Phase 5 (right before i ship)