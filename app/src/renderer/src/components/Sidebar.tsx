import { motion } from 'motion/react'
import { useChatStore } from '../store'
import { CHROME_BG } from '../ui'
import { EASE_OUT, useMotion } from '../motion'
import { AccountWidget } from './AccountWidget'
import { SidebarPanel, PlusIcon, SidebarToggleIcon } from './SidebarPanel'

/**
 * Collapsible conversation sidebar, shown inline alongside the active chat on wide windows (the narrow
 * layout swaps it for the MobileDrawer overlay — see App). Scoped to the current project (newest first);
 * the open conversation is highlighted.
 *
 * Smooth collapse without a reflow jolt: the container's WIDTH animates, but the expanded content
 * (SidebarPanel, fixed w-64) never re-lays-out mid-animation — the growing/shrinking container simply
 * clips/reveals it. The collapsed icon rail cross-fades against it. The full-width TopBar above owns
 * window drag + the traffic-light zone, so the sidebar starts flush below it.
 */
export function Sidebar() {
  const collapsed = useChatStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useChatStore((s) => s.toggleSidebar)
  const newChat = useChatStore((s) => s.newChat)
  const { reduce } = useMotion()

  return (
    <motion.aside
      className={`relative flex shrink-0 flex-col overflow-hidden border-r border-white/5 ${CHROME_BG}`}
      initial={false}
      animate={{ width: collapsed ? 48 : 256 }}
      transition={{ duration: reduce ? 0 : 0.2, ease: EASE_OUT }}
    >
      {/* Collapsed icon rail — overlaid, fades in when collapsed. Fixed w-12 (NOT inset-x-0) so its
          centered icons don't slide sideways as the sidebar WIDTH animates. pt-2 aligns with the expanded
          header row; the TopBar above owns the traffic-light zone. */}
      <div
        className={`absolute left-0 top-0 flex w-12 flex-col items-center gap-1 pt-2 transition-opacity duration-150 ${collapsed ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        <button onClick={toggleSidebar} className="rounded-md p-1.5 text-white/55 hover:bg-white/10 hover:text-white/90" aria-label="Expand sidebar">
          <SidebarToggleIcon />
        </button>
        <button onClick={newChat} className="rounded-md p-1.5 text-white/55 hover:bg-white/10 hover:text-white/90" aria-label="New chat">
          <PlusIcon />
        </button>
      </div>

      {/* Collapsed account avatar — CENTERED in the icon rail (matching the top icons), pinned bottom. A
          single motion element that slides in from the expanded avatar's position (x: 6 → 0) while fading,
          so the collapse reads as one clean left-slide to center instead of a shaky crossfade. Fixed w-12
          (not inset-x-0) so it never slides sideways as the sidebar WIDTH animates; pb-1.5 keeps its Y flush
          with the expanded chat/home avatar. */}
      <motion.div
        className="absolute bottom-0 left-0 flex w-12 justify-center pb-1.5"
        initial={false}
        animate={{ opacity: collapsed ? 1 : 0, x: collapsed ? 0 : 6 }}
        transition={{ duration: reduce ? 0 : 0.2, ease: EASE_OUT }}
        style={{ pointerEvents: collapsed ? 'auto' : 'none' }}
      >
        <AccountWidget collapsed />
      </motion.div>

      {/* Expanded content — fades out when collapsed. SidebarPanel is fixed-width so it never reflows
          during the width animation. */}
      <div
        className={`flex min-h-0 flex-1 transition-opacity duration-150 ${collapsed ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      >
        <SidebarPanel />
      </div>
    </motion.aside>
  )
}
