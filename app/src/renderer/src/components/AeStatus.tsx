import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useChatStore } from '../store'
import { EASE_OUT } from '../motion'
import aeLogoUrl from '../assets/after-effects.svg'
import prLogoUrl from '../assets/premiere-pro.svg'
import resolveLogoUrl from '../assets/davinci-resolve-small.png'

// The AE panel is invisible and connects via fs.watch, so it lands near-instantly — but on a cold app
// open there's a brief window before it reports in. Show an optimistic "Connecting…" during it rather
// than a scary red, then fall back to "not connected" if it never lands.
const CONNECTING_GRACE_MS = 4000

type HostStatus = { dot: string; label: string; hint: string | null }
type HostApp = { id: 'ae' | 'premiere' | 'resolve'; name: string; logo: string; available: boolean }

// The creative apps Cubic can drive, in display order. Only After Effects ships today; Premiere Pro and
// DaVinci Resolve are future host adapters (same wire protocol — see server/ae-bridge/PROTOCOL.md).
//
// FUTURE app-switching: when a second host ships, flip its `available: true`, source the connected host
// from the store (an `activeHostId` + per-host status), and pass `onSelect` to <HostButton> to switch
// which adapter Cubic drives. The active host renders as an informational row; every other row is
// already a <button>, so no structural change is needed then.
const HOST_APPS: HostApp[] = [
  { id: 'ae', name: 'After Effects', logo: aeLogoUrl, available: true },
  { id: 'premiere', name: 'Premiere Pro', logo: prLogoUrl, available: false },
  { id: 'resolve', name: 'DaVinci Resolve', logo: resolveLogoUrl, available: false },
]

/**
 * Top-bar host-status app-switcher. The trigger (colored status dot + "After Effects" + chevron) opens
 * a dropdown listing the creative apps Cubic can drive: the connected host (live connectivity) and the
 * others as "Coming soon" buttons — the extension point for future host switching.
 *
 * AE state folds three store sources into one green/amber/red status: backend-link phase (backendStatus),
 * the renderer↔backend WS (connection), and AE-worker liveness (aeConnected). An optimistic ~4s
 * "Connecting…" grace keeps the brief cold-open window from flashing red.
 */
export function AeStatus() {
  const connection = useChatStore((s) => s.connection)
  const aeConnected = useChatStore((s) => s.aeConnected)
  const panelStale = useChatStore((s) => s.panelStale)
  const { phase, install } = useChatStore((s) => s.backendStatus)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState<{ top: number; right: number } | null>(null)

  // The connected host today is always After Effects (the only shipped adapter). FUTURE: read this from
  // the store once a second host can connect.
  const activeHostId: HostApp['id'] = 'ae'

  // Optimistic "Connecting…" grace. Seeded from mount-time state so an eligible cold open never paints
  // red for a frame before the effect runs.
  const eligibleForConnecting = connection === 'open' && !aeConnected && install !== 'failed'
  const [connecting, setConnecting] = useState(() => eligibleForConnecting)
  useEffect(() => {
    if (!eligibleForConnecting) {
      setConnecting(false)
      return
    }
    setConnecting(true)
    const t = setTimeout(() => setConnecting(false), CONNECTING_GRACE_MS)
    return () => clearTimeout(t)
  }, [eligibleForConnecting, aeConnected])

  // "Reconnect" — a non-destructive re-poke of ~/.cubic/conn.json (main) that wakes a dormant panel
  // without dropping in-flight turns. Show it when AE is disconnected but the backend is healthy (a
  // port-in-use/stopped/failed backend needs reopening Cubic, surfaced separately). Success is the
  // `aeStatus` push flipping `aeConnected`; if it doesn't land within the grace, fall back to "restart AE".
  const canReconnect = !aeConnected && (phase === 'running' || phase === 'starting') && install !== 'failed'
  const [reconnecting, setReconnecting] = useState(false)
  const [reconnectFailed, setReconnectFailed] = useState(false)
  useEffect(() => {
    // Panel landed (or backend went unhealthy) → clear the transient reconnect UI.
    if (aeConnected || !canReconnect) {
      setReconnecting(false)
      setReconnectFailed(false)
    }
  }, [aeConnected, canReconnect])
  const handleReconnect = async (): Promise<void> => {
    setReconnectFailed(false)
    setReconnecting(true)
    const ok = await window.cubic.reconnectAe().catch(() => false)
    if (!ok) {
      // Backend not ready → nothing to poke with; the panel can't be woken from here.
      setReconnecting(false)
      setReconnectFailed(true)
      return
    }
    // Give the panel a grace window to re-read conn.json + re-auth; the effect above clears this on success.
    setTimeout(() => {
      setReconnecting(false)
      if (!useChatStore.getState().aeConnected) setReconnectFailed(true)
    }, CONNECTING_GRACE_MS)
  }

  // Close the dropdown on Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // The connected host's connectivity: dot color + short label + one-line hint (only when there's
  // actually something for a non-technical user to do).
  const aeStatus: HostStatus = (() => {
    // A connected panel running an OUTDATED build (an app update changed the panel; CEP loads it once at
    // AE launch, so the running one is stale until AE restarts) → amber "Restart AE". Backend-detected via
    // a build-id comparison (aeStatus.stale), NOT connection state — so it fires even though the stale
    // panel reconnected fine, which is the case the old `!aeConnected` check silently missed (§F-4).
    if (aeConnected && panelStale)
      return { dot: 'bg-amber-400', label: 'Restart AE', hint: 'Restart After Effects to finish updating.' }
    if (aeConnected) return { dot: 'bg-green-400', label: 'Connected', hint: null }
    if (install === 'failed')
      return { dot: 'bg-red-500', label: 'Panel error', hint: 'Restart Cubic to reinstall the panel.' }
    if (connecting) return { dot: 'bg-amber-400', label: 'Connecting…', hint: null }
    return { dot: 'bg-red-500', label: 'Not connected', hint: 'Open After Effects to connect.' }
  })()

  // The trigger folds Cubic-backend problems in front of AE state (they mean nothing connects), but the
  // label stays "After Effects" — the dot color + a short tooltip carry the status at a glance.
  const trigger: { dot: string; tip: string } = (() => {
    if (phase === 'port-in-use') return { dot: 'bg-red-500', tip: 'Another copy of Cubic is running' }
    if (phase === 'stopped') return { dot: 'bg-red-500', tip: 'Cubic stopped — reopen the app' }
    if (connection !== 'open')
      return phase === 'reconnecting'
        ? { dot: 'bg-amber-400', tip: 'Reconnecting…' }
        : { dot: 'bg-white/30', tip: 'Connecting…' }
    const tip =
      aeStatus.label === 'Connected'
        ? 'After Effects connected'
        : aeStatus.label === 'Connecting…'
          ? 'Connecting to After Effects…'
          : 'After Effects not connected'
    return { dot: aeStatus.dot, tip }
  })()

  const toggle = (): void => {
    if (open) {
      setOpen(null)
      return
    }
    const r = triggerRef.current?.getBoundingClientRect()
    if (r) setOpen({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
  }

  const activeApp = HOST_APPS.find((a) => a.id === activeHostId) ?? HOST_APPS[0]
  const otherApps = HOST_APPS.filter((a) => a.id !== activeApp.id)

  return (
    // Inline in the top bar's right region; no-drag so the group stays clickable over the drag strip.
    // select-none so dragging over the label/menu never highlights text.
    <div className="flex select-none items-center [-webkit-app-region:no-drag]">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        title={trigger.tip}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-white/45 transition-colors hover:bg-white/10 hover:text-white/70"
      >
        <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${trigger.dot}`} />
        <span className="leading-none">After Effects</span>
        <ChevronDown open={!!open} />
      </button>

      {createPortal(
        <>
          {/* Click-away backdrop (transparent — snapping in/out is invisible). */}
          {open && <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(null)} />}
          <AnimatePresence>
            {open && (
              <motion.div
                key="ae-menu"
                className="fixed z-50 w-64 select-none overflow-hidden rounded-xl border border-white/10 bg-neutral-800/95 py-1.5 shadow-2xl backdrop-blur"
                style={{ top: open.top, right: open.right }}
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.15, ease: EASE_OUT }}
              >
                {/* Connected host — informational (not a switch target). */}
                <ActiveHostRow
                  app={activeApp}
                  status={aeStatus}
                  canReconnect={canReconnect}
                  reconnecting={reconnecting}
                  reconnectFailed={reconnectFailed}
                  onReconnect={handleReconnect}
                />

                <div className="my-1 h-px bg-white/10" />

                {/* Other hosts — buttons (disabled "Coming soon" today). FUTURE: pass onSelect to switch. */}
                {otherApps.map((app) => (
                  <HostButton key={app.id} app={app} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </>,
        document.body,
      )}
    </div>
  )
}

/** The currently-connected host: name left, status dot + word pinned right (in line with the other
 *  rows' "Coming soon" badges), hint on its own line below when there's an action to take. When AE is
 *  disconnected but the backend is healthy, a non-destructive "Reconnect" action sits under the hint. */
function ActiveHostRow({
  app,
  status,
  canReconnect,
  reconnecting,
  reconnectFailed,
  onReconnect,
}: {
  app: HostApp
  status: HostStatus
  canReconnect: boolean
  reconnecting: boolean
  reconnectFailed: boolean
  onReconnect: () => void
}) {
  // After a failed re-poke, the honest fallback is reopening AE; otherwise show the normal hint.
  const subline = reconnectFailed ? 'Still stuck? Restart After Effects.' : status.hint
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2.5">
        <img src={app.logo} alt="" className="h-5 w-5 shrink-0 rounded" />
        <span className="flex-1 text-[13px] leading-none text-white/85">{app.name}</span>
        <span className="flex items-center gap-1.5">
          <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${status.dot}`} />
          <span className="text-[11px] leading-none text-white/45">{status.label}</span>
        </span>
      </div>
      {canReconnect ? (
        <div className="mt-1.5 pl-[30px]">
          <button
            onClick={onReconnect}
            disabled={reconnecting}
            className="rounded-md bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/80 hover:bg-white/15 disabled:opacity-50"
          >
            {reconnecting ? 'Reconnecting…' : 'Reconnect'}
          </button>
          {subline && <div className="mt-1 text-[11px] leading-snug text-white/40">{subline}</div>}
        </div>
      ) : (
        status.hint && <div className="mt-1 pl-[30px] text-[11px] leading-snug text-white/40">{status.hint}</div>
      )}
    </div>
  )
}

/** A selectable host row. Disabled (unavailable) → grayed "Coming soon". When a host ships, pass
 *  `onSelect` and set `available: true` in HOST_APPS to make it a live switch button. */
function HostButton({ app, onSelect }: { app: HostApp; onSelect?: (id: HostApp['id']) => void }) {
  const disabled = !app.available
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect?.(app.id)}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${
        disabled ? 'cursor-default' : 'hover:bg-white/10'
      }`}
    >
      <img
        src={app.logo}
        alt=""
        className={`h-5 w-5 shrink-0 rounded ${disabled ? 'opacity-40 grayscale' : ''}`}
      />
      <span className={`flex-1 text-[13px] leading-none ${disabled ? 'text-white/40' : 'text-white/85'}`}>
        {app.name}
      </span>
      {disabled ? (
        <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/45">Coming soon</span>
      ) : (
        <span className="text-[11px] leading-none text-white/55">Connect</span>
      )}
    </button>
  )
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 text-white/35 transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <path d="M4 6 L8 10 L12 6" />
    </svg>
  )
}
