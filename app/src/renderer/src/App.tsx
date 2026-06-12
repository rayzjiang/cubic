import { useEffect } from 'react'
import { useChatStore } from './store'
import { bindWs, connectBackend, sendList } from './ws'
import { ChatPane } from './components/ChatPane'

/**
 * Root: wires the WS transport to the store and routes between the home list and the active chat.
 * The real sidebar + home view land in Step 4 (HomePlaceholder is interim); the polished transcript
 * is in ChatPane (Step 3). Connection-state UX (banners/reconnect) is worktree ⑦.
 */
export function App() {
  const connection = useChatStore((s) => s.connection)
  const view = useChatStore((s) => s.view)

  useEffect(() => {
    const store = useChatStore.getState()
    bindWs(store.handleServerMessage, store.setConnection)
    connectBackend()
  }, [])

  useEffect(() => {
    if (connection === 'open') sendList()
  }, [connection])

  return (
    <div className="h-full bg-neutral-900 text-white/90">{view === 'home' ? <HomePlaceholder /> : <ChatPane />}</div>
  )
}

// Interim home — replaced by the real "Welcome back" + sidebar in Step 4. The top drag strip clears
// the macOS traffic lights so content never sits under them.
function HomePlaceholder() {
  const conversations = useChatStore((s) => s.conversations)
  const newChat = useChatStore((s) => s.newChat)
  const openChat = useChatStore((s) => s.openChat)

  return (
    <div className="flex h-full flex-col">
      <div className="h-9 shrink-0 [-webkit-app-region:drag]" />
      <div className="mx-auto w-full max-w-2xl px-6 py-4">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <button onClick={newChat} className="mt-4 rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">
          + New chat
        </button>
        <ul className="mt-6 space-y-1">
          {conversations.length === 0 && (
            <li className="text-sm text-white/40">No conversations yet for this project.</li>
          )}
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => openChat(c.id)}
                className="w-full truncate rounded-md px-3 py-2 text-left text-sm hover:bg-white/10"
              >
                {c.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
