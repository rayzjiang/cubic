import type { ToolStatus } from '../protocol'

/**
 * One agent action, Cursor-style: a compact row with a status icon + friendly label (from the
 * backend's describeToolCall). Not expandable — editors never need the raw params. Failures render
 * calm (amber, dimmed), since the agent usually self-heals forward. A `noop` (the action changed
 * nothing, e.g. "undo" with nothing left) renders neutral/dimmed — no success check.
 */
export function ToolActionRow({ label, status }: { label: string; status: ToolStatus }) {
  const labelClass = status === 'fail' ? 'text-amber-300/70' : status === 'noop' ? 'text-white/40' : 'text-white/70'
  return (
    <div className="flex items-center gap-2 py-0.5 text-[13px]">
      <StatusIcon status={status} />
      <span className={labelClass}>{label}</span>
    </div>
  )
}

function StatusIcon({ status }: { status: ToolStatus }) {
  if (status === 'running') {
    return <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
  }
  if (status === 'fail') {
    return <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center text-[11px] text-amber-300/80">!</span>
  }
  if (status === 'noop') {
    return <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center text-[11px] text-white/40">–</span>
  }
  return <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center text-[11px] text-green-400">✓</span>
}
