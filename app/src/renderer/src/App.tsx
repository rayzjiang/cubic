import { useBackendStatus, type BackendStatus } from './useBackendStatus'

const LABEL: Record<BackendStatus, string> = {
  connecting: 'connecting…',
  open: 'backend connected ✓',
  disconnected: 'disconnected',
}

// #4ade80 / #f87171 from the old stylesheet are Tailwind's green-400 / red-400.
const STATUS_COLOR: Record<BackendStatus, string> = {
  connecting: 'text-white/60',
  open: 'text-green-400',
  disconnected: 'text-red-400',
}

// Foundation placeholder — the real chat surface lands in a later worktree (§C). This only
// renders the backend connection status to prove the spawn → port → IPC → WS chain works.
export function App() {
  const status = useBackendStatus()
  return (
    // Draggable surface under the hiddenInset traffic-lights (no real titlebar).
    <main className="flex h-full flex-col items-center justify-center gap-3 select-none [-webkit-app-region:drag]">
      <h1 className="text-[2rem] font-semibold tracking-tight text-white/90">Cubic</h1>
      <p className={`rounded-full bg-white/[0.08] px-3 py-1 text-[0.95rem] ${STATUS_COLOR[status]}`}>
        {LABEL[status]}
      </p>
    </main>
  )
}
