import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useChatStore } from '../store'
import { MSG_STAGGER_STEP, useMotion } from '../motion'
import { useScrollFade } from '../useScrollFade'
import type { DisplayItem } from '../protocol'
import { UserPrompt } from './UserPrompt'
import { AssistantMessage } from './AssistantMessage'
import { ToolActionRow } from './ToolActionRow'
import { ProgressIndicator } from './ProgressIndicator'
import { CompactionPill } from './CompactionPill'
import { CompactionSummary } from './CompactionSummary'
import { firstName } from '../ui'
import { chatGreeting } from '../greetings'
import cubicLogoUrl from '../assets/cubic-logo.svg'

// Distance from the bottom (px) that still counts as "pinned" — within this, stick-to-bottom stays on.
const PIN_THRESHOLD = 48
// At max scroll, leave this many px of the PREVIOUS turn peeking above the pinned message, so it's
// obvious there's history to scroll up to (only shows when there actually is content above).
const PEEK_ABOVE = 40

/**
 * The transcript. One flat DisplayItem[] (history + live share the shape) rendered in order: each
 * user prompt is boxed and starts a new "turn"; assistant text + tool rows flow full-width below it.
 *
 * Scroll model (ChatGPT/Claude.ai-style):
 * - The LAST turn gets a min-height of the viewport, so the most-recent user message can sit at the
 *   top — a short reply leaves whitespace down to the composer; a long reply just grows past it.
 * - Auto-scroll sticks to the bottom ONLY while "pinned" (already at the bottom). If you've scrolled
 *   up, neither your own send nor an incoming AI reply yanks you down — instead a "jump to latest"
 *   button appears, with a notification dot when new content arrived while you were away.
 */
export function MessageList() {
  const items = useChatStore((s) => s.items)
  const running = useChatStore((s) => s.running)
  const progressWord = useChatStore((s) => s.progressWord)
  const compacting = useChatStore((s) => s.compacting)
  const sessionId = useChatStore((s) => s.sessionId)
  const user = useChatStore((s) => s.auth.user)
  const { messageEntrance } = useMotion()

  const fadeRef = useScrollFade<HTMLDivElement>()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const pinnedRef = useRef(true) // synchronous source of truth for effects
  const programmaticRef = useRef(false) // a smooth jump is in flight → ignore its own scroll frames
  const [pinned, setPinned] = useState(true) // mirror for rendering the jump button
  const [hasNew, setHasNew] = useState(false) // new content arrived while scrolled up
  const [viewportH, setViewportH] = useState(0)
  const prevLen = useRef(items.length)

  // Distinguish a fresh chat load (→ cascade its visible tail) from a live append (→ single fade). On
  // openChat the store blanks items, then the async 'history' reply replaces them wholesale — so the
  // render where items first populate for a session is the load; freeze its length as the baseline.
  // Rows at index < baseLen are loaded history; index >= baseLen are streamed live afterward.
  const loadedSessionRef = useRef<string | null | undefined>(undefined)
  const baseLenRef = useRef(0)
  if (loadedSessionRef.current !== sessionId) {
    if (items.length > 0) {
      loadedSessionRef.current = sessionId
      baseLenRef.current = items.length
    }
  } else if (items.length < baseLenRef.current) {
    baseLenRef.current = items.length // items shrank (compaction) → keep later rows tagged live
  }
  const baseLen = baseLenRef.current

  // Callback ref (not an effect) so the ResizeObserver attaches whenever the scroll node mounts — the
  // empty state doesn't render it, so it appears only after the first message. Tracks the viewport's
  // height → the last turn's min-height (so the newest user message can reach the top), kept correct
  // across window/panel resizes.
  const setScrollEl = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el
    roRef.current?.disconnect()
    if (!el) return
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight))
    ro.observe(el)
    roRef.current = ro
    setViewportH(el.clientHeight)
  }, [])

  // Compose the transcript's own scroll-node ref with the scroll-fade ref (dynamic top/bottom fade).
  const attachScroll = useCallback(
    (el: HTMLDivElement | null) => {
      setScrollEl(el)
      fadeRef(el)
    },
    [setScrollEl, fadeRef],
  )

  const scrollToBottom = (behavior: ScrollBehavior) => {
    const el = scrollRef.current
    if (!el) return
    if (behavior === 'smooth') programmaticRef.current = true
    el.scrollTo({ top: el.scrollHeight, behavior })
  }

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD
    // Ignore the in-between frames of our own smooth jump (else the button would flicker). A real
    // wheel/touch clears the flag (see onUserScrollIntent), so the user can still interrupt mid-jump.
    if (programmaticRef.current) {
      if (atBottom) programmaticRef.current = false
      return
    }
    pinnedRef.current = atBottom
    setPinned(atBottom)
    if (atBottom) setHasNew(false) // caught back up → clear the notification
  }

  // A genuine user scroll gesture cancels "ignore programmatic frames", so interrupting a smooth jump
  // by scrolling up immediately un-pins (the button comes back).
  const onUserScrollIntent = () => { programmaticRef.current = false }

  // Opening / switching conversations re-pins to the bottom (show the latest), even if the previous
  // chat was left scrolled up. History loads async after the id changes, so the stick effect below
  // does the actual scroll once items arrive.
  useEffect(() => {
    pinnedRef.current = true
    setPinned(true)
    setHasNew(false)
  }, [sessionId])

  // Stick to the bottom ONLY when pinned. When scrolled up, never yank — just flag that new content
  // landed so the jump button shows its dot. `auto` (instant) keeps it glued without smooth-scroll
  // stutter as items append over a turn; the deliberate jump button uses smooth below.
  useEffect(() => {
    const grew = items.length > prevLen.current
    prevLen.current = items.length
    if (pinnedRef.current) scrollToBottom('auto')
    else if (grew) setHasNew(true)
  }, [items, running, progressWord, compacting, viewportH])

  const jumpToLatest = () => {
    pinnedRef.current = true
    setPinned(true)
    setHasNew(false)
    scrollToBottom('smooth')
  }

  if (items.length === 0 && !running && !compacting) {
    const fn = firstName(user)
    // Natural height (NOT flex-1): ChatPane sandwiches this greeting + the composer between equal flex
    // spacers, so the pair centers vertically as one group (Claude-style new-chat screen). pb gives the
    // gap down to the composer. Once a turn starts, the transcript path below takes over (flex-1 fill).
    return (
      <div className="flex flex-col items-center px-6 pb-6 text-center">
        <img src={cubicLogoUrl} alt="" className="mb-4 h-14 w-14" />
        <h2 className="text-xl font-medium text-white/70">
          {chatGreeting(fn)}
        </h2>
        <p className="mt-2 max-w-sm text-sm text-white/35">Describe a look, a motion, or an edit — Cubic makes it for you in After Effects.</p>
      </div>
    )
  }

  // Cascade only the visible tail: the transcript is bottom-pinned, so the last few items are what's on
  // screen. Older history appears instantly (off-screen anyway); live-streamed rows (index >= baseLen)
  // get a single no-delay fade — current behavior. Top-to-bottom: earlier visible rows lead, the newest
  // lands last. Matches the home list (shared STAGGER_* tokens). `custom` feeds each row's delay to the
  // messageEntrance variant. y is a transform, not layout → never shifts scrollHeight / the pin math.
  const CASCADE_CAP = 6
  const cascadeStart = Math.max(0, baseLen - CASCADE_CAP)
  const entranceOf = (i: number): { animate: boolean; delay: number } => {
    if (i >= baseLen) return { animate: true, delay: 0 } // streamed live → single fade
    if (i < cascadeStart) return { animate: false, delay: 0 } // older history → instant, no animation
    return { animate: true, delay: (i - cascadeStart) * MSG_STAGGER_STEP }
  }

  // `suppressTopGap` drops a user prompt's top margin when it's the first row of the last-turn block
  // (that block supplies the spacing via its own padding) — keeps the message off the very top edge.
  const renderItem = (it: DisplayItem, i: number, suppressTopGap = false) => {
    const e = entranceOf(i)
    const enter = e.animate ? 'initial' : false
    if (it.kind === 'user') {
      return (
        <motion.div key={`${sessionId ?? 'new'}:${i}`} variants={messageEntrance} custom={e.delay} initial={enter} animate="animate" className={i === 0 || suppressTopGap ? '' : 'mt-7'}>
          <UserPrompt text={it.text} turnId={it.turnId} />
        </motion.div>
      )
    }
    if (it.kind === 'assistant') {
      return (
        <motion.div key={`${sessionId ?? 'new'}:${i}`} variants={messageEntrance} custom={e.delay} initial={enter} animate="animate" className="mt-3">
          <AssistantMessage text={it.text} />
        </motion.div>
      )
    }
    if (it.kind === 'interrupted') {
      return (
        <motion.div key={`${sessionId ?? 'new'}:${i}`} variants={messageEntrance} custom={e.delay} initial={enter} animate="animate" className="mt-3 flex items-center gap-2 text-[12px] text-white/30">
          <span className="h-px flex-1 bg-white/10" />
          Stopped
          <span className="h-px flex-1 bg-white/10" />
        </motion.div>
      )
    }
    if (it.kind === 'compaction') {
      return (
        <motion.div key={`${sessionId ?? 'new'}:${i}`} variants={messageEntrance} custom={e.delay} initial={enter} animate="animate" className="mt-3">
          <CompactionSummary summary={it.summary} />
        </motion.div>
      )
    }
    return (
      <motion.div key={`${sessionId ?? 'new'}:${i}`} variants={messageEntrance} custom={e.delay} initial={enter} animate="animate" className="mt-1.5">
        <ToolActionRow label={it.label} status={it.status} />
      </motion.div>
    )
  }

  // The last turn (from the most-recent user prompt onward) gets the viewport min-height so it can
  // scroll to the top. The in-flight pill/progress live inside it (they belong to that turn).
  let lastUserIdx = -1
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === 'user') { lastUserIdx = i; break }
  }
  const tail = (
    <>
      {compacting && <div className="mt-2"><CompactionPill /></div>}
      {running && progressWord && <div className="mt-2"><ProgressIndicator word={progressWord} /></div>}
    </>
  )

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={attachScroll}
        onScroll={onScroll}
        onWheel={onUserScrollIntent}
        onTouchStart={onUserScrollIntent}
        className="scroll-fade h-full overflow-y-auto"
      >
        {/* pt-6 only: the bottom spacing lives INSIDE the last-turn block (pb-6) so scrolling to the
            very bottom can't over-scroll past the pinned message and clip it. */}
        <div className="mx-auto max-w-2xl px-5 pt-6">
          {lastUserIdx < 0 ? (
            <div className="pb-6">
              {items.map((it, i) => renderItem(it, i))}
              {tail}
            </div>
          ) : (
            <>
              {items.slice(0, lastUserIdx).map((it, i) => renderItem(it, i))}
              {/* Last turn: min-height ≈ viewport so the newest user message pins near the top, while
                  pt-7 keeps it a touch below the top edge (never clipped) and pb-6 is the bottom gap.
                  Subtracting PEEK_ABOVE leaves a sliver of the previous turn showing at the top, so it's
                  clear there's history above (auto-zero on the first turn → nothing to peek). border-box
                  (Tailwind default) folds both paddings into the min-height → no over-scroll.
                  Tweak: `pt-7` = room above the message; PEEK_ABOVE = the peek; min-height = the pin. */}
              <div className="pt-7 pb-6" style={viewportH ? { minHeight: `${Math.max(0, viewportH - PEEK_ABOVE)}px` } : undefined}>
                {items.slice(lastUserIdx).map((it, j) => renderItem(it, lastUserIdx + j, j === 0))}
                {tail}
              </div>
            </>
          )}
        </div>
      </div>

      {!pinned && items.length > 0 && (
        <button
          onClick={jumpToLatest}
          aria-label="Jump to latest"
          className="absolute bottom-4 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-white/10 bg-neutral-800/90 text-white/70 shadow-lg backdrop-blur transition-colors hover:text-white"
        >
          <ChevronDownIcon />
          {hasNew && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-blue-400 ring-2 ring-neutral-900" />
          )}
        </button>
      )}
    </div>
  )
}

function ChevronDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 6.5 L8 10.5 L12 6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
