/**
 * Subtle, calm indicator shown while history is compacting (an internal memory-trim that adds a brief
 * LLM call mid-turn). Plain-English, no progress bar (compaction is one opaque call). Disappears on done.
 */
export function CompactionPill() {
  return (
    <div className="flex items-center gap-2 py-1 text-[13px] text-white/45">
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/15 border-t-white/60" />
      <span>Tidying up earlier steps…</span>
    </div>
  )
}
