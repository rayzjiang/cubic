import { useChatStore } from '../store'

/**
 * §F-4 — the "Restart After Effects" nudge. Shows when a panel is connected but running an OUTDATED build:
 * an app update changed the panel, but CEP loads panel code once at AE launch, so the running panel stays
 * stale until AE restarts. Backend-detected via a build-id mismatch (`aeStatus.stale` → store `panelStale`),
 * so it fires even though the stale panel reconnected fine — the case the old `!aeConnected` hint missed.
 *
 * Non-blocking + NON-dismissable on purpose: this is a correctness nudge (not an optional prompt), so it
 * persists until it resolves itself — the moment a freshly-loaded panel reports a matching build id,
 * `panelStale` flips false and the bar disappears. Lives in the under-TopBar bar stack next to UpdateBanner;
 * amber to match the "Restart AE" status dot.
 */
export function RestartAeBanner() {
  const aeConnected = useChatStore((s) => s.aeConnected)
  const panelStale = useChatStore((s) => s.panelStale)
  if (!aeConnected || !panelStale) return null

  return (
    <div className="flex items-center gap-3 border-b border-amber-400/20 bg-amber-400/10 px-4 py-2 text-[12px] text-amber-50/90">
      <span className="min-w-0 flex-1 truncate">
        Cubic updated its After Effects panel — restart After Effects to finish updating.
      </span>
    </div>
  )
}
