/**
 * Brief splash shown on launch until the first conversation list lands — avoids the UI rendering and
 * then the conversations popping in a beat later. Replaced by the home/chat the moment data arrives.
 */
export function LoadingScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 [-webkit-app-region:drag]">
      <span className="text-2xl font-semibold tracking-tight text-white/80">Cubic</span>
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/15 border-t-white/60" />
    </div>
  )
}
