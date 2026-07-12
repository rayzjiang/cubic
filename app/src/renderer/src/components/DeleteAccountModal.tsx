import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useChatStore } from '../store'
import { EASE_OUT } from '../motion'
import { DANGER_BTN } from '../danger'

/**
 * P2 — destructive "Delete account" confirmation. Type-to-confirm (must type `Delete <their email>`) + a
 * red irreversible-warning button, GitHub-style. Root-mounted + store-driven (`deleteAccountOpen`);
 * renders OVER the Settings modal (z-60), same Shell vocabulary as SettingsModal.
 *
 * On success the main-process auth `change` broadcast flips the whole app to the signed-out AuthScreen,
 * so we drop this modal AND Settings. On failure the session is LEFT intact (nothing deleted, or only
 * billing was stopped) → show an inline error and stay open so the user can retry.
 */

function Shell({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12, ease: EASE_OUT }}
    >
      <motion.div
        className="w-96 max-w-[95vw] rounded-xl border border-white/10 bg-neutral-800 p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.15, ease: EASE_OUT }}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}

export function DeleteAccountModal() {
  const open = useChatStore((s) => s.deleteAccountOpen)
  const setOpen = useChatStore((s) => s.setDeleteAccountOpen)
  const setSettingsOpen = useChatStore((s) => s.setSettingsOpen)
  const email = useChatStore((s) => s.auth.user?.email) ?? ''
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset the field/state each time it opens.
  useEffect(() => {
    if (open) {
      setText('')
      setError(null)
      setBusy(false)
    }
  }, [open])

  // Escape closes (but never mid-delete).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, setOpen])

  const close = (): void => {
    if (!busy) setOpen(false)
  }

  // Must type "Delete <their email>" (case-insensitive) — a strong, deliberate signal tied to THIS account.
  const target = email ? `Delete ${email}` : 'delete'
  const confirmed = text.trim().toLowerCase() === target.toLowerCase()

  const onDelete = async (): Promise<void> => {
    if (!confirmed || busy) return
    setBusy(true)
    setError(null)
    const r = await window.cubic.deleteAccount()
    if (r.ok) {
      // Account gone → the auth `change` broadcast routes to the AuthScreen. Also close Settings (left
      // open behind this modal) so it can't linger over the signed-out screen.
      setOpen(false)
      setSettingsOpen(false)
      return
    }
    setBusy(false)
    setError("Couldn't delete your account — please try again.")
  }

  return (
    <AnimatePresence>
      {open && (
        <Shell key="delete-account" onClose={close}>
          <h2 className="text-[15px] font-semibold text-white/90">Delete account</h2>
          <p className="mt-2 text-[13px] text-white/55">
            This permanently deletes your account and everything in it. This can’t be undone.
          </p>
          <label className="mt-4 block text-[12px] text-white/45">
            Type <span className="break-all font-medium text-white/70">{target}</span> to confirm
          </label>
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onDelete()
            }}
            disabled={busy}
            placeholder={target}
            className="mt-1.5 w-full rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 text-[13px] text-white/90 outline-none placeholder:text-white/30 focus:border-white/30 disabled:opacity-50"
          />
          {error && <p className="mt-2 text-[12px] text-red-400">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={close}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-[13px] text-white/70 hover:bg-white/10 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void onDelete()}
              disabled={!confirmed || busy}
              className={`${DANGER_BTN} disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {busy ? 'Deleting…' : 'Delete account'}
            </button>
          </div>
        </Shell>
      )}
    </AnimatePresence>
  )
}
