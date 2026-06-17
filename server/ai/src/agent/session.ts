import type { Message } from '../llm/types.js';

/** A queued steering message. `id` lets the panel target it for edit/remove and
 *  correlate the emitted `steer` event back to the queue row it rendered. */
export interface QueuedMessage {
  id: string;
  text: string;
}

let _seq = 0;
/** Generate a queue-item id when the caller doesn't supply one (backend fallback;
 *  the panel normally owns id generation). Unique within a session's live queue. */
export function nextQueueId(): string {
  return `q${++_seq}`;
}

/**
 * Per-conversation agent state. One Session per panel connection. Holds the full
 * message history fed back to the model each turn, plus the run lock and the
 * cancel / steer flags the loop checks between iterations (mirrors Claude Code:
 * a turn can be cancelled, redirected, or steered with a queued message).
 */
export class Session {
  /** Stable conversation id — the persistence key (JSONL filename) and the `sessions`
   *  Map key. Renderer-minted in Phase 4; defaults to "default" for the legacy CEP path
   *  and existing callers/tests. The session knows its own id; all other shelf metadata
   *  (title, project path, timestamps) lives in the host's persistence store, not here. */
  readonly id: string;
  /** Full conversation history (user + assistant + tool_result blocks). */
  messages: Message[] = [];
  /** True while a turn is executing — enforces a single in-flight run. */
  running = false;
  /** Set by a cancel request; checked at each iteration boundary. */
  cancelRequested = false;
  /** Per-turn abort handle. A cancel/Stop aborts it to interrupt the in-flight model request
   *  immediately (Claude Code-style), rather than waiting for the next iteration boundary. */
  abortController?: AbortController;
  /** Queued steering messages (FIFO). Stacked while a turn runs; drained in order
   *  at each tool-result boundary. Replaces the old single-slot pendingMessage so a
   *  second queued message never silently overwrites a prior one. */
  pendingMessages: QueuedMessage[] = [];
  /**
   * True prefill size of the last chat() call (input + cache-creation + cache-read tokens).
   * Re-checked at each turn boundary to decide whether to auto-compact. 0 until the first call,
   * and reset to 0 after a compaction or /clear (the next real call re-measures it).
   */
  lastContextTokens = 0;

  constructor(id: string = 'default') {
    this.id = id;
  }
}
