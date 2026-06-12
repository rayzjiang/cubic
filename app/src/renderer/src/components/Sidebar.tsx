import { useChatStore } from '../store'
import { ConversationRow } from './ConversationRow'

/**
 * Collapsible conversation sidebar, shown alongside the active chat. Scoped to the current project
 * (newest first); the open conversation is highlighted. The width animates between collapsed/expanded
 * (no snap). A fixed-height drag strip up top clears the macOS traffic lights, and the toggle lives
 * in the control row BELOW that strip — so it never collides with the window buttons and keeps the
 * same y-axis in both states.
 */
export function Sidebar() {
  const collapsed = useChatStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useChatStore((s) => s.toggleSidebar)
  const conversations = useChatStore((s) => s.conversations)
  const sessionId = useChatStore((s) => s.sessionId)
  const newChat = useChatStore((s) => s.newChat)
  const goHome = useChatStore((s) => s.goHome)

  return (
    <aside
      className={`flex shrink-0 flex-col overflow-hidden border-r border-white/5 bg-black/20 transition-[width] duration-200 ease-out ${collapsed ? 'w-12' : 'w-64'}`}
    >
      {/* Drag strip — clears the macOS traffic lights so nothing sits under them. */}
      <div className="h-9 shrink-0 [-webkit-app-region:drag]" />

      {collapsed ? (
        <div className="flex flex-col items-center gap-1 pt-0.5">
          <button onClick={toggleSidebar} className="rounded p-1.5 text-white/45 hover:bg-white/10 hover:text-white/80" aria-label="Expand sidebar">
            »
          </button>
          <button onClick={newChat} className="rounded p-1.5 text-white/50 hover:bg-white/10 hover:text-white/80" aria-label="New chat">
            ＋
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 px-2 pb-2">
            <button onClick={toggleSidebar} className="rounded p-1.5 text-white/45 hover:bg-white/10 hover:text-white/80" aria-label="Collapse sidebar">
              «
            </button>
            <button onClick={goHome} className="rounded-md px-2 py-1.5 text-[13px] text-white/55 hover:bg-white/10 hover:text-white/80">
              ⌂ Home
            </button>
            <button onClick={newChat} className="ml-auto whitespace-nowrap rounded-md bg-white/10 px-2.5 py-1.5 text-[13px] hover:bg-white/15">
              + New chat
            </button>
          </div>
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
            {conversations.length === 0 && <li className="px-3 py-2 text-[13px] text-white/35">No conversations yet.</li>}
            {conversations.map((c) => (
              <li key={c.id}>
                <ConversationRow conv={c} active={c.id === sessionId} />
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  )
}
