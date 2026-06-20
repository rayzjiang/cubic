import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { DURATION, EASE_EXPO, useMotion } from '../motion'
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
  const { reduce } = useMotion()

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
      {/* Recap expands on the expo curve (fast-then-settle). Motion measures height:auto for us, and
          overflow-hidden clips the content mid-tween. Mounts on open / unmounts on close. */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="recap"
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduce ? DURATION.fast : DURATION.slow, ease: EASE_EXPO }}
          >
            <div
              onClick={collapseUnlessSelecting}
              className="mt-2 select-text rounded-lg border border-white/5 bg-white/[0.03] px-3.5 py-2.5"
            >
              <AssistantMessage text={summary} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
