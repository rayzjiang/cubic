import { useEffect } from 'react'
import { useChatStore } from '../store'

/**
 * Top-right transient notifications (e.g. "Conversation deleted"). Each toast auto-dismisses itself
 * after a short delay; the store just holds the list.
 */
export function Toasts() {
  const toasts = useChatStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex flex-col gap-2">
      {toasts.map((t) => (
        <Toast key={t.id} id={t.id} text={t.text} />
      ))}
    </div>
  )
}

function Toast({ id, text }: { id: string; text: string }) {
  const dismissToast = useChatStore((s) => s.dismissToast)
  useEffect(() => {
    const timer = setTimeout(() => dismissToast(id), 2600)
    return () => clearTimeout(timer)
  }, [id, dismissToast])

  return (
    <div className="pointer-events-auto rounded-lg border border-white/10 bg-neutral-800/95 px-3.5 py-2 text-[13px] text-white/85 shadow-lg">
      {text}
    </div>
  )
}
