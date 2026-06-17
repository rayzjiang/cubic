import { useChatStore } from '../store'

/**
 * Always-on After Effects connectivity indicator: a colored dot + brief word, pinned to the top-right
 * of the window chrome (the empty draggable strip) so it shows on every page — Home, Chat, and the
 * loading splash. Rendered once at the App root (not per-page), no-drag so its hover tooltip works.
 *
 * Three states, from two underlying links: while the renderer↔backend socket isn't `open` we genuinely
 * can't know AE's state, so we show a neutral "Connecting…" rather than a misleading red. Once the
 * backend link is open, `aeConnected` (pushed by the backend's `aeStatus` message) drives green/red.
 * The dot is the always-on companion to the on-failure "After Effects isn't connected" turn error.
 */
export function AeStatus() {
  const connection = useChatStore((s) => s.connection)
  const aeConnected = useChatStore((s) => s.aeConnected)

  const state =
    connection !== 'open' ? 'connecting' : aeConnected ? 'connected' : 'disconnected'

  const { dot, label, tip } = {
    connecting: {
      dot: 'bg-white/30',
      label: 'Connecting…',
      tip: 'Connecting to Cubic…',
    },
    connected: {
      dot: 'bg-green-400',
      label: 'After Effects connected',
      tip: 'After Effects is connected to Cubic.',
    },
    disconnected: {
      dot: 'bg-red-500',
      label: 'After Effects disconnected',
      tip: "After Effects isn't connected. Open AE with the Cubic bridge panel running.",
    },
  }[state]

  return (
    <div className="fixed right-3 top-0 z-50 flex h-9 items-center [-webkit-app-region:no-drag]">
      <div className="flex items-center gap-1.5 text-[11px] text-white/45" title={tip}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span>{label}</span>
      </div>
    </div>
  )
}
