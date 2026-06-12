import { useChatStore } from '../store'

/**
 * Centered confirmation modal for a permanent delete. Backdrop click or Cancel dismisses; Delete
 * runs the optimistic remove (+ success toast). Rendered at the app root when a delete is pending.
 */
export function ConfirmModal() {
  const pending = useChatStore((s) => s.pendingDeleteConfirm)
  const confirmDelete = useChatStore((s) => s.confirmDelete)
  const cancelDelete = useChatStore((s) => s.cancelDelete)

  if (!pending) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={cancelDelete}>
      <div
        className="w-[360px] rounded-xl border border-white/10 bg-neutral-800 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-semibold text-white/90">Delete this chat?</h2>
        <p className="mt-1.5 truncate text-[13px] text-white/55">“{pending.title}”</p>
        <p className="mt-2 text-[13px] text-white/45">This can’t be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={cancelDelete} className="rounded-md px-3 py-1.5 text-[13px] text-white/70 hover:bg-white/10">
            Cancel
          </button>
          <button onClick={confirmDelete} className="rounded-md bg-red-500/90 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-red-500">
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
