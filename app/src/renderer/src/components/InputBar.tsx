import { useState } from 'react'
import { useChatStore } from '../store'

/**
 * Composer. Enter sends, Shift+Enter newlines. Sending mid-turn is allowed — the store queues it as a
 * steer and shows a removable "queued" chip here (it fires at the next boundary). The Stop button is
 * worktree ⑥.
 */
export function InputBar() {
  const running = useChatStore((s) => s.running)
  const isEmpty = useChatStore((s) => s.items.length === 0)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const queuedSteers = useChatStore((s) => s.queuedSteers)
  const cancelSteer = useChatStore((s) => s.cancelSteer)
  const [draft, setDraft] = useState('')

  const placeholder = running
    ? 'Add a follow-up — Cubic picks it up as it works…'
    : isEmpty
      ? 'What are we building today?'
      : 'Send a message…'

  const submit = () => {
    const text = draft.trim()
    if (!text) return
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
      <div className="rounded-xl border border-white/10 bg-white/4 px-3 py-2 focus-within:border-white/20">
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
          className="max-h-40 w-full resize-none bg-transparent text-[14px] leading-relaxed text-white/90 outline-none placeholder:text-white/30"
        />
      </div>
    </div>
  )
}
