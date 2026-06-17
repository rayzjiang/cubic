import { describeToolCall, describeToolNoop, describeToolResult, INTERRUPTED_MARKER, type Message, type ContentBlock } from "cubic-ai";

/**
 * Display-model contract shared with the renderer (mirrored in app/src/renderer/src/protocol.ts —
 * the renderer can't import this Node module). One flat list of items renders a conversation; the
 * renderer's live `agentEvent` reducer produces the SAME shape, so history and the live turn share
 * one render path (no second component tree, no label drift — both label via describeToolCall).
 */
// "noop" = the call succeeded but changed nothing (handler returned status:"noop"); rendered neutral.
export type ToolStatus = "running" | "ok" | "fail" | "noop";

export type DisplayItem =
  // `turnId` (when present) ties this prompt to its pre-turn backup → the "restore to before this
  // request" affordance. Absent on steers + old/untagged turns (no restore target).
  | { kind: "user"; text: string; turnId?: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; label: string; status: ToolStatus }
  // The user stopped this turn — rendered as a muted "Stopped" divider (not a chat bubble).
  | { kind: "interrupted" };

type ToolOutcome = { status: "ok" | "fail" | "noop"; result?: unknown };

/**
 * A committed turn's tool outcome, from its matching tool_result: "fail" iff is_error; otherwise
 * "noop" iff the result JSON carried status:"noop" (changed nothing); else "ok". Absent → "ok".
 * Also keeps the parsed result JSON so the row can be labeled from the handler's resolved
 * names/values (describeToolResult) exactly like the live path does.
 */
function outcomeById(messages: Message[]): Map<string, ToolOutcome> {
  const map = new Map<string, ToolOutcome>();
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if (block.type !== "tool_result") continue;
      if (block.is_error === true) { map.set(block.tool_use_id, { status: "fail" }); continue; }
      let result: unknown;
      try {
        const raw = typeof block.content === "string" ? block.content : "";
        result = raw ? JSON.parse(raw) : undefined;
      } catch { /* non-JSON content → treat as ok with no result */ }
      const status = (result as { status?: string } | undefined)?.status;
      map.set(block.tool_use_id, { status: status === "noop" ? "noop" : "ok", result });
    }
  }
  return map;
}

/**
 * Transform a conversation's full committed `Message[]` (read from the JSONL store, always the
 * untrimmed history) into renderable `DisplayItem[]`. Mirrors the committed shape the loop writes:
 *   user(string)                         → a real prompt
 *   user(ContentBlock[])                 → tool_results (skipped — consumed below) + steer text
 *   assistant(string | ContentBlock[])   → narration text + tool_use calls
 * History is always settled, so tool status is `ok`/`fail`/`noop` (never `running`).
 */
export function messagesToDisplayItems(messages: Message[]): DisplayItem[] {
  const outcomes = outcomeById(messages);
  const items: DisplayItem[] = [];

  for (const m of messages) {
    if (typeof m.content === "string") {
      const text = m.content.trim();
      if (!text) continue;
      // A stopped turn was committed as an assistant-role interruption sentinel → render the muted
      // "Stopped" divider instead of an assistant bubble.
      if (m.role === "assistant" && text === INTERRUPTED_MARKER) {
        items.push({ kind: "interrupted" });
        continue;
      }
      // The synthetic compaction summary is an in-memory artifact; the JSONL store is the full
      // untrimmed history so it shouldn't appear, but guard against it (never render it as a prompt).
      if (m.role === "user" && text.startsWith("<conversation_summary>")) continue;
      if (m.role === "user") {
        // Carry the persisted turnId (appendTurn tags the prompt line) onto the prompt → restore target.
        const turnId = (m as { _turnId?: string })._turnId;
        items.push(turnId ? { kind: "user", text, turnId } : { kind: "user", text });
        continue;
      }
      items.push({ kind: "assistant", text });
      continue;
    }
    for (const block of m.content as ContentBlock[]) {
      if (block.type === "text") {
        const text = block.text.trim();
        if (text) items.push({ kind: m.role === "user" ? "user" : "assistant", text });
      } else if (block.type === "tool_use") {
        const outcome = outcomes.get(block.id) ?? { status: "ok" as const };
        const label =
          outcome.status === "noop"
            ? describeToolNoop(block.name, block.input)
            : outcome.status === "ok"
              ? describeToolResult(block.name, block.input, outcome.result)
              : describeToolCall(block.name, block.input); // fail → input-based label
        items.push({ kind: "tool", id: block.id, label, status: outcome.status });
      }
      // tool_result blocks are folded into the matching tool_use's status above — not rendered.
    }
  }
  return items;
}
