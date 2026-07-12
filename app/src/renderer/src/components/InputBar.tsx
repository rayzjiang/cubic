import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { useChatStore } from '../store'
import { useMotion } from '../motion'
import { isBlocked } from '../billing/entitlement'

/**
 * Composer. Enter or the send button (↑) submit — both call submit(). Shift+Enter newlines. Sending
 * mid-turn is allowed — the store queues it as a steer and shows a removable "queued" chip here (it
 * fires at the next boundary). While a turn runs, the send button becomes a Stop button (and a global
 * Esc cancels) — both call cancelRun() (§D).
 */
export function InputBar() {
  const running = useChatStore((s) => s.running)
  const blocked = useChatStore((s) => isBlocked(s.billing))
  const isEmpty = useChatStore((s) => s.items.length === 0)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const cancelRun = useChatStore((s) => s.cancelRun)
  const queuedSteers = useChatStore((s) => s.queuedSteers)
  const cancelSteer = useChatStore((s) => s.cancelSteer)
  const restoreDraft = useChatStore((s) => s.restoreDraft)
  const clearRestoreDraft = useChatStore((s) => s.clearRestoreDraft)
  const { morphTransition, composerGlide } = useMotion()
  const [draft, setDraft] = useState('')

  // A discarded turn (stopped before any output) returns its text to the composer — as if never sent.
  // Don't clobber anything the user typed in the brief stop window.
  useEffect(() => {
    if (restoreDraft !== null) {
      setDraft((d) => d || restoreDraft)
      clearRestoreDraft()
    }
  }, [restoreDraft, clearRestoreDraft])

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

  const placeholder = blocked
    ? 'Subscribe to keep chatting with Cubic…'
    : running
      ? 'Add a follow-up — Cubic picks it up as it works…'
      : isEmpty
        ? 'What are we building today?'
        : 'Send a message…'

  const submit = () => {
    // Blocked (no plan / over cap / past due) → the paywall banner above owns the CTA; the composer is
    // inert (the proxy would 402 the send anyway).
    if (blocked) return
    const text = draft.trim()
    if (!text) return
    // A stop is still finalizing on the backend (sub-second). Hold the send — and keep the draft —
    // so we don't fire a fresh turn before the cancelled one has unwound ("already running").
    if (useChatStore.getState().cancelling) return
    sendMessage(text)
    setDraft('')
  }

  return (
    // layout="position" animates ONLY the center→bottom glide when ChatPane drops its spacers on the
    // first message (size changes — textarea growth, chips — stay instant). See motion.ts composerGlide.
    <motion.div layout="position" transition={{ layout: composerGlide }} className="mx-auto w-full max-w-2xl px-5 pb-5">
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
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/4 px-3 py-2 focus-within:border-white/20">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={1}
          disabled={blocked}
          placeholder={placeholder}
          className="field-sizing-content max-h-[33vh] min-w-0 flex-1 resize-none overflow-y-auto bg-transparent text-[14px] leading-relaxed text-white/90 outline-none placeholder:text-white/30 disabled:cursor-not-allowed"
        />
        {/* One persistent square shell — the icon crossfades between send (↑) and stop (■) so both
            sit in the exact same spot and the swap reads as a smooth morph (§D). */}
        <button
          onClick={running ? cancelRun : submit}
          disabled={blocked || (!running && !draft.trim())}
          className="relative inline-flex h-7 w-7 shrink-0 self-end items-center justify-center rounded-lg bg-white text-neutral-900 transition-colors duration-200 hover:bg-white/90 disabled:bg-white/15 disabled:text-white/40"
          aria-label={running ? 'Stop' : 'Send'}
          title={running ? 'Stop (Esc)' : 'Send (Enter)'}
        >
          <motion.svg
            viewBox="0 0 16 16"
            className="absolute h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            animate={running ? { scale: 0.5, opacity: 0 } : { scale: 1, opacity: 1 }}
            transition={morphTransition}
          >
            <path d="M8 13V3M4 7l4-4 4 4" />
          </motion.svg>
          <motion.span
            className="absolute block h-2.5 w-2.5 rounded-[2px] bg-current"
            animate={running ? { scale: 1, opacity: 1 } : { scale: 0.5, opacity: 0 }}
            transition={morphTransition}
          />
        </button>
      </div>
    </motion.div>
  )
}
