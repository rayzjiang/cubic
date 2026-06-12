import { useChatStore } from '../store'
import { ConversationRow } from './ConversationRow'

/**
 * Collapsible conversation sidebar, shown alongside the active chat. Scoped to the current project
 * (newest first); the open conversation is highlighted. Collapsed → a thin rail with expand + New
 * chat. The top is a draggable strip that clears the macOS traffic lights.
 */
export function Sidebar() {
  const collapsed = useChatStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useChatStore((s) => s.toggleSidebar)
  const conversations = useChatStore((s) => s.conversations)
  const sessionId = useChatStore((s) => s.sessionId)
  const newChat = useChatStore((s) => s.newChat)
  const goHome = useChatStore((s) => s.goHome)

  if (collapsed) {
    return (
      <div className="flex w-12 shrink-0 flex-col items-center border-r border-white/5 bg-black/20">
        <div className="h-9 w-full shrink-0 [-webkit-app-region:drag]" />
        <button onClick={toggleSidebar} className="mt-1 rounded p-2 text-white/50 hover:bg-white/10 hover:text-white/80" aria-label="Expand sidebar">
          »
        </button>
        <button onClick={newChat} className="mt-1 rounded p-2 text-white/50 hover:bg-white/10 hover:text-white/80" aria-label="New chat">
          +
        </button>
      </div>
    )
  }

  return (
    <div className="flex w-64 shrink-0 flex-col border-r border-white/5 bg-black/20">
      <div className="flex h-9 shrink-0 items-center justify-end pr-1 [-webkit-app-region:drag]">
        <button onClick={toggleSidebar} className="rounded p-1.5 text-white/45 [-webkit-app-region:no-drag] hover:bg-white/10 hover:text-white/80" aria-label="Collapse sidebar">
          «
        </button>
      </div>
      <div className="flex items-center gap-2 px-2 pb-2">
        <button onClick={goHome} className="rounded-md px-2 py-1.5 text-[13px] text-white/55 hover:bg-white/10 hover:text-white/80">
          ⌂ Home
        </button>
        <button onClick={newChat} className="ml-auto rounded-md bg-white/10 px-2.5 py-1.5 text-[13px] hover:bg-white/15">
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
    </div>
  )
}
