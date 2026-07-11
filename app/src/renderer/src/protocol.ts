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
  | { type: 'snapshot'; ok: boolean; path?: string; turnId?: string; reason?: string }
  | { type: 'text'; text: string }
  | { type: 'tool_start'; id: string; name: string; label: string }
  // `noop` = succeeded but changed nothing; `label` is the outcome-accurate label replacing tool_start's.
  | { type: 'tool_end'; id: string; ok: boolean; errorCode?: string; retried?: boolean; noop?: boolean; label?: string }
  | { type: 'steer'; id: string; text: string }
  // `discarded` = stopped before any output → the turn is thrown away (prompt returns to the composer,
  // no "Stopped" marker). Otherwise a partial turn was kept and the marker is shown.
  | { type: 'cancelled'; discarded?: boolean }
  // `keptTurns` (alongside `summary` on a real 'done') = how many recent turns stayed verbatim. Host-only:
  // the backend uses it to persist the compaction marker + reconstruct the model context on reopen. The
  // renderer ignores it — the divider is placed at the compaction moment (before the triggering prompt).
  | { type: 'compaction'; status: 'start' | 'done' | 'failed'; reason?: string; summary?: string; keptTurns?: number }
  | { type: 'context_full'; message: string }
  // `status` = the proxy's HTTP status (401 signed-out / 402 not-paid-or-over-cap / 429 rate-limited);
  // `reason` = the machine-readable 402 sub-state ('no_plan' | 'over_cap' | 'past_due') the paywall
  // routes on (§C-6/§D).
  | { type: 'error'; message: string; status?: number; reason?: 'no_plan' | 'over_cap' | 'past_due' | string }
  | { type: 'done'; stopReason: string }

// ── Display model (one shape for history + live turn) ──
export type ToolStatus = 'running' | 'ok' | 'fail' | 'noop'
export type DisplayItem =
  // `turnId` (when present) ties this prompt to its pre-turn backup → the "restore to before this
  // request" affordance. Absent on steers + old/untagged turns.
  | { kind: 'user'; text: string; turnId?: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id: string; label: string; status: ToolStatus }
  // A successful auto-compaction left a viewable recap — collapsible "View summary" row. Rendered both
  // live and on reload (mirrors displayItems.ts: a persisted `_compaction` marker reproduces it).
  | { kind: 'compaction'; summary: string }
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
  // `token` = the user's fresh Supabase access token, attached per send so the Worker can verify it
  // (WT-PROXY-GATING §A-4). Absent in local/signed-out; the proxy is only hit in prod.
  | { type: 'userChat'; sessionId: string; text: string; token?: string }
  | { type: 'cancel'; sessionId: string }
  | { type: 'queue'; sessionId: string; text: string; id: string }
  | { type: 'editQueue'; sessionId: string; text: string; id: string }
  | { type: 'removeQueue'; sessionId: string; id: string }
  | { type: 'attach'; sessionId: string }
  | { type: 'delete'; sessionId: string }
  | { type: 'rename'; sessionId: string; title: string }
  | { type: 'list' }
  | { type: 'loadHistory'; sessionId: string }
  | { type: 'restore'; sessionId: string; turnId: string }

// ── Backend → renderer ──
export type ServerMessage =
  | { type: 'agentEvent'; sessionId: string; event: AgentEvent }
  // `userText` = the in-flight turn's prompt (only when running) — it isn't committed to history yet
  // and isn't an event, so the reattaching renderer needs it to show the prompt bubble.
  | { type: 'attached'; sessionId: string; running: boolean; events: AgentEvent[]; userText?: string }
  | { type: 'conversations'; projectPath: string; conversations: ConversationMeta[] }
  | { type: 'history'; sessionId: string; items: DisplayItem[]; running: boolean }
  // Reply to a `restore`: ok → the project + transcript were rewound; !ok → `message` says why.
  | { type: 'restored'; sessionId: string; ok: boolean; message?: string }
  // Live After Effects bridge (CEP worker) connectivity. Pushed once on connect (alongside the `list`
  // reply) so a fresh renderer has a correct value, then on every bridge connect/disconnect. Drives the
  // always-on status dot — distinct from `connection` (the renderer↔backend link in ws.ts).
  | { type: 'aeStatus'; connected: boolean }
