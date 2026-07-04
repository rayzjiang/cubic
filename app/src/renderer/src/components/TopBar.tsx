import { AnimatePresence, motion } from 'motion/react'
import { useChatStore } from '../store'
import { CHROME_BG } from '../ui'
import { EASE_OUT, useMotion } from '../motion'
import { useIsNarrow } from '../useMediaQuery'
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
  const view = useChatStore((s) => s.view)
  const toggleMobileDrawer = useChatStore((s) => s.toggleMobileDrawer)
  const isNarrow = useIsNarrow()
  const { reduce } = useMotion()

  // The hamburger opens the overlay drawer — only when it's actually the sidebar's stand-in: a narrow
  // window AND inside a chat (Home has no sidebar, so nothing to open).
  const showHamburger = isNarrow && view === 'chat'

  // The currently-open After Effects project name (Cubic mirrors AE) — a window-global label, so it's
  // centered over the whole window and shown on both Home and chat. Empty until the first list resolves;
  // '' = an unsaved project.
  const title =
    liveProjectPath === null ? '' : liveProjectPath ? liveProjectPath.split('/').pop() || liveProjectPath : 'Untitled Project'

  return (
    <header className={`relative flex h-9 shrink-0 items-center border-b border-white/5 ${CHROME_BG} [-webkit-app-region:drag]`}>
      {/* Left: clear the macOS traffic lights, then (narrow chat only) the hamburger that opens the
          overlay drawer. no-drag so the button is clickable inside the drag region. */}
      <div className={isMac ? 'w-[78px] shrink-0' : 'w-3 shrink-0'} />
      {showHamburger && (
        <button
          onClick={toggleMobileDrawer}
          className="mr-1 shrink-0 rounded-md p-1.5 text-white/55 [-webkit-app-region:no-drag] hover:bg-white/10 hover:text-white/90"
          aria-label="Open menu"
        >
          <HamburgerIcon />
        </button>
      )}

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

/** Three-line hamburger — matches the app's inline-SVG, round-cap icon style. */
function HamburgerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <line x1="2.5" y1="4.5" x2="13.5" y2="4.5" />
      <line x1="2.5" y1="8" x2="13.5" y2="8" />
      <line x1="2.5" y1="11.5" x2="13.5" y2="11.5" />
    </svg>
  )
}
