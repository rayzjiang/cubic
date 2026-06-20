import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useChatStore } from '../store'
import { useMotion } from '../motion'

/**
 * Top-right transient notifications (e.g. "Conversation deleted"). Each toast slides in from the right
 * and fades out in place when it auto-dismisses. AnimatePresence keeps a dismissed toast mounted long
 * enough to play its exit; `layout` lets the remaining toasts slide up smoothly to fill the gap.
 */
export function Toasts() {
  const toasts = useChatStore((s) => s.toasts)
  // top-11 drops the stack below the TopBar (h-9 = 36px) with an ~8px gap so toasts clear the header.
  return (
    <div className="pointer-events-none fixed right-4 top-11 z-[60] flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <Toast key={t.id} id={t.id} text={t.text} />
        ))}
      </AnimatePresence>
    </div>
  )
}

function Toast({ id, text }: { id: string; text: string }) {
  const dismissToast = useChatStore((s) => s.dismissToast)
  const { toast } = useMotion()
  useEffect(() => {
    const timer = setTimeout(() => dismissToast(id), 2600)
    return () => clearTimeout(timer)
  }, [id, dismissToast])

  return (
    <motion.div
      layout
      variants={toast}
      initial="initial"
      animate="animate"
      exit="exit"
      className="pointer-events-auto rounded-lg border border-white/10 bg-neutral-800/95 px-3.5 py-2 text-[13px] text-white/85 shadow-lg"
    >
      {text}
    </motion.div>
  )
}
