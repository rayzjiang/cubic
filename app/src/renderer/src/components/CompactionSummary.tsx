import { useState } from 'react'
import { AssistantMessage } from './AssistantMessage'

/**
 * A settled compaction left in the transcript: a muted "Tidied up earlier steps" divider with a
 * "View summary" toggle (mirrors ErrorNotice's expander). Expanding reveals the AI's recap of the
 * trimmed-away turns, rendered as Markdown (same component as normal assistant replies). Collapsed by
 * default — it's an at-rest record, not something demanding attention. Live-session only.
 */
export function CompactionSummary({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="text-[12px]">
      <div className="flex items-center gap-2 text-white/30">
        <span className="h-px flex-1 bg-white/10" />
        <span>Tidied up earlier steps</span>
        <button onClick={() => setOpen((v) => !v)} className="text-white/40 hover:text-white/70">
          {open ? 'Hide summary' : 'View summary'}
        </button>
        <span className="h-px flex-1 bg-white/10" />
      </div>
      {open && (
        <div className="mt-2 rounded-lg border border-white/5 bg-white/[0.03] px-3.5 py-2.5">
          <AssistantMessage text={summary} />
        </div>
      )}
    </div>
  )
}
