import { useState } from 'react'
import { useChatStore } from '../store'

/**
 * Composer. Enter sends, Shift+Enter newlines. Sending mid-turn is allowed — the store queues it as
 * a steer (the removable "queued" chip lands in Step 5). The Stop button is worktree ⑥.
 */
export function InputBar() {
  const running = useChatStore((s) => s.running)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const [draft, setDraft] = useState('')

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    sendMessage(text)
    setDraft('')
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-5">
      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 focus-within:border-white/20">
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
          placeholder={running ? 'Add a follow-up — Cubic picks it up as it works…' : 'Tell Cubic what to make…'}
          className="max-h-40 w-full resize-none bg-transparent text-[14px] leading-relaxed text-white/90 outline-none placeholder:text-white/30"
        />
      </div>
    </div>
  )
}
