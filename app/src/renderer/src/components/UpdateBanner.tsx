import { useChatStore } from '../store'

/**
 * §F — the "restart to update" bar. Shown once an update has downloaded + STAGED (phase 'ready') and the
 * user hasn't dismissed it this session. Non-blocking: it never interrupts a chat/render — "Restart now"
 * applies the staged update (quit → swap → relaunch into the new version); "Later" hides the bar (the
 * Settings → General indicator still surfaces it). Lives in the persistent under-TopBar bar stack
 * (App.tsx), below the paywall / file-access bars, so the bars stack cleanly instead of overlapping.
 * Styled to match PaywallBanner / FileAccessBanner.
 */
export function UpdateBanner() {
  const phase = useChatStore((s) => s.update.phase)
  const version = useChatStore((s) => s.update.version)
  const dismissed = useChatStore((s) => s.updateDismissed)
  const dismissUpdate = useChatStore((s) => s.dismissUpdate)
  if (phase !== 'ready' || dismissed) return null

  return (
    <div className="flex items-center gap-3 border-b border-white/10 bg-white/[0.04] px-4 py-2 text-[12px] text-white/80">
      <span className="min-w-0 flex-1 truncate">
        A new version of Cubic{version ? ` (${version})` : ''} is ready.
      </span>
      <button
        onClick={() => window.cubic.restartToUpdate()}
        className="shrink-0 rounded-md bg-white/90 px-2.5 py-1 text-[12px] font-medium text-neutral-900 hover:bg-white"
      >
        Restart now
      </button>
      <button
        onClick={dismissUpdate}
        className="shrink-0 rounded-md px-2 py-1 text-[12px] text-white/50 hover:text-white/80"
      >
        Later
      </button>
    </div>
  )
}
