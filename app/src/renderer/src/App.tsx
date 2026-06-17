import { useEffect } from 'react'
import { useChatStore } from './store'
import { bindWs, connectBackend, sendList } from './ws'
import { ChatPane } from './components/ChatPane'
import { HomeView } from './components/HomeView'
import { Sidebar } from './components/Sidebar'
import { LoadingScreen } from './components/LoadingScreen'
import { ConfirmModal } from './components/ConfirmModal'
import { Toasts } from './components/Toasts'

/**
 * Root: wires the WS transport to the store and routes between the home landing view and the active
 * chat (sidebar + transcript). A loading splash holds until the first conversation list arrives so
 * the UI never renders before its data. Connection-state UX (banners/reconnect) is worktree ⑦.
 */
export function App() {
  const connection = useChatStore((s) => s.connection)
  const listLoaded = useChatStore((s) => s.listLoaded)
  const view = useChatStore((s) => s.view)

  useEffect(() => {
    const store = useChatStore.getState()
    bindWs(store.handleServerMessage, store.setConnection)
    connectBackend()
  }, [])

  useEffect(() => {
    if (connection === 'open') {
      sendList()
      // Restore the conversation the user was in (persisted across reload) + re-attach to any
      // in-flight turn. No-op when the landing view is Home.
      useChatStore.getState().reattachActive()
    }
  }, [connection])

  let body
  if (!listLoaded && connection !== 'disconnected') {
    body = <LoadingScreen />
  } else if (view === 'home') {
    body = <HomeView />
  } else {
    body = (
      <div className="flex h-full">
        <Sidebar />
        <div className="min-w-0 flex-1">
          <ChatPane />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full bg-neutral-900 text-white/90">
      {body}
      <ConfirmModal />
      <Toasts />
    </div>
  )
}
