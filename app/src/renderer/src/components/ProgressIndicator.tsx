/**
 * Fills the dead air while the model reasons (turn start before the first action, and between a
 * tool finishing and the next action/text). Spinner + a motion-themed gerund cycled by the store.
 */
export function ProgressIndicator({ word }: { word: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-[13px] text-white/45">
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/15 border-t-white/60" />
      <span>{word}</span>
    </div>
  )
}
