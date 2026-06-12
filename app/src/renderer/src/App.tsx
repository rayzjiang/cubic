import { useEffect, useState } from 'react'
import { useChatStore } from './store'
import { bindWs, connectBackend, sendList } from './ws'

/**
 * Step-2 shell: proves the spawn → port → IPC → WS → store pipe end-to-end. It connects, lists the
 * current project's conversations on open, and exercises send → foldEvent. The real Cursor-style
 * transcript, sidebar, and home view land in Steps 3–4 — these views are intentionally minimal.
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
    <div className="flex h-full flex-col bg-neutral-900 text-white/90">
      <header className="flex items-center justify-between px-4 py-2 text-sm [-webkit-app-region:drag]">
        <span className="font-semibold tracking-tight">Cubic</span>
        <span className={connection === 'open' ? 'text-green-400' : connection === 'connecting' ? 'text-white/50' : 'text-red-400'}>
          {connection}
        </span>
      </header>
      <main className="min-h-0 flex-1">{view === 'home' ? <HomeView /> : <ChatView />}</main>
    </div>
  )
}

function HomeView() {
  const conversations = useChatStore((s) => s.conversations)
  const newChat = useChatStore((s) => s.newChat)
  const openChat = useChatStore((s) => s.openChat)

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Welcome back</h1>
      <button onClick={newChat} className="mt-4 rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">
        + New chat
      </button>
      <ul className="mt-6 space-y-1">
        {conversations.length === 0 && <li className="text-sm text-white/40">No conversations yet for this project.</li>}
        {conversations.map((c) => (
          <li key={c.id}>
            <button onClick={() => openChat(c.id)} className="w-full truncate rounded-md px-3 py-2 text-left text-sm hover:bg-white/10">
              {c.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChatView() {
  const items = useChatStore((s) => s.items)
  const running = useChatStore((s) => s.running)
  const progressWord = useChatStore((s) => s.progressWord)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const goHome = useChatStore((s) => s.goHome)
  const [draft, setDraft] = useState('')

  const submit = () => {
    if (!draft.trim()) return
    sendMessage(draft)
    setDraft('')
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col px-6 py-4">
      <button onClick={goHome} className="self-start text-sm text-white/50 hover:text-white/80">← Home</button>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto py-4 text-sm">
        {items.map((it, i) => (
          <div key={i} className="whitespace-pre-wrap">
            {it.kind === 'user' && <span className="text-blue-300">you: {it.text}</span>}
            {it.kind === 'assistant' && <span>{it.text}</span>}
            {it.kind === 'tool' && <span className="text-white/60">• {it.label} [{it.status}]</span>}
          </div>
        ))}
        {running && progressWord && <div className="text-white/40">{progressWord}</div>}
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        rows={2}
        placeholder="Tell Cubic what to make…"
        className="resize-none rounded-md bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/30"
      />
    </div>
  )
}
