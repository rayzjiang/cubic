import { useRef, useState } from 'react'
import type { ConversationMeta } from '../protocol'
import { useChatStore } from '../store'

/**
 * One conversation in the home list / sidebar. Click opens it. A hover-revealed kebab (⋯) opens a small
 * menu with Rename + Delete. Rename edits the title in place (ChatGPT-style): Enter/blur saves, Esc
 * cancels, an empty result reverts — the store updates the row optimistically + persists (no ack). Delete
 * raises the confirm MODAL (permanent; optimistic-remove + rollback-on-refusal + success toast).
 */
export function ConversationRow({ conv, active }: { conv: ConversationMeta; active?: boolean }) {
  const openChat = useChatStore((s) => s.openChat)
  const requestDelete = useChatStore((s) => s.requestDelete)
  const renameConversation = useChatStore((s) => s.renameConversation)
  const [menuOpen, setMenuOpen] = useState(false)
  // Whether the menu opens above the kebab (set on open when there's no room below — keeps it on-screen).
  const [openUp, setOpenUp] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // Set when Esc cancels, so the unmount-triggered blur skips the save (Enter/blur are the save paths).
  const cancelledRef = useRef(false)
  const kebabRef = useRef<HTMLButtonElement>(null)

  function toggleMenu() {
    // On open, flip above the button when the ~2-row menu would spill past the viewport bottom.
    if (!menuOpen) {
      const r = kebabRef.current?.getBoundingClientRect()
      if (r) setOpenUp(window.innerHeight - r.bottom < 96)
    }
    setMenuOpen((v) => !v)
  }

  function startRename() {
    setMenuOpen(false)
    setDraft(conv.title)
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    const clean = draft.trim().replace(/\s+/g, ' ')
    // Skip the write when blank (revert) or unchanged — only persist a real new title.
    if (clean && clean !== conv.title) renameConversation(conv.id, clean)
  }

  if (editing) {
    return (
      <div className={`group relative flex items-center rounded-md ${active ? 'bg-white/10' : ''}`}>
        <input
          value={draft}
          autoFocus
          maxLength={60}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } // blur is the single save path
            else if (e.key === 'Escape') { e.preventDefault(); cancelledRef.current = true; e.currentTarget.blur() }
          }}
          onBlur={() => {
            if (cancelledRef.current) { cancelledRef.current = false; setEditing(false); return }
            commit()
          }}
          className="mx-1 my-0.5 min-w-0 flex-1 rounded bg-black/30 px-2 py-1.5 text-[13px] text-white/90 outline-none ring-1 ring-white/20"
          aria-label="Rename conversation"
        />
      </div>
    )
  }

  return (
    <div className={`group relative flex items-center rounded-md ${active ? 'bg-white/10' : 'hover:bg-white/[0.06]'}`}>
      <button onClick={() => openChat(conv.id)} className="min-w-0 flex-1 truncate px-3 py-2 text-left text-[13px] text-white/80">
        {conv.title}
      </button>
      <button
        ref={kebabRef}
        onClick={toggleMenu}
        className="mr-1 rounded px-1.5 py-1 text-white/40 opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-white/80 aria-expanded:opacity-100"
        aria-expanded={menuOpen}
        aria-label="Conversation options"
      >
        ⋯
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div
            className={`absolute right-1 z-20 w-32 rounded-md border border-white/10 bg-neutral-800 py-1 shadow-lg ${openUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}
          >
            <button
              onClick={startRename}
              className="block w-full px-3 py-1.5 text-left text-[13px] text-white/80 hover:bg-white/10"
            >
              Rename chat
            </button>
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
