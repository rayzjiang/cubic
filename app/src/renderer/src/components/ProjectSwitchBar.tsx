import { AnimatePresence, motion } from 'motion/react'
import { useChatStore } from '../store'
import { EASE_OUT, useMotion } from '../motion'

/** Filename only — the full path is noise to a video editor (e.g. "MyEdit_v2.aep"). */
const baseName = (p: string): string => p.split('/').pop() || p || 'an untitled project'

/**
 * Slim, non-blocking bar shown under the TopBar on BOTH Home and chat. Two states, driven by the store's
 * displayed-vs-live project tracking:
 *   - Post-switch (we're on the now-open project, `prevProject` is the one we left): "Now in B — [Back to A]
 *     [✕]". Auto-follow already moved us here; "Back" jumps to A (a deliberate detour), "✕" accepts B.
 *   - Detour (we jumped Back to a project AE doesn't have open → `inDetour`): "Viewing A — not open in After
 *     Effects — [Return to B]". The composer is locked here (InputBar), so the only action is to return to
 *     the open project. No ✕ — returning IS the way out.
 * Both buttons call the same symmetric swap (`backToPrevProject`).
 */
export function ProjectSwitchBar() {
  const projectPath = useChatStore((s) => s.projectPath)
  const liveProjectPath = useChatStore((s) => s.liveProjectPath)
  const prevProject = useChatStore((s) => s.prevProject)
  const backToPrevProject = useChatStore((s) => s.backToPrevProject)
  const dismissProjectSwitch = useChatStore((s) => s.dismissProjectSwitch)
  const { reduce } = useMotion()

  const inDetour = liveProjectPath !== null && projectPath !== liveProjectPath
  // Detour always shows (it's the guard state); otherwise show only when there's a project to go back to.
  const show = inDetour || !!prevProject

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
            {inDetour ? (
              <>
                <span className="min-w-0 flex-1 truncate text-[13px] text-white/70">
                  Viewing <span className="font-medium text-white/85">{baseName(projectPath)}</span> — not open in After Effects
                </span>
                <button
                  onClick={backToPrevProject}
                  className="shrink-0 rounded-md bg-white/10 px-2.5 py-1 text-[12px] font-medium text-white/90 hover:bg-white/15"
                >
                  Return to {baseName(liveProjectPath ?? '')}
                </button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-[13px] text-white/70">
                  After Effects switched to <span className="font-medium text-white/85">{baseName(projectPath)}</span>
                </span>
                <button
                  onClick={backToPrevProject}
                  className="shrink-0 rounded-md bg-white/10 px-2.5 py-1 text-[12px] font-medium text-white/90 hover:bg-white/15"
                >
                  Back to {baseName(prevProject?.projectPath ?? '')}
                </button>
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
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
