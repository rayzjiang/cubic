import { describeToolCall, type Message, type ContentBlock } from "cubic-ai";

/**
 * Display-model contract shared with the renderer (mirrored in app/src/renderer/src/protocol.ts —
 * the renderer can't import this Node module). One flat list of items renders a conversation; the
 * renderer's live `agentEvent` reducer produces the SAME shape, so history and the live turn share
 * one render path (no second component tree, no label drift — both label via describeToolCall).
 */
export type ToolStatus = "running" | "ok" | "fail";

export type DisplayItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; label: string; status: ToolStatus };

/** A committed turn's tool failed iff its matching tool_result carried is_error. */
function isErrorById(messages: Message[]): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if (block.type === "tool_result") map.set(block.tool_use_id, block.is_error === true);
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
 * History is always settled, so tool status is `ok`/`fail` (never `running`).
 */
export function messagesToDisplayItems(messages: Message[]): DisplayItem[] {
  const errs = isErrorById(messages);
  const items: DisplayItem[] = [];

  for (const m of messages) {
    if (typeof m.content === "string") {
      const text = m.content.trim();
      if (!text) continue;
      // The synthetic compaction summary is an in-memory artifact; the JSONL store is the full
      // untrimmed history so it shouldn't appear, but guard against it (never render it as a prompt).
      if (m.role === "user" && text.startsWith("<conversation_summary>")) continue;
      items.push({ kind: m.role === "user" ? "user" : "assistant", text });
      continue;
    }
    for (const block of m.content as ContentBlock[]) {
      if (block.type === "text") {
        const text = block.text.trim();
        if (text) items.push({ kind: m.role === "user" ? "user" : "assistant", text });
      } else if (block.type === "tool_use") {
        items.push({
          kind: "tool",
          id: block.id,
          label: describeToolCall(block.name, block.input),
          status: errs.get(block.id) ? "fail" : "ok",
        });
      }
      // tool_result blocks are folded into the matching tool_use's status above — not rendered.
    }
  }
  return items;
}
