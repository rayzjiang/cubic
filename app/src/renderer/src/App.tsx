import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useChatStore } from './store'
import { useMotion } from './motion'
import { bindWs, connectBackend, sendList } from './ws'
import { ChatPane } from './components/ChatPane'
import { HomeView } from './components/HomeView'
import { Sidebar } from './components/Sidebar'
import { LoadingScreen } from './components/LoadingScreen'
import { BackendBlockedScreen } from './components/BackendBlockedScreen'
import { AuthScreen } from './components/AuthScreen'
import { ConfirmModal } from './components/ConfirmModal'
import { Toasts } from './components/Toasts'
import { TopBar } from './components/TopBar'

/**
 * Root: wires the WS transport to the store and routes between the home landing view and the active
 * chat (sidebar + transcript). A loading splash holds until the first conversation list arrives so
 * the UI never renders before its data. Connection-state UX (banners/reconnect) is worktree ⑦.
 */
export function App() {
  const connection = useChatStore((s) => s.connection)
  const listLoaded = useChatStore((s) => s.listLoaded)
  const view = useChatStore((s) => s.view)
  const backendPhase = useChatStore((s) => s.backendStatus.phase)
  const authStatus = useChatStore((s) => s.auth.status)
  const cubicEnv = useChatStore((s) => s.cubicEnv)
  const { crossfade } = useMotion()

  useEffect(() => {
    const store = useChatStore.getState()
    bindWs(store.handleServerMessage, store.setConnection)
    connectBackend()
    // Backend-link status from main (over IPC, not the WS): snapshot first (covers a late mount/reload),
    // then subscribe to live pushes (the only way the dot learns "reconnecting" while the WS is down).
    void window.cubic.getBackendStatus().then(store.setBackendStatus).catch(() => {})
    // §B auth + which env we run as (gates sign-in): snapshot first, then subscribe to live auth pushes.
    void window.cubic.getCubicEnv().then(store.setCubicEnv).catch(() => {})
    void window.cubic.getAuthState().then(store.setAuth).catch(() => {})
    const offBackend = window.cubic.onBackendStatus(store.setBackendStatus)
    const offAuth = window.cubic.onAuthChanged(store.setAuth)
    return () => {
      offBackend()
      offAuth()
    }
  }, [])

  useEffect(() => {
    if (connection === 'open') {
      sendList()
      // Restore the conversation the user was in (persisted across reload) + re-attach to any
      // in-flight turn. No-op when the landing view is Home.
      useChatStore.getState().reattachActive()
    }
  }, [connection])

  // Re-check which AE project is open whenever Cubic regains focus — the user may have switched projects
  // in AE (File>Open / Increment-and-Save) while the panel stayed connected, which fires no backend event.
  // A fresh `list` re-resolves the project (uncached) on the backend; the store auto-follows the now-open
  // project (preserving Home/chat view) and raises the project-switch bar. Event-driven (no polling — a
  // repo rule).
  useEffect(() => {
    const onFocus = (): void => sendList()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  let body
  if (backendPhase === 'port-in-use' || backendPhase === 'stopped') {
    // Non-functional backend the user must resolve — full takeover (no top bar).
    body = <BackendBlockedScreen phase={backendPhase} />
  } else if (cubicEnv === 'prod' && authStatus !== 'signedIn' && authStatus !== 'loading') {
    // §B prod-only gate: a stranger must sign in before reaching the app (and before spending the key).
    // Skipped while `loading` (so an already-signed-in user doesn't flash the sign-in screen on launch)
    // and entirely in local dev (cubicEnv==='local'), which stays usable signed-out.
    body = <AuthScreen />
  } else if (!listLoaded && connection !== 'disconnected') {
    body = <LoadingScreen />
  } else {
    // Home + chat share the global top bar; only the region below it differs. The two views
    // overlapping-crossfade (+subtle rise) into each other: both are absolutely positioned inside the
    // relative region so they can occupy the same box while one fades out and the other fades in.
    // `initial={false}` suppresses any crossfade on first paint. TopBar stays OUTSIDE AnimatePresence
    // (always mounted) — its title runs its own fade in TopBar.tsx.
    body = (
      <div className="flex h-full flex-col">
        <TopBar />
        {/* An AE project switch surfaces as a toast (see store `conversations` handler); the now-open
            project name shows in the TopBar. The slim ProjectSwitchBar component is kept (unmounted) for
            possible future reuse. */}
        <div className="relative min-h-0 flex-1">
          <AnimatePresence initial={false}>
            {view === 'home' ? (
              <motion.div
                key="home"
                className="absolute inset-0"
                variants={crossfade}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <HomeView />
              </motion.div>
            ) : (
              <motion.div
                key="chat"
                className="absolute inset-0 flex"
                variants={crossfade}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <Sidebar />
                <div className="min-w-0 flex-1">
                  <ChatPane />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    )
  }

  return (
    // No background here: the body is transparent so the macOS vibrancy shows through the translucent
    // chrome (top bar + sidebar). Content panes paint their own solid bg to stay crisp.
    <div className="h-full text-white/90">
      {body}
      <ConfirmModal />
      <Toasts />
    </div>
  )
}
