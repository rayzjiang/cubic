import { useChatStore } from '../store'
import { useScrollFade } from '../useScrollFade'
import { ConversationRow } from './ConversationRow'
import { AccountWidget } from './AccountWidget'

/**
 * The expanded sidebar body: a Home / New chat header, the project's Recents list (newest first), and
 * the account widget pinned to the bottom. Shared by the inline chat Sidebar (wide window) and the
 * MobileDrawer overlay (narrow window) so the two stay in lockstep — the only difference is the trailing
 * header button: the inline sidebar collapses to its icon rail (no `onClose`), the drawer closes it.
 *
 * Fixed w-64 so it never reflows: inline it sits inside the width-animating <aside> (which clips it);
 * in the drawer it fills the 256px panel.
 */
export function SidebarPanel({ onClose }: { onClose?: () => void }) {
  const conversations = useChatStore((s) => s.conversations)
  const pendingNewChats = useChatStore((s) => s.pendingNewChats)
  const sessionId = useChatStore((s) => s.sessionId)
  const newChat = useChatStore((s) => s.newChat)
  const openChat = useChatStore((s) => s.openChat)
  const goHome = useChatStore((s) => s.goHome)
  const toggleSidebar = useChatStore((s) => s.toggleSidebar)
  const fadeRef = useScrollFade<HTMLUListElement>()

  // A brand-new chat only enters `conversations` once its first turn commits. Until then the renderer owns
  // its row so it survives chat switches (Claude.ai behavior):
  //  - `pendingRows`: a message was sent (in `pendingNewChats`) but isn't persisted yet — a real, clickable,
  //    persistent row (newest first), replaced by the committed row once the backend list includes its id.
  //  - `activeEphemeral`: the active chat is brand-new with NO message sent yet — a temporary "New chat" row
  //    that vanishes the moment you switch away (it's tied to the active session, nothing was sent).
  const pendingRows = pendingNewChats.filter((p) => !conversations.some((c) => c.id === p.id)).slice().reverse()
  const activeEphemeral =
    !!sessionId &&
    !conversations.some((c) => c.id === sessionId) &&
    !pendingNewChats.some((p) => p.id === sessionId)

  return (
    <div className="flex min-h-0 w-64 flex-1 flex-col">
      <div className="flex items-center gap-1 px-2 pb-2 pt-2">
        <button onClick={goHome} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] leading-none text-white/55 hover:bg-white/10 hover:text-white/80">
          <HomeIcon size={14} />
          Home
        </button>
        <button onClick={newChat} className="ml-auto inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-white/10 px-2.5 py-1.5 text-[13px] leading-none hover:bg-white/15">
          <PlusIcon size={14} />
          New chat
        </button>
        {onClose ? (
          <button onClick={onClose} className="rounded-md p-1.5 text-white/45 hover:bg-white/10 hover:text-white/90" aria-label="Close menu">
            <CloseIcon />
          </button>
        ) : (
          <button onClick={toggleSidebar} className="rounded-md p-1.5 text-white/45 hover:bg-white/10 hover:text-white/90" aria-label="Collapse sidebar">
            <SidebarToggleIcon />
          </button>
        )}
      </div>
      {(conversations.length > 0 || pendingRows.length > 0 || activeEphemeral) && (
        <div className="px-3 pb-2 pt-3 text-xs font-medium uppercase tracking-wide text-white/30">Recents</div>
      )}
      <ul ref={fadeRef} className="scroll-fade min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-6">
        {conversations.length === 0 && pendingRows.length === 0 && !activeEphemeral && (
          <li className="px-3 py-2 text-[13px] text-white/35">No conversations yet.</li>
        )}
        {/* Ephemeral active row: a brand-new chat with no message sent yet — vanishes on switch (no kebab). */}
        {activeEphemeral && (
          <li>
            <div className="flex items-center rounded-md bg-white/10">
              <span className="min-w-0 flex-1 truncate px-3 py-2 text-left text-[13px] text-white/80">New chat</span>
            </div>
          </li>
        )}
        {/* Pending new chats (message sent, not yet committed) — persistent + clickable; no kebab until persisted. */}
        {pendingRows.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => openChat(p.id)}
              className={`flex w-full items-center rounded-md ${p.id === sessionId ? 'bg-white/10' : 'hover:bg-white/5'}`}
            >
              <span className="min-w-0 flex-1 truncate px-3 py-2 text-left text-[13px] text-white/80">{p.title.trim() || 'New chat'}</span>
            </button>
          </li>
        ))}
        {conversations.map((c) => (
          <li key={c.id}>
            <ConversationRow conv={c} active={c.id === sessionId} />
          </li>
        ))}
      </ul>
      {/* Account widget pinned below the conversation list (the list is flex-1, pushing this to the bottom). */}
      <div className="border-t border-white/5">
        <AccountWidget />
      </div>
    </div>
  )
}

/** House outline matching the sidebar's stroke-icon style (1.4 stroke, round joins). */
export function HomeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M2.5 7 L8 2.75 L13.5 7" />
      <path d="M4 6.5 V13 H12 V6.5" />
    </svg>
  )
}

/** Standard "toggle sidebar" glyph: a rounded rect with a left-side divider. Inline SVG, no library. */
export function SidebarToggleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <line x1="6" y1="3.4" x2="6" y2="12.6" />
    </svg>
  )
}

export function PlusIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" className="shrink-0">
      <line x1="8" y1="3.5" x2="8" y2="12.5" />
      <line x1="3.5" y1="8" x2="12.5" y2="8" />
    </svg>
  )
}

/** Close (✕) glyph for the drawer header — matches the sidebar's 1.4-stroke round-cap style. */
export function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  )
}
