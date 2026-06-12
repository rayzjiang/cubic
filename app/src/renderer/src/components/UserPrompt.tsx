/**
 * A user prompt, Cursor-style: a subtle bordered/tinted container that marks where a request starts.
 * No avatar, no bubble — the assistant response flows full-width below it.
 */
export function UserPrompt({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-[14px] whitespace-pre-wrap text-white/90">
      {text}
    </div>
  )
}
