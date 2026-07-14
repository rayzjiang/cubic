import { motion } from 'motion/react'
import { useChatStore } from '../store'
import { EASE_OUT } from '../motion'
import { isBlocked } from '../billing/entitlement'

/**
 * §D-1 "try it" nudge — the one-time, post-subscribe prompt on Home that points a brand-new paid user at
 * their first two actions: start a chat + open their AE project. Shown under the "+ New chat" button only
 * while the user is signed in, NOT subscription-blocked (Home is only reached past the paywall), and
 * hasn't started a chat yet (`!triedItSeen`). The live line reads `aeConnected` so it flips to "connected"
 * the moment they open a project. Dismissed for good when they start their first chat (HomeView calls
 * markTriedIt on New chat). Copy is placeholder — P3c's §D-4 finalizes it.
 */
export function TryItCoachmark() {
  const show = useChatStore((s) => s.auth.status === 'signedIn' && !isBlocked(s.billing) && !s.triedItSeen)
  const aeConnected = useChatStore((s) => s.aeConnected)
  if (!show) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: EASE_OUT, delay: 0.15 }}
      className="mt-5 flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3"
    >
      <span className="text-[13px] font-medium text-white/85">Start your first chat</span>
      <span className="flex items-center gap-1.5 text-[12px] text-white/45">
        <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${aeConnected ? 'bg-green-400' : 'bg-amber-400'}`} />
        {aeConnected ? 'After Effects connected — you’re set' : 'Open your After Effects project to begin'}
      </span>
    </motion.div>
  )
}
