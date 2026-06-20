import { AnimatePresence, motion } from 'motion/react'
import { useChatStore } from '../store'
import { CHROME_BG } from '../ui'
import { EASE_OUT, useMotion } from '../motion'
import { AeStatus } from './AeStatus'

// macOS insets the traffic lights into the top-left; reserve room so nothing sits under them.
// window.cubic exposes no platform flag, so sniff the renderer's platform once at module load.
const isMac = navigator.platform.startsWith('Mac')

/**
 * Full-width window chrome bar (VSCode-style) above the sidebar+chat split. Owns the macOS
 * traffic-light zone + window drag. Three regions: a left spacer clearing the traffic lights, the
 * currently-open After Effects project name centered across the full width, and the AE status pinned right.
 */
export function TopBar() {
  const liveProjectPath = useChatStore((s) => s.liveProjectPath)
  const { reduce } = useMotion()

  // The currently-open After Effects project name (Cubic mirrors AE) — a window-global label, so it's
  // centered over the whole window and shown on both Home and chat. Empty until the first list resolves;
  // '' = an unsaved project.
  const title =
    liveProjectPath === null ? '' : liveProjectPath ? liveProjectPath.split('/').pop() || liveProjectPath : 'Untitled Project'

  return (
    <header className={`relative flex h-9 shrink-0 items-center border-b border-white/5 ${CHROME_BG} [-webkit-app-region:drag]`}>
      {/* Left: clear the macOS traffic lights (no controls — the sidebar owns its toggle). */}
      <div className={isMac ? 'w-[78px] shrink-0' : 'w-3 shrink-0'} />

      {/* Center: the open project name, centered across the window. pointer-events-none so it never blocks
          window drag; truncates when long. The span is keyed on the project path so it cross-fades only when
          AE actually switches projects. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <AnimatePresence mode="wait">
          {title && (
            <motion.span
              key={liveProjectPath ?? 'none'}
              className="max-w-[40%] truncate text-[13px] text-white/70"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0.1 : 0.2, ease: EASE_OUT }}
            >
              {title}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Right: AE status pushed to the edge. */}
      <div className="ml-auto flex items-center pr-3">
        <AeStatus />
      </div>
    </header>
  )
}
