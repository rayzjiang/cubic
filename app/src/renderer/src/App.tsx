import { useBackendStatus, type BackendStatus } from './useBackendStatus'

const LABEL: Record<BackendStatus, string> = {
  connecting: 'connecting…',
  open: 'backend connected ✓',
  disconnected: 'disconnected',
}

// Foundation placeholder — the real chat surface lands in a later worktree (§C). This only
// renders the backend connection status to prove the spawn → port → IPC → WS chain works.
export function App() {
  const status = useBackendStatus()
  return (
    <main className="shell">
      <h1 className="brand">Cubic</h1>
      <p className={`status status--${status}`}>{LABEL[status]}</p>
    </main>
  )
}
