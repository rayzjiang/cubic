/**
 * Renderer-side mirror of the backend chat wire contract. The renderer is sandboxed and can't
 * import the Node packages, so these plain serializable types mirror their sources 1:1:
 *   - AgentEvent       → server/ai/src/agent/events.ts
 *   - DisplayItem      → server/ae-bridge/src/displayItems.ts
 *   - ConversationMeta → server/ae-bridge/src/persist.ts
 *   - the wire messages → server/ae-bridge/src/bridge/wsBridge.ts + agentChat.ts (see PROTOCOL.md)
 * Keep in sync with those files (PROTOCOL.md is the human-readable contract).
 */

// ── Live turn events (backend → renderer, wrapped in an `agentEvent` envelope) ──
export type AgentEvent =
  | { type: 'turn_start' }
  | { type: 'snapshot'; ok: boolean; path?: string; reason?: string }
  | { type: 'text'; text: string }
  | { type: 'tool_start'; id: string; name: string; label: string }
  // `noop` = succeeded but changed nothing; `label` is the outcome-accurate label replacing tool_start's.
  | { type: 'tool_end'; id: string; ok: boolean; errorCode?: string; retried?: boolean; noop?: boolean; label?: string }
  | { type: 'steer'; id: string; text: string }
  // `discarded` = stopped before any output → the turn is thrown away (prompt returns to the composer,
  // no "Stopped" marker). Otherwise a partial turn was kept and the marker is shown.
  | { type: 'cancelled'; discarded?: boolean }
  | { type: 'compaction'; status: 'start' | 'done' | 'failed'; reason?: string }
  | { type: 'context_full'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done'; stopReason: string }

// ── Display model (one shape for history + live turn) ──
export type ToolStatus = 'running' | 'ok' | 'fail' | 'noop'
export type DisplayItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id: string; label: string; status: ToolStatus }
  // The user stopped this turn — rendered as a muted "Stopped" divider (not a chat bubble).
  | { kind: 'interrupted' }

// ── Conversation metadata (drives the sidebar/home list) ──
export interface ConversationMeta {
  id: string
  title: string
  projectPath: string
  lastActivity: number
  renamed: boolean
}

// ── Renderer → backend (the server's ChatInbound union) ──
export type ClientMessage =
  | { type: 'userChat'; sessionId: string; text: string }
  | { type: 'cancel'; sessionId: string }
  | { type: 'queue'; sessionId: string; text: string; id: string }
  | { type: 'editQueue'; sessionId: string; text: string; id: string }
  | { type: 'removeQueue'; sessionId: string; id: string }
  | { type: 'attach'; sessionId: string }
  | { type: 'delete'; sessionId: string }
  | { type: 'list' }
  | { type: 'loadHistory'; sessionId: string }

// ── Backend → renderer ──
export type ServerMessage =
  | { type: 'agentEvent'; sessionId: string; event: AgentEvent }
  // `userText` = the in-flight turn's prompt (only when running) — it isn't committed to history yet
  // and isn't an event, so the reattaching renderer needs it to show the prompt bubble.
  | { type: 'attached'; sessionId: string; running: boolean; events: AgentEvent[]; userText?: string }
  | { type: 'conversations'; projectPath: string; conversations: ConversationMeta[] }
  | { type: 'history'; sessionId: string; items: DisplayItem[]; running: boolean }
