import { getLLM } from '../llm/index.js';
import type { LLMProvider, Message, ChatResponse } from '../llm/types.js';
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
): Promise<{ ok: boolean; reason?: string }> {
  const keepRecentTurns = opts.keepRecentTurns ?? KEEP_RECENT_TURNS;
  const cut = findCompactionCut(session.messages, keepRecentTurns);
  if (!cut) return { ok: true, reason: 'nothing-to-compact' };

  const llm = opts.llm ?? getLLM();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await llm.chat(cut.toSummarize, {
        systemPrompt: SUMMARY_SYSTEM_PROMPT,
        model: opts.model,
        maxTokens: 2048,
      });
      session.messages = [buildSummaryMessage(res.content), ...cut.toKeep];
      session.lastContextTokens = 0;
      return { ok: true };
    } catch (e) {
      if (attempt === 1) return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
  return { ok: false, reason: 'unreachable' };
}
