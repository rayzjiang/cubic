import { getLLM } from '../llm/index.js';
import type { LLMProvider, Message, ChatResponse, ContentBlock } from '../llm/types.js';
import type { Session } from './session.js';

// ─── Policy ────────────────────────────────────────────────────────────────────
// The model's context WINDOW is provider metadata (llm.contextWindow(model)) — NOT here.
// These are policy knobs: when to compact, when to give up, and how much to keep verbatim.
export const COMPACT_THRESHOLD = 0.9; // ≥90% of the window → auto-compact at the next turn
export const HARD_CEILING = 0.97;     // ≥97% → emergency pause (can't compact our way out)
export const KEEP_RECENT_TURNS = 3;   // recent user prompts kept word-for-word

/**
 * True prefill size of a call. The system prompt is cached, so plain `inputTokens` undercounts
 * (the cached rules+catalog show up under cacheRead). Summing all three reconstructs the real
 * context size — which is what actually overflows the window.
 */
export function contextTokensOf(u: ChatResponse['usage']): number {
  return u.inputTokens + (u.cacheCreationInputTokens ?? 0) + (u.cacheReadInputTokens ?? 0);
}

/** A genuine user prompt (string content) — the only place it's safe to cut history. */
function isSafeBoundary(m: Message): boolean {
  return m.role === 'user' && typeof m.content === 'string';
}

/**
 * Finds a pairing-safe split so the most-recent `keepRecentTurns` user prompts stay verbatim.
 * We only ever cut at a string-content user message: a user message with a ContentBlock[] carries
 * tool_result blocks that must stay paired with the preceding assistant tool_use, so cutting there
 * would orphan a tool_use/tool_result. Cutting at a string-user boundary guarantees the kept slice
 * starts with a real prompt and no pair is ever split.
 *
 * Returns null when there's nothing worth (or safe) to summarize — caller treats that as a no-op.
 */
export function findCompactionCut(
  messages: Message[],
  keepRecentTurns: number,
): { toSummarize: Message[]; toKeep: Message[]; cutIndex: number } | null {
  let seen = 0;
  let cutIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isSafeBoundary(messages[i])) {
      seen++;
      if (seen === keepRecentTurns) { cutIndex = i; break; }
    }
  }
  // Need a boundary found, and something older than it to actually summarize.
  if (cutIndex <= 0) return null;
  return { toSummarize: messages.slice(0, cutIndex), toKeep: messages.slice(cutIndex), cutIndex };
}

export const SUMMARY_SYSTEM_PROMPT = `You are summarizing an in-progress conversation between a motion designer and an AI assistant that builds animations inside Adobe After Effects on the user's behalf.

Another instance of the assistant will read ONLY your summary (not the original messages) to continue the conversation seamlessly. Capture everything needed to pick up exactly where this left off. Be specific and concrete — prefer names, layer indices, composition names, property values, and timings over vague description. Do not invent details that are not present in the conversation.

Write the summary as Markdown with these sections, in this order:

## Goal
The user's overall creative intent — what they are ultimately trying to make.

## Project state
What currently exists or has been changed in the After Effects project so far: compositions created or modified, layers added/renamed/deleted (with names and indices), key property values set (position, scale, opacity, effects), and any keyframes or expressions applied.

## Style & preferences
Stylistic decisions and standing preferences the user has expressed or implied: easing/interpolation choices, timing and pacing, naming conventions, color, and any "always do X / never do Y" instructions.

## Problems & resolutions
Errors, failures, or misunderstandings encountered and how they were resolved (or that they remain open). Note anything that did NOT work so it isn't retried blindly.

## Next steps
Written as if continuing the conversation: what the user asked for or wanted to do next, and the immediate action the assistant should take. If the user's last message was a pending request, restate it precisely here.

Keep it tight — omit pleasantries and narration. Output only the Markdown summary.`;

/** The synthetic message that replaces the summarized prefix. A string-user message, so it's
 *  itself a safe boundary, and XML-wrapped per the repo's context-injection convention. */
export function buildSummaryMessage(summaryText: string): Message {
  return { role: 'user', content: `<conversation_summary>\n${summaryText}\n</conversation_summary>` };
}

/** Max chars of a single tool_result kept in the transcript — enough to carry the concrete values
 *  (layer indices, property values) the summary prompt asks for, without one huge dump bloating the call. */
const MAX_RESULT_CHARS = 800;

/**
 * Flatten the to-summarize turns into a plain-text transcript. CRITICAL: this is sent as a single
 * USER message so the summary request ends on a user turn. A turn-boundary cut's prefix always ends
 * on an ASSISTANT message; forwarding those raw, the API treats that trailing assistant turn as a
 * prefill to continue and Claude returns an EMPTY continuation instead of a summary (the compaction
 * bug). Includes tool calls + (truncated) results so the recap can cite real values, not just prose.
 */
export function renderTranscript(messages: Message[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const who = m.role === 'user' ? 'User' : 'Assistant';
    if (typeof m.content === 'string') {
      const text = m.content.trim();
      if (text) lines.push(`${who}: ${text}`);
      continue;
    }
    for (const block of m.content as ContentBlock[]) {
      if (block.type === 'text') {
        const text = block.text.trim();
        if (text) lines.push(`${who}: ${text}`);
      } else if (block.type === 'tool_use') {
        lines.push(`Assistant ran ${block.name}(${JSON.stringify(block.input)})`);
      } else if (block.type === 'tool_result') {
        const raw = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
        const clipped = raw.length > MAX_RESULT_CHARS ? `${raw.slice(0, MAX_RESULT_CHARS)}…(truncated)` : raw;
        lines.push(`Result${block.is_error ? ' (error)' : ''}: ${clipped}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Summarizes older turns into one synthetic message, keeping the last `keepRecentTurns` verbatim.
 * Retries the summary call once. On success, rewrites session.messages in place and resets
 * lastContextTokens (the next real chat() re-measures it). On failure leaves history untouched
 * and returns { ok: false } — the caller decides what to do (the loop continues; ~10% headroom
 * remains at the 90% trigger).
 */
export async function compactSession(
  session: Session,
  opts: { llm?: LLMProvider; keepRecentTurns?: number; model?: string } = {},
): Promise<{ ok: boolean; reason?: string; summary?: string; keptTurns?: number }> {
  const keepRecentTurns = opts.keepRecentTurns ?? KEEP_RECENT_TURNS;
  const cut = findCompactionCut(session.messages, keepRecentTurns);
  if (!cut) return { ok: true, reason: 'nothing-to-compact' };

  const llm = opts.llm ?? getLLM();
  // The older turns flattened to text and sent as ONE user message → the request ends on a user turn
  // (see renderTranscript). XML-wrapped per the repo's context-injection convention.
  const transcript = renderTranscript(cut.toSummarize);
  const summaryRequest: Message[] = [
    { role: 'user', content: `Summarize the conversation below so another assistant can continue it seamlessly.\n\n<conversation_transcript>\n${transcript}\n</conversation_transcript>` },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await llm.chat(summaryRequest, {
        systemPrompt: SUMMARY_SYSTEM_PROMPT,
        model: opts.model,
        maxTokens: 2048,
      });
      const summary = res.content.trim();
      // Guard: never replace real history with a blank summary — that silently destroys context (the
      // bug's worst symptom). A blank result is a failed attempt: retry, then leave history untouched.
      if (!summary) { if (attempt === 1) return { ok: false, reason: 'empty-summary' }; continue; }
      session.messages = [buildSummaryMessage(summary), ...cut.toKeep];
      session.lastContextTokens = 0;
      // Return the summary text so the loop can surface it to the UI (the "View summary" row), plus
      // keptTurns so the host can resolve the on-disk cut boundary (the first kept-verbatim turn) when
      // it persists the compaction marker — the brain has no turnIds, so it reports the count instead.
      return { ok: true, summary, keptTurns: keepRecentTurns };
    } catch (e) {
      if (attempt === 1) return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
  return { ok: false, reason: 'unreachable' };
}
