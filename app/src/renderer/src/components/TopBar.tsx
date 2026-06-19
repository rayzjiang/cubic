import { useChatStore } from '../store'
import { CHROME_BG } from '../ui'
import { AeStatus } from './AeStatus'

// macOS insets the traffic lights into the top-left; reserve room so nothing sits under them.
// window.cubic exposes no platform flag, so sniff the renderer's platform once at module load.
const isMac = navigator.platform.startsWith('Mac')

/**
 * Full-width window chrome bar (VSCode-style) above the sidebar+chat split. Owns the macOS
 * traffic-light zone + window drag. Three regions: a left spacer clearing the traffic lights, the
 * active chat title centered across the full width, and the After Effects status pinned right.
 */
export function TopBar() {
  const view = useChatStore((s) => s.view)
  const sessionId = useChatStore((s) => s.sessionId)
  const conversations = useChatStore((s) => s.conversations)
  const pendingNewChats = useChatStore((s) => s.pendingNewChats)

  // Active chat title — same precedence the Sidebar uses for its rows. Empty on Home (no active chat).
  const title = (() => {
    if (view !== 'chat' || !sessionId) return ''
    const committed = conversations.find((c) => c.id === sessionId)
    if (committed) return committed.title
    const pending = pendingNewChats.find((p) => p.id === sessionId)
    if (pending) return pending.title.trim() || 'New chat'
    return 'New chat' // brand-new ephemeral chat, nothing sent yet
  })()

  return (
    <header className={`relative flex h-9 shrink-0 items-center border-b border-white/5 ${CHROME_BG} [-webkit-app-region:drag]`}>
      {/* Left: clear the macOS traffic lights (no controls — the sidebar owns its toggle). */}
      <div className={isMac ? 'w-[78px] shrink-0' : 'w-3 shrink-0'} />

      {/* Center: title absolutely centered across the full width so the side regions don't shift it.
          pointer-events-none so it never blocks window drag; truncates when long. */}
      <div className="pointer-events-none absolute inset-x-0 flex justify-center">
        <span className="max-w-[40%] truncate text-[13px] text-white/70">{title}</span>
      </div>

      {/* Right: AE status pushed to the edge. */}
      <div className="ml-auto flex items-center pr-3">
        <AeStatus />
      </div>
    </header>
  )
}
