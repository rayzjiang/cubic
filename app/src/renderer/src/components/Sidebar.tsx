import { useChatStore } from '../store'
import { ConversationRow } from './ConversationRow'

/**
 * Collapsible conversation sidebar, shown alongside the active chat. Scoped to the current project
 * (newest first); the open conversation is highlighted.
 *
 * Smooth collapse without a reflow jolt: the container's WIDTH animates, but the expanded content
 * sits in a FIXED-width (w-64) panel so it never re-lays-out mid-animation — the growing/shrinking
 * container simply clips/reveals it. The collapsed icon rail cross-fades against it. A drag strip up
 * top clears the macOS traffic lights; the toggle sits on the right edge, same y in both states.
 */
export function Sidebar() {
  const collapsed = useChatStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useChatStore((s) => s.toggleSidebar)
  const conversations = useChatStore((s) => s.conversations)
  const sessionId = useChatStore((s) => s.sessionId)
  const lastUserText = useChatStore((s) => s.lastUserText)
  const newChat = useChatStore((s) => s.newChat)
  const goHome = useChatStore((s) => s.goHome)

  // The active chat only enters `conversations` once the backend persists its first turn (done→sendList).
  // Until then a brand-new chat has no row — so render a derived "synthetic" row for it: appears the moment
  // New chat is clicked (highlighted/active), title fills in from the first message, then the real persisted
  // row (same id) replaces it seamlessly. Nothing is mutated, so a stray sendList can't wipe it.
  const activeUnlisted = !!sessionId && !conversations.some((c) => c.id === sessionId)
  const syntheticTitle = lastUserText?.trim() || 'New chat'

  return (
    <aside
      className={`relative flex shrink-0 flex-col overflow-hidden border-r border-white/5 bg-black/20 transition-[width] duration-200 ease-out ${collapsed ? 'w-12' : 'w-64'}`}
    >
      {/* Drag strip — clears the macOS traffic lights so nothing sits under them. */}
      <div className="h-9 shrink-0 [-webkit-app-region:drag]" />

      {/* Collapsed icon rail — overlaid, fades in when collapsed. */}
      <div
        className={`absolute inset-x-0 top-9 flex flex-col items-center gap-1 pt-0.5 transition-opacity duration-150 ${collapsed ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        <button onClick={toggleSidebar} className="rounded-md p-1.5 text-white/55 hover:bg-white/10 hover:text-white/90" aria-label="Expand sidebar">
          <SidebarToggleIcon />
        </button>
        <button onClick={newChat} className="rounded-md p-1.5 text-white/55 hover:bg-white/10 hover:text-white/90" aria-label="New chat">
          <PlusIcon />
        </button>
      </div>

      {/* Expanded content — fixed width so it never reflows during the width animation; fades out when collapsed. */}
      <div
        className={`flex min-h-0 w-64 flex-1 flex-col transition-opacity duration-150 ${collapsed ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      >
        <div className="flex items-center gap-1 px-2 pb-2">
          <button onClick={goHome} className="rounded-md px-2 py-1.5 text-[13px] text-white/55 hover:bg-white/10 hover:text-white/80">
            ⌂ Home
          </button>
          <button onClick={newChat} className="ml-auto whitespace-nowrap rounded-md bg-white/10 px-2.5 py-1.5 text-[13px] hover:bg-white/15">
            + New chat
          </button>
          <button onClick={toggleSidebar} className="rounded-md p-1.5 text-white/45 hover:bg-white/10 hover:text-white/90" aria-label="Collapse sidebar">
            <SidebarToggleIcon />
          </button>
        </div>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {conversations.length === 0 && !activeUnlisted && (
            <li className="px-3 py-2 text-[13px] text-white/35">No conversations yet.</li>
          )}
          {/* Synthetic active row for a not-yet-persisted new chat (no kebab, click is a no-op — it's already open). */}
          {activeUnlisted && (
            <li>
              <div className="flex items-center rounded-md bg-white/10">
                <span className="min-w-0 flex-1 truncate px-3 py-2 text-left text-[13px] text-white/80">{syntheticTitle}</span>
              </div>
            </li>
          )}
          {conversations.map((c) => (
            <li key={c.id}>
              <ConversationRow conv={c} active={c.id === sessionId} />
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}

/** Standard "toggle sidebar" glyph: a rounded rect with a left-side divider. Inline SVG, no library. */
function SidebarToggleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <line x1="6" y1="3.4" x2="6" y2="12.6" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <line x1="8" y1="3.5" x2="8" y2="12.5" />
      <line x1="3.5" y1="8" x2="12.5" y2="8" />
    </svg>
  )
}
