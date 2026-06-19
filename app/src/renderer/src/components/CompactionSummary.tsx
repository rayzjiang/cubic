import { useState } from 'react'
import { AssistantMessage } from './AssistantMessage'

/**
 * A settled compaction left in the transcript: a muted "Summarized earlier steps" divider with a
 * "View summary" toggle. Expanding reveals the AI's recap of the trimmed-away turns, rendered as
 * Markdown (same component as normal assistant replies). The recap animates open/closed — height +
 * fade on an ease-out-expo curve (nonlinear, fast-then-settle). Clicking the recap box collapses it,
 * UNLESS the user is selecting text, so the summary stays highlight/copy-paste-able. Collapsed by
 * default — an at-rest record, not something demanding attention. Rendered live and on reload.
 */
export function CompactionSummary({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false)

  // Click the box to collapse it — but ignore the click while the user is selecting text, so they can
  // highlight + copy from the summary without it snapping shut under them.
  const collapseUnlessSelecting = () => {
    if (window.getSelection()?.toString()) return
    setOpen(false)
  }

  return (
    <div className="text-[12px]">
      <div className="flex items-center gap-2 text-white/30">
        <span className="h-px flex-1 bg-white/10" />
        <span>Summarized earlier steps</span>
        <button onClick={() => setOpen((v) => !v)} className="text-white/40 hover:text-white/70">
          {open ? 'Hide summary' : 'View summary'}
        </button>
        <span className="h-px flex-1 bg-white/10" />
      </div>
      {/* grid-rows 0fr→1fr animates the real height with no JS measuring; the inner div clips the
          overflow mid-transition. The recap is always mounted (so it can animate), just collapsed. */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div
            onClick={collapseUnlessSelecting}
            className={`mt-2 select-text rounded-lg border border-white/5 bg-white/[0.03] px-3.5 py-2.5 transition-opacity duration-300 ${
              open ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <AssistantMessage text={summary} />
          </div>
        </div>
      </div>
    </div>
  )
}
