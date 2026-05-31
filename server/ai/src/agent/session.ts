import type { Message } from '../llm/types.js';

/**
 * Per-conversation agent state. One Session per panel connection. Holds the full
 * message history fed back to the model each turn, plus the run lock and the
 * cancel / steer flags the loop checks between iterations (mirrors Claude Code:
 * a turn can be cancelled, redirected, or steered with a queued message).
 */
export class Session {
  /** Full conversation history (user + assistant + tool_result blocks). */
  messages: Message[] = [];
  /** True while a turn is executing — enforces a single in-flight run. */
  running = false;
  /** Set by a cancel request; checked at each iteration boundary. */
  cancelRequested = false;
  /** A steering message queued mid-run; injected at the next tool-result boundary. */
  pendingMessage: string | null = null;
}
