import { useEffect, useState } from 'react'
import { useChatStore } from '../store'

/**
 * Composer. Enter sends, Shift+Enter newlines. Sending mid-turn is allowed — the store queues it as a
 * steer and shows a removable "queued" chip here (it fires at the next boundary). While a turn runs,
 * the composer also shows a Stop button (and a global Esc cancels) — both call cancelRun() (§D).
 */
export function InputBar() {
  const running = useChatStore((s) => s.running)
  const isEmpty = useChatStore((s) => s.items.length === 0)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const cancelRun = useChatStore((s) => s.cancelRun)
  const queuedSteers = useChatStore((s) => s.queuedSteers)
  const cancelSteer = useChatStore((s) => s.cancelSteer)
  const [draft, setDraft] = useState('')

  // Global Esc interrupts a running turn (Claude Code-style); inert when nothing is running so it
  // never swallows Esc elsewhere. Reads `running` live from the store to avoid a stale closure.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useChatStore.getState().running) {
        e.preventDefault()
        cancelRun()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancelRun])

  const placeholder = running
    ? 'Add a follow-up — Cubic picks it up as it works…'
    : isEmpty
      ? 'What are we building today?'
      : 'Send a message…'

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    // A stop is still finalizing on the backend (sub-second). Hold the send — and keep the draft —
    // so we don't fire a fresh turn before the cancelled one has unwound ("already running").
    if (useChatStore.getState().cancelling) return
    sendMessage(text)
    setDraft('')
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-5">
      {queuedSteers.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {queuedSteers.map((q) => (
            <span key={q.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/10 py-1 pl-3 pr-2 text-[12px] text-white/70">
              <span className="truncate">{q.text}</span>
              <span className="shrink-0 text-white/35">· queued</span>
              <button onClick={() => cancelSteer(q.id)} className="shrink-0 text-white/40 hover:text-white/80" aria-label="Cancel queued message">
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-white/4 px-3 py-2 focus-within:border-white/20">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={2}
          placeholder={placeholder}
          className="max-h-40 min-w-0 flex-1 resize-none bg-transparent text-[14px] leading-relaxed text-white/90 outline-none placeholder:text-white/30"
        />
        {running && (
          <button
            onClick={cancelRun}
            className="mb-0.5 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-white/10 px-2.5 text-[12px] font-medium text-white/70 hover:bg-white/20 hover:text-white/90"
            aria-label="Stop"
            title="Stop (Esc)"
          >
            <span className="block h-2.5 w-2.5 rounded-[2px] bg-current" />
            Stop
          </button>
        )}
      </div>
    </div>
  )
}
