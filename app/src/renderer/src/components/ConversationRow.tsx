import { useState } from 'react'
import type { ConversationMeta } from '../protocol'
import { useChatStore } from '../store'

/**
 * One conversation in the home list / sidebar. Click opens it. A hover-revealed kebab (⋯) opens a
 * small menu whose only action is Delete, which raises the confirm MODAL (delete is permanent — the
 * store does optimistic-remove + rollback-on-refusal, and shows a toast on success). Optional badge.
 */
export function ConversationRow({ conv, active, badge }: { conv: ConversationMeta; active?: boolean; badge?: string }) {
  const openChat = useChatStore((s) => s.openChat)
  const requestDelete = useChatStore((s) => s.requestDelete)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className={`group relative flex items-center rounded-md ${active ? 'bg-white/10' : 'hover:bg-white/[0.06]'}`}>
      <button onClick={() => openChat(conv.id)} className="min-w-0 flex-1 truncate px-3 py-2 text-left text-[13px] text-white/80">
        {conv.title}
        {badge && <span className="ml-2 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/45">{badge}</span>}
      </button>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="mr-1 rounded px-1.5 py-1 text-white/40 opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-white/80 aria-expanded:opacity-100"
        aria-expanded={menuOpen}
        aria-label="Conversation options"
      >
        ⋯
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-1 top-9 z-20 w-32 rounded-md border border-white/10 bg-neutral-800 py-1 shadow-lg">
            <button
              onClick={() => {
                setMenuOpen(false)
                requestDelete(conv)
              }}
              className="block w-full px-3 py-1.5 text-left text-[13px] text-red-300 hover:bg-white/10"
            >
              Delete chat
            </button>
          </div>
        </>
      )}
    </div>
  )
}
