import { AnimatePresence, motion } from 'motion/react'
import { useChatStore } from '../store'
import { EASE_OUT, useMotion } from '../motion'

/** Filename only — the full path is noise to a video editor (e.g. "MyEdit_v2.aep"). */
const baseName = (p: string): string => p.split('/').pop() || p || 'an untitled project'

/**
 * Slim, non-blocking bar shown under the TopBar on BOTH Home and chat when After Effects switched projects.
 * Cubic always mirrors AE (we auto-followed the now-open project); this bar is a notification + one-click
 * actions. Two flavors, by priority:
 *   1. Deferred  — a switch was detected while a turn is running; we held off so the live turn isn't yanked.
 *                  Passive note; Cubic catches up when the turn ends.
 *   2. Switch    — a generic switch → offer to re-open the previous project in AE (a real switch, driven via
 *                  the openProject command — not a view-only swap). Each .aep is its own conversation bucket.
 */
export function ProjectSwitchBar() {
  const projectPath = useChatStore((s) => s.projectPath)
  const prevProject = useChatStore((s) => s.prevProject)
  const pendingSwitchPath = useChatStore((s) => s.pendingSwitchPath)
  const reopenPrevProject = useChatStore((s) => s.reopenPrevProject)
  const dismissProjectSwitch = useChatStore((s) => s.dismissProjectSwitch)
  const { reduce } = useMotion()

  const show = !!pendingSwitchPath || !!prevProject

  const dismissBtn = (
    <button
      onClick={dismissProjectSwitch}
      aria-label="Dismiss"
      className="shrink-0 rounded-md p-1 text-white/45 hover:bg-white/10 hover:text-white/80"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
        <line x1="4" y1="4" x2="12" y2="12" />
        <line x1="12" y1="4" x2="4" y2="12" />
      </svg>
    </button>
  )

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.18, ease: EASE_OUT }}
          className="overflow-hidden border-b border-white/5 bg-white/[0.04]"
        >
          <div className="flex items-center gap-3 px-4 py-2">
            {pendingSwitchPath ? (
              <>
                <span className="min-w-0 flex-1 truncate text-[13px] text-white/70">
                  After Effects switched to <span className="font-medium text-white/85">{baseName(pendingSwitchPath)}</span> — Cubic will catch up when this turn finishes
                </span>
                {dismissBtn}
              </>
            ) : prevProject ? (
              <>
                <span className="min-w-0 flex-1 truncate text-[13px] text-white/70">
                  After Effects switched to <span className="font-medium text-white/85">{baseName(projectPath)}</span>
                </span>
                <button
                  onClick={reopenPrevProject}
                  className="shrink-0 rounded-md bg-white/10 px-2.5 py-1 text-[12px] font-medium text-white/90 hover:bg-white/15"
                >
                  Open {baseName(prevProject.projectPath)} in After Effects
                </button>
                {dismissBtn}
              </>
            ) : null}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
