import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useChatStore } from '../store'
import { EASE_OUT } from '../motion'
import { isFileBlocked } from '../fileAccess'
import { sendCheckFileAccess } from '../ws'

/**
 * §D-1a — the AE file-access gate. Cubic can't save frames or take the pre-turn backups it uses for
 * undo when After Effects' "Allow Scripts to Write Files and Access Network" setting is off, so we
 * hard-gate all sending until it's on. Mirrors the paywall trio (FullscreenPaywall / PaywallBanner /
 * composer gate), driven by `isFileBlocked` instead of entitlement:
 *   - <FileAccessOverlay/> : a dismissable, blurred fullscreen modal (root-mounted). Shown when blocked
 *     and not yet dismissed this session. Dismiss → collapses to the banner.
 *   - <FileAccessBanner/>  : the slim in-context bar after the modal was dismissed (composer still gated).
 *
 * Re-check is event-driven (no polling): the backend re-probes on every AE (re)connect + window focus
 * (App.tsx), and the modal's "Re-check" button asks on demand. The overlay/banner auto-clear the moment
 * the backend reports `canWriteFiles: true` (isFileBlocked flips false → both unmount). Copy is
 * placeholder — P3c's §D-4 finalizes it.
 */

/** The shared body — enable steps + a manual re-check. */
function FileAccessBody({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex w-full max-w-md flex-col items-center text-center">
      <h1 className="text-[22px] font-semibold tracking-tight text-white/90">Let Cubic edit your project</h1>
      <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-white/55">
        After Effects is blocking file access, so Cubic can’t save frames or create the automatic backups
        it uses to undo changes. Turn it on to keep going:
      </p>

      <ol className="mt-6 w-full space-y-2.5 text-left">
        <Step n={1}>
          In After Effects, open <span className="text-white/80">Settings → Scripting &amp; Expressions</span>{' '}
          <span className="text-white/40">(Preferences on older versions)</span>.
        </Step>
        <Step n={2}>
          Enable <span className="text-white/80">“Allow Scripts to Write Files and Access Network”</span>.
        </Step>
        <Step n={3}>You may need to restart After Effects afterward.</Step>
      </ol>

      <button
        onClick={() => sendCheckFileAccess()}
        className="mt-7 rounded-lg bg-white px-5 py-2.5 text-[13px] font-medium text-neutral-900 hover:bg-white/90"
      >
        I’ve enabled it — Re-check
      </button>
      <p className="mt-3 text-[11.5px] text-white/35">
        If it doesn’t clear, restart After Effects — Cubic reconnects automatically.
      </p>

      <button onClick={onDismiss} className="mt-6 text-[12px] text-white/35 hover:text-white/60">
        Dismiss for now
      </button>
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-[13px] leading-relaxed text-white/70">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-medium text-white/70">
        {n}
      </span>
      <span>{children}</span>
    </li>
  )
}

/** Root-mounted dismissable fullscreen modal (mirrors PaywallOverlay). Shown when blocked + not dismissed. */
export function FileAccessOverlay() {
  const open = useChatStore((s) => isFileBlocked(s) && !s.fileGateDismissed)
  const dismiss = useChatStore((s) => s.setFileGateDismissed)

  // Esc dismisses (→ banner), matching the modal's "Dismiss for now".
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismiss(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dismiss])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="fileaccess-overlay"
          className="fixed inset-0 z-[55] flex flex-col bg-black/75 backdrop-blur-2xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: EASE_OUT }}
        >
          <motion.div
            className="flex flex-1 items-center justify-center overflow-y-auto p-8"
            initial={{ opacity: 0, y: 8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
          >
            <FileAccessBody onDismiss={() => dismiss(true)} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** In-context bar after the modal was dismissed (mirrors PaywallBanner). Composer stays gated. */
export function FileAccessBanner() {
  const setDismissed = useChatStore((s) => s.setFileGateDismissed)
  return (
    <div className="flex items-center gap-3 border-b border-amber-400/20 bg-amber-400/10 px-4 py-2 text-[12px] text-amber-50/90">
      <span className="min-w-0 flex-1 truncate">
        After Effects file access is off — Cubic can’t save or back up your work.
      </span>
      <button
        onClick={() => setDismissed(false)}
        className="shrink-0 rounded-md bg-amber-400/90 px-2.5 py-1 text-[12px] font-medium text-neutral-900 hover:bg-amber-400"
      >
        Enable file access
      </button>
    </div>
  )
}
