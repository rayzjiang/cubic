import type { ReactNode } from 'react'
import { useChatStore } from '../store'

/**
 * Centered confirmation modal for irreversible actions. Renders the restore-rewind confirm or the
 * delete confirm (whichever is pending). Backdrop click or Cancel dismisses. Rendered at the app root.
 */
function Shell({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        className="w-90 rounded-xl border border-white/10 bg-neutral-800 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

export function ConfirmModal() {
  const pendingDelete = useChatStore((s) => s.pendingDeleteConfirm)
  const confirmDelete = useChatStore((s) => s.confirmDelete)
  const cancelDelete = useChatStore((s) => s.cancelDelete)
  const pendingRestore = useChatStore((s) => s.pendingRestoreConfirm)
  const confirmRestore = useChatStore((s) => s.confirmRestore)
  const cancelRestore = useChatStore((s) => s.cancelRestore)
  const pendingOpen = useChatStore((s) => s.pendingOpenProjectConfirm)
  const confirmOpenProject = useChatStore((s) => s.confirmOpenProject)
  const cancelOpenProject = useChatStore((s) => s.cancelOpenProject)

  if (pendingOpen) {
    const name = pendingOpen.path.split('/').pop() || 'that project'
    return (
      <Shell onCancel={cancelOpenProject}>
        <h2 className="text-[15px] font-semibold text-white/90">Open {name}?</h2>
        <p className="mt-2 text-[13px] text-white/55">
          The project currently open in After Effects has unsaved changes. Opening {name} will close it.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={cancelOpenProject} className="rounded-md px-3 py-1.5 text-[13px] text-white/70 hover:bg-white/10">
            Cancel
          </button>
          <button onClick={() => confirmOpenProject('discard')} className="rounded-md px-3 py-1.5 text-[13px] text-white/70 hover:bg-white/10">
            Discard &amp; open
          </button>
          {/* An unsaved (never-saved) project can't be saved without a Save-As dialog (which would hang the
              bridge), so offer Save only when the current project has a file. */}
          {!pendingOpen.currentUntitled && (
            <button onClick={() => confirmOpenProject('save')} className="rounded-md bg-blue-500/90 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-500">
              Save &amp; open
            </button>
          )}
        </div>
      </Shell>
    )
  }

  if (pendingRestore) {
    return (
      <Shell onCancel={cancelRestore}>
        <h2 className="text-[15px] font-semibold text-white/90">Restore to before this request?</h2>
        <p className="mt-2 text-[13px] text-white/55">
          This rewinds your entire After Effects project back to before this request. Anything done
          after that point (including any manual changes) will be lost, along
          with this request and everything after it in the chat.
        </p>
        <p className="mt-2 text-[13px] text-white/45">This can’t be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={cancelRestore} className="rounded-md px-3 py-1.5 text-[13px] text-white/70 hover:bg-white/10">
            Cancel
          </button>
          <button onClick={confirmRestore} className="rounded-md bg-amber-500/90 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-amber-500">
            Restore
          </button>
        </div>
      </Shell>
    )
  }

  if (pendingDelete) {
    return (
      <Shell onCancel={cancelDelete}>
        <h2 className="text-[15px] font-semibold text-white/90">Delete this chat?</h2>
        <p className="mt-1.5 truncate text-[13px] text-white/55">“{pendingDelete.title}”</p>
        <p className="mt-2 text-[13px] text-white/45">This can’t be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={cancelDelete} className="rounded-md px-3 py-1.5 text-[13px] text-white/70 hover:bg-white/10">
            Cancel
          </button>
          <button onClick={confirmDelete} className="rounded-md bg-red-500/90 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-red-500">
            Delete
          </button>
        </div>
      </Shell>
    )
  }

  return null
}
