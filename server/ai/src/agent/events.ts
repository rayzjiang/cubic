import type { ToolUse } from '../llm/types.js';

// ─── Agent turn events ─────────────────────────────────────────────────────────
// Streamed to the panel as a turn runs (narrate-as-you-work, like Claude Code).
// Per-iteration granularity: assistant narration is pushed whole after each model
// call; tool activity is pushed as a start/end pair around each execution. Upgrading
// to token-level streaming later swaps chat()→stream() inside the loop without
// changing this event shape.

export type AgentEvent =
  | { type: 'turn_start' }
  | { type: 'snapshot'; ok: boolean; path?: string; reason?: string }
  | { type: 'text'; text: string }
  | { type: 'tool_start'; id: string; name: string; label: string }
  | { type: 'tool_end'; id: string; ok: boolean; errorCode?: string; retried?: boolean }
  | { type: 'steer'; text: string }
  | { type: 'cancelled' }
  // History compaction: older turns summarized to stay under the context window. 'done' also
  // covers a /clear (reason: 'cleared'). 'failed' is a soft notice — the turn still proceeds.
  | { type: 'compaction'; status: 'start' | 'done' | 'failed'; reason?: string }
  // Hard ceiling: compaction can't free enough room, so the turn is paused. A call-to-action
  // (start a new conversation), NOT an error — the panel renders it differently.
  | { type: 'context_full'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done'; stopReason: string };

export type EmitFn = (event: AgentEvent) => void;

/**
 * Human-readable label for a tool call, shown in the panel's activity row
 * (e.g. "createLayer", "create composition \"Intro\"", "batch (3 commands)").
 * Never exposes raw tool JSON.
 */
export function describeToolCall(name: string, input: unknown): string {
  const obj = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'runScript':
      return String(obj.script ?? 'runScript');
    case 'batch': {
      const n = Array.isArray(obj.commands) ? obj.commands.length : 0;
      return obj.groupLabel ? String(obj.groupLabel) : `batch (${n} command${n === 1 ? '' : 's'})`;
    }
    case 'createComposition':
      return obj.name ? `create composition "${String(obj.name)}"` : 'create composition';
    default:
      return name;
  }
}

export type { ToolUse };
