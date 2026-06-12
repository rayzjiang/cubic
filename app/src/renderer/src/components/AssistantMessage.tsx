/**
 * Assistant narration, full-width (no bubble). Plain text for now; Step 5 swaps the body for
 * react-markdown + remark-gfm inside the same wrapper (the `.md-body` class is the future seam).
 */
export function AssistantMessage({ text }: { text: string }) {
  return <div className="md-body text-[14px] leading-relaxed whitespace-pre-wrap text-white/85">{text}</div>
}
