import { useEffect, useState } from 'react'
import { useChatStore } from '../store'

// After the bridge is (re)installed this launch, AE — if it was already open — won't load the new panel
// until it restarts. We wait a grace period before nagging, so a fresh install where AE simply isn't
// open yet (and will connect normally once opened) never shows a misleading "restart AE".
const RESTART_AE_GRACE_MS = 8000

/**
 * Always-on After Effects / backend connectivity indicator: a colored dot + brief word pinned to the
 * top-right window chrome so it shows on every page. Hovering anywhere on the dot+text group shows a
 * fuller explanation (native tooltip — no popover, no buttons).
 *
 * It resolves ONE state from three sources, in precedence order:
 *   1. backend-link phase from main (`backendStatus`) — reconnecting overrides everything recoverable;
 *      port-in-use / stopped are handled by the full-screen BackendBlockedScreen, but we still color the
 *      dot red so it's consistent if glimpsed.
 *   2. the renderer↔backend WS (`connection`) — until it's `open` we genuinely can't know AE's state, so
 *      we show neutral "connecting/reconnecting" rather than a misleading red.
 *   3. AE-worker liveness (`aeConnected`, pushed by the backend) — green when connected; when not, the
 *      message is install-aware (restart AE / couldn't install / open the panel).
 */
export function AeStatus() {
  const connection = useChatStore((s) => s.connection)
  const aeConnected = useChatStore((s) => s.aeConnected)
  const { phase, install } = useChatStore((s) => s.backendStatus)

  // Arm the restart-AE hint only while we can actually observe AE as not-connected after an install
  // that copied files this launch; clear it the instant AE connects (or the condition changes).
  const [showRestartAe, setShowRestartAe] = useState(false)
  const eligibleForRestartHint = connection === 'open' && !aeConnected && install === 'updated'
  useEffect(() => {
    if (!eligibleForRestartHint) {
      setShowRestartAe(false)
      return
    }
    const t = setTimeout(() => setShowRestartAe(true), RESTART_AE_GRACE_MS)
    return () => clearTimeout(t)
  }, [eligibleForRestartHint, aeConnected])

  const view = (() => {
    if (phase === 'port-in-use') return { dot: 'bg-red-500', label: 'Another Cubic is running', tip: 'Another copy of Cubic is using its port. Quit it and reopen this app.' }
    if (phase === 'stopped') return { dot: 'bg-red-500', label: 'Cubic stopped', tip: 'The Cubic backend stopped. Quit and reopen the app.' }
    if (connection !== 'open') {
      return phase === 'reconnecting'
        ? { dot: 'bg-amber-400', label: 'Reconnecting…', tip: 'Reconnecting to Cubic…' }
        : { dot: 'bg-white/30', label: 'Connecting…', tip: 'Connecting to Cubic…' }
    }
    if (aeConnected) return { dot: 'bg-green-400', label: 'After Effects connected', tip: 'After Effects is connected to Cubic.' }
    if (install === 'failed') return { dot: 'bg-red-500', label: 'Couldn’t install Cubic’s panel', tip: 'Cubic couldn’t install its After Effects panel. Restart Cubic to try again.' }
    if (showRestartAe) return { dot: 'bg-amber-400', label: 'Restart After Effects', tip: 'Restart After Effects to finish connecting — Cubic just updated its panel.' }
    return { dot: 'bg-red-500', label: 'After Effects disconnected', tip: 'After Effects isn’t connected. Open the Cubic panel in After Effects (Window → Extensions → Cubic).' }
  })()

  return (
    <div className="fixed right-3 top-0 z-50 flex h-9 items-center [-webkit-app-region:no-drag]">
      {/* whole dot+text group is the hover target for the tooltip */}
      <div className="flex items-center gap-1.5 px-1 py-1 text-[11px] text-white/45" title={view.tip}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${view.dot}`} />
        <span>{view.label}</span>
      </div>
    </div>
  )
}
