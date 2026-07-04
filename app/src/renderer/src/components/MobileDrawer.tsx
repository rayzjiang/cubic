import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useChatStore } from '../store'
import { EASE_OUT, useMotion } from '../motion'
import { SidebarPanel } from './SidebarPanel'

/**
 * Narrow-window sidebar: an overlay drawer that slides in over the chat (Claude/ChatGPT desktop
 * behavior) with a dim backdrop, instead of the inline <Sidebar>. Opened by the TopBar hamburger;
 * closes on backdrop click, Esc, the panel's close button, or any navigation (newChat/openChat/goHome
 * clear `mobileDrawerOpen` in the store). Mounted only in narrow mode (App gates on useIsNarrow), inside
 * the chat region so it overlays below the TopBar.
 *
 * Solid surface (not the translucent CHROME_BG): it floats over the opaque chat pane, so vibrancy can't
 * show through — a tint would just muddy the chat behind it.
 */
export function MobileDrawer() {
  const open = useChatStore((s) => s.mobileDrawerOpen)
  const setOpen = useChatStore((s) => s.setMobileDrawerOpen)
  const { reduce } = useMotion()

  // Esc closes the drawer (only while open, so it never swallows Esc elsewhere).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="absolute inset-0 z-30 bg-black/40"
            onMouseDown={() => setOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.1 : 0.2, ease: EASE_OUT }}
          />
          <motion.aside
            className="absolute inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-white/5 bg-neutral-900 shadow-2xl"
            initial={{ x: reduce ? 0 : '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: reduce ? 0 : '-100%' }}
            transition={{ duration: reduce ? 0.1 : 0.2, ease: EASE_OUT }}
          >
            <SidebarPanel onClose={() => setOpen(false)} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
