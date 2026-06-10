## General Roadmap
✅ Phase 1 — MCP validation
✅ Phase 1.5 — Fix the MCP + finish all functionality I need + organize CRUD per operation + comprehensive testing suite
✅ Phase 2 — LLM brain + agent architecture (system prompt + Claude API backend) **and** the agent loop / self-healing loop (item 4): tool-execution loop, self-heal on errors, pre-turn backup snapshot, live narration, cancel/steer. Built + unit-tested; live run against AE (`npm run test:agent`) is the one remaining check.
   ↳ No separate Phase 3 — what I'd loosely planned as "Phase 3" (the self-healing/correcting loop) was absorbed here as Phase 2 item 4.
⬜ Phase 4 — **Standalone Electron desktop app** (chat UI) + **thin headless AE bridge** (the CEP extension demoted to `evalScript` dispatch only). The app consumes the agentEvent protocol, hosts the Node backend as a child process, auto-installs the AE bridge on first run, + seamless backup recovery (restore button + "Cubic, undo that"). Decision recorded in TODO-phase4.md — NOT an in-AE panel anymore.
⬜ Phase 5 — Pre-ship gate (nothing ships to anyone until ALL of these): hosted LLM proxy that holds the API key + injects the system prompt server-side, code obfuscation + binary packaging, and Stripe billing. **Push updates to users** = `electron-updater` (auto-update feed + staged rollouts/beta channel) now that the UI is an Electron app; this is also when app signing/notarization gets turned on. Full checklist → **`TODO-phase5.md`**.

---
# somewhat post mvp, maybe during (billing/usage limiting)
- System prompt, web verify the after effects standard conventions for smooth/juicy/bouncy settings for the good saas videos
- Take inspo from good looking after effects youtube video tutorials
- Maybe inspo from gaming montages as well? (since those are usually edited well)

# post mvp
True token-level streaming + tool events
  WHY: Smoothest 'typing' feel, most like Claude Code. WHY NOT: Must rebuild
  stream() to pass tools + accumulate tool_use JSON deltas + reconcile with
  the loop — meaningfully more code and edge cases. Polish you can add
  post-MVP without changing the loop's shape.

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

