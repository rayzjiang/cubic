import { useChatStore } from '../store'
import { ConversationRow } from './ConversationRow'

/**
 * The landing screen (main pane on launch): a "Welcome back" greeting + the project's conversations
 * (newest first, the most-recent badged) + New chat. Picking a chat opens it. The persistent sidebar
 * lives in the chat layout; this is the dedicated home the user lands on.
 */
export function HomeView() {
  const conversations = useChatStore((s) => s.conversations)
  const newChat = useChatStore((s) => s.newChat)

  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-6 pb-8 pt-8">
        <h1 className="text-[28px] font-semibold tracking-tight text-white/90">Welcome back</h1>
        <p className="mt-1 text-sm text-white/45">Pick up a conversation or start something new.</p>

        <button
          onClick={newChat}
          className="mt-6 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/15"
        >
          + New chat
        </button>

        <div className="mt-8">
          {conversations.length === 0 ? (
            <p className="text-sm text-white/35">No conversations yet for this project — start one above.</p>
          ) : (
            <>
              <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-white/35">Recent</h2>
              <ul className="space-y-0.5">
                {conversations.map((c, i) => (
                  <li key={c.id}>
                    <ConversationRow conv={c} badge={i === 0 ? 'most recent' : undefined} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
