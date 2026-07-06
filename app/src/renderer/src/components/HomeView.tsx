import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { useChatStore } from '../store'
import { useMotion } from '../motion'
import { useScrollFade } from '../useScrollFade'
import { ConversationRow } from './ConversationRow'
import { AccountWidget } from './AccountWidget'

/**
 * The landing screen (main pane on launch): a centered "Welcome back" greeting + New chat, then the
 * project's conversations (newest first, the most-recent badged) in a tightened column. Picking a chat
 * opens it. The persistent sidebar lives in the chat layout; this is the dedicated home the user lands on.
 *
 * The greeting + Recents scroll in a bounded flex-1 region; the account widget is pinned in the
 * bottom-left corner below it (no full-width bar — Home has no sidebar to host it), so the list stays
 * bounded above it and never overlaps.
 */
export function HomeView() {
  const conversations = useChatStore((s) => s.conversations)
  const newChat = useChatStore((s) => s.newChat)
  const fadeRef = useScrollFade<HTMLDivElement>()
  const { listStagger, listRow } = useMotion()

  // Kick the stagger one tick after mount. App's <AnimatePresence initial={false}> suppresses the enter
  // animation of everything present on the app's FIRST paint — and the conversation rows are already
  // loaded by then (listLoaded gates the body) — so on a cold open the list would otherwise just appear.
  // Flipping a state flag post-mount makes Motion animate it as a prop change, bypassing that
  // suppression. Re-runs on every Home mount (e.g. chat→home), so the cascade plays each visit.
  const [runList, setRunList] = useState(false)
  useEffect(() => {
    setRunList(true)
  }, [])

  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <div ref={fadeRef} className="scroll-fade min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-lg px-6 pb-8 pt-12">
          {/* Centered welcome + primary action. */}
          <div className="flex flex-col items-center text-center">
            <h1 className="text-[28px] font-semibold tracking-tight text-white/90">Welcome back</h1>
            <p className="mt-1 text-sm text-white/45">Pick up a conversation or start something new.</p>
            <button
              onClick={newChat}
              className="mt-6 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/15"
            >
              + New chat
            </button>
          </div>

          {/* Recents: left-aligned rows (scannable top-to-bottom) in the tightened column. */}
          <div className="mt-10">
            {conversations.length === 0 ? (
              <p className="text-center text-sm text-white/35">No conversations yet for this project — start one above.</p>
            ) : (
              <>
                <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-white/35">Recent</h2>
                {/* Rows stagger-fade in on each home enter (HomeView remounts via App's AnimatePresence).
                    The stagger lives here, not in ConversationRow, so the sidebar's rows never stagger. */}
                <motion.ul className="space-y-0.5" variants={listStagger} initial="initial" animate={runList ? 'animate' : 'initial'}>
                  {conversations.map((c) => (
                    <motion.li key={c.id} variants={listRow}>
                      <ConversationRow conv={c} />
                    </motion.li>
                  ))}
                </motion.ul>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Account pill pinned bottom-left corner (no divider bar). The list above is bounded (flex-1) so it
          never scrolls under it; the `flex` wrapper keeps the pill content-width at the left rather than
          stretching it across the pane. */}
      <div className="flex">
        <AccountWidget />
      </div>
    </div>
  )
}
