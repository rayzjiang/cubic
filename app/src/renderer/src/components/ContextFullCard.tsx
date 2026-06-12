import { useChatStore } from '../store'

/**
 * Shown when a turn hits the hard context ceiling (`context_full`) — a friendly call-to-action, NOT
 * an error. The conversation can't continue, so we offer a one-click New chat.
 */
export function ContextFullCard() {
  const contextFull = useChatStore((s) => s.contextFull)
  const newChat = useChatStore((s) => s.newChat)

  if (!contextFull) return null

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-2">
      <div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-center">
        <p className="text-[13px] text-white/70">This chat’s gotten long — start a new one to keep going.</p>
        <button onClick={newChat} className="mt-2 rounded-md bg-white/10 px-3 py-1.5 text-[13px] font-medium hover:bg-white/15">
          + New chat
        </button>
      </div>
    </div>
  )
}
