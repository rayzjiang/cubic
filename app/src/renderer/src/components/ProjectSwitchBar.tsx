import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { EASE_OUT, useMotion } from '../motion'

/**
 * Slim, non-blocking action bar that slides in under the TopBar. Currently UNMOUNTED — AE project switches
 * surface as a toast instead (see the store `conversations` handler) and the open project name lives in the
 * TopBar. Kept as a self-contained, presentational component for future reuse: pass `show` to toggle it, a
 * `message`, and optionally an action button and/or a dismiss ✕.
 */
export function ProjectSwitchBar({
  show,
  message,
  actionLabel,
  onAction,
  onDismiss,
}: {
  show: boolean
  message: ReactNode
  actionLabel?: string
  onAction?: () => void
  onDismiss?: () => void
}) {
  const { reduce } = useMotion()

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
            <span className="min-w-0 flex-1 truncate text-[13px] text-white/70">{message}</span>
            {actionLabel && onAction && (
              <button
                onClick={onAction}
                className="shrink-0 rounded-md bg-white/10 px-2.5 py-1 text-[12px] font-medium text-white/90 hover:bg-white/15"
              >
                {actionLabel}
              </button>
            )}
            {onDismiss && (
              <button
                onClick={onDismiss}
                aria-label="Dismiss"
                className="shrink-0 rounded-md p-1 text-white/45 hover:bg-white/10 hover:text-white/80"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <line x1="4" y1="4" x2="12" y2="12" />
                  <line x1="12" y1="4" x2="4" y2="12" />
                </svg>
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
