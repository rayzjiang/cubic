import { AnimatePresence, motion } from 'motion/react'
import { useChatStore } from '../store'
import { EASE_OUT, useMotion } from '../motion'

/**
 * Slim, non-blocking bar shown under the TopBar when After Effects switched to a DIFFERENT project while
 * the user is mid-chat in a conversation tied to the old one (set by the store's project-switch detection
 * on a focus-driven `list`). The open chat stays readable; this just offers a one-click jump to the now-
 * open project's conversations. Only renders in chat view — Home silently refreshes to the new project.
 */
export function ProjectSwitchBar() {
  const projectSwitch = useChatStore((s) => s.projectSwitch)
  const view = useChatStore((s) => s.view)
  const adoptProjectSwitch = useChatStore((s) => s.adoptProjectSwitch)
  const dismissProjectSwitch = useChatStore((s) => s.dismissProjectSwitch)
  const { reduce } = useMotion()

  const show = view === 'chat' && !!projectSwitch
  // Filename only — the full path is noise to a video editor (e.g. "MyEdit_v2.aep").
  const name = projectSwitch ? projectSwitch.projectPath.split('/').pop() || projectSwitch.projectPath : ''

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
            <span className="min-w-0 flex-1 truncate text-[13px] text-white/70">
              After Effects switched to <span className="font-medium text-white/85">{name}</span>
            </span>
            <button
              onClick={adoptProjectSwitch}
              className="shrink-0 rounded-md bg-white/10 px-2.5 py-1 text-[12px] font-medium text-white/90 hover:bg-white/15"
            >
              View its chats
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
