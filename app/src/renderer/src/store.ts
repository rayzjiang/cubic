import { create } from 'zustand'
import type { BackendStatus } from '@shared/ipc'
import type { AgentEvent, ConversationMeta, DisplayItem, ServerMessage } from './protocol'
import {
  type Connection,
  sendAttach,
  sendCancel,
  sendDelete,
  sendList,
  sendLoadHistory,
  sendQueue,
  sendRemoveQueue,
  sendRename,
  sendRestore,
  sendUserChat,
} from './ws'
import { track } from './analytics'

// ── Persisted navigation (survives an in-window reload, NOT a fresh launch) ──
// We remember the active conversation + view so a ⌘R / window reload lands back where the user was and
// can re-attach to an in-flight turn. Stored in sessionStorage on purpose: it persists across a reload
// but starts empty for a brand-new window/process — so a fresh app launch lands on Home, while a reload
// restores. Only the pointers are stored; history/live state reload from the backend.
const NAV_KEY = { session: 'cubic.sessionId', view: 'cubic.view' } as const
function loadNav(): { sessionId: string | null; view: 'home' | 'chat' } {
  try {
    const sessionId = sessionStorage.getItem(NAV_KEY.session)
    const view = sessionStorage.getItem(NAV_KEY.view) === 'chat' && sessionId ? 'chat' : 'home'
    return { sessionId, view }
  } catch {
    return { sessionId: null, view: 'home' }
  }
}
function saveNav(sessionId: string | null, view: 'home' | 'chat'): void {
  try {
    if (sessionId) sessionStorage.setItem(NAV_KEY.session, sessionId)
    else sessionStorage.removeItem(NAV_KEY.session)
    sessionStorage.setItem(NAV_KEY.view, view)
  } catch {
    /* storage unavailable — non-fatal, we just don't restore on reload */
  }
}

// ── Friendly transient-error mapping (raw SDK/transport text → plain English) ──
function mapError(raw: string): string {
  if (/overloaded|rate.?limit|\b429\b|\b529\b/i.test(raw)) return 'Cubic is busy right now — try again in a moment.'
  if (/network|fetch failed|ECONN|ENOTFOUND|socket hang/i.test(raw)) return "Couldn't reach the server — check your connection and try again."
  if (/AE.?disconnect|plugin not connected|not connected/i.test(raw)) return "After Effects isn't connected. Open AE with the Cubic bridge running."
  if (/timed? ?out|timeout/i.test(raw)) return 'That step took too long. Want to try again?'
  return 'Something went wrong on that step. Want to try again?'
}

// ── Motion-themed progress words, cycled during reasoning gaps (§C "spinner + progress words") ──
const PROGRESS_WORDS = [
  'Animating…', 'Keyframing…', 'Easing it in…', 'Compositing…', 'Tweening…',
  'Adding some bounce…', 'Nudging pixels…', 'Sequencing…', 'Smoothing…', 'Polishing…', 'Juicing…',
]
function pickWord(): string {
  return PROGRESS_WORDS[Math.floor(Math.random() * PROGRESS_WORDS.length)]
}

interface ChatState {
  // connection + navigation
  connection: Connection
  // Live AE (CEP worker) connectivity, pushed by the backend (`aeStatus`). Distinct from `connection`
  // (the renderer↔backend link): drives the always-on After Effects status dot.
  aeConnected: boolean
  // Backend-link status, pushed by main over IPC (distinct from `connection`, the renderer's own WS):
  // covers backend crash/reconnect/port-in-use/install — states the WS can't carry when it's down.
  backendStatus: BackendStatus
  view: 'home' | 'chat'
  projectPath: string
  // sidebar/home list
  conversations: ConversationMeta[]
  listLoaded: boolean
  sidebarCollapsed: boolean
  // active conversation
  sessionId: string | null
  items: DisplayItem[]
  running: boolean
  // True from the moment Stop/Esc is pressed until the turn actually ends — drives the "Stopping…"
  // affordance so the click has immediate feedback even while the backend finishes the current step.
  cancelling: boolean
  liveToolIds: Set<string>
  progressWord: string | null
  compacting: boolean
  contextFull: { message: string } | null
  error: { friendly: string; raw: string } | null
  lastUserText: string | null
  queuedSteers: { id: string; text: string }[]
  // delete-refusal tracking (rollback an optimistic removal if the backend refuses mid-turn)
  pendingDeletes: Set<string>
  // transient UI: confirm-delete modal target + auto-dismissing toasts
  pendingDeleteConfirm: ConversationMeta | null
  // confirm-restore modal target ("restore to before this request" — irreversible)
  pendingRestoreConfirm: { turnId: string } | null
  toasts: { id: string; text: string }[]
  // Set when a turn is discarded (stopped before any output) — the composer picks this up and puts the
  // un-sent text back in the input, then clears it.
  restoreDraft: string | null
  // actions
  setConnection: (c: Connection) => void
  setBackendStatus: (s: BackendStatus) => void
  toggleSidebar: () => void
  handleServerMessage: (msg: ServerMessage) => void
  foldEvent: (event: AgentEvent) => void
  reattachActive: () => void
  newChat: () => void
  openChat: (id: string) => void
  goHome: () => void
  sendMessage: (text: string) => void
  cancelSteer: (id: string) => void
  cancelRun: () => void
  requestDelete: (conv: ConversationMeta) => void
  confirmDelete: () => void
  cancelDelete: () => void
  deleteConversation: (id: string) => void
  renameConversation: (id: string, title: string) => void
  requestRestore: (turnId: string) => void
  confirmRestore: () => void
  cancelRestore: () => void
  addToast: (text: string) => void
  dismissToast: (id: string) => void
  clearRestoreDraft: () => void
  retry: () => void
  dismissError: () => void
}

/** Fresh per-conversation state (used by newChat/openChat). */
const blankConversation = (): Pick<
  ChatState,
  'items' | 'running' | 'cancelling' | 'liveToolIds' | 'progressWord' | 'compacting' | 'contextFull' | 'error' | 'lastUserText' | 'queuedSteers'
> => ({
  items: [],
  running: false,
  cancelling: false,
  liveToolIds: new Set(),
  progressWord: null,
  compacting: false,
  contextFull: null,
  error: null,
  lastUserText: null,
  queuedSteers: [],
})

export const useChatStore = create<ChatState>((set, get) => ({
  connection: 'connecting',
  aeConnected: false,
  backendStatus: { phase: 'starting', install: 'ok' },
  // Restore the active conversation + view so a reload lands back where the user was (see reattachActive).
  ...(() => { const n = loadNav(); return { view: n.view, sessionId: n.sessionId } })(),
  projectPath: '',
  conversations: [],
  listLoaded: false,
  sidebarCollapsed: false,
  ...blankConversation(),
  pendingDeletes: new Set(),
  pendingDeleteConfirm: null,
  pendingRestoreConfirm: null,
  toasts: [],
  restoreDraft: null,

  setConnection: (c) => set({ connection: c }),
  setBackendStatus: (s) => set({ backendStatus: s }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  handleServerMessage: (msg) => {
    const s = get()
    switch (msg.type) {
      case 'conversations':
        // A fresh list reconciles any optimistic deletes (backend sends no success ack). listLoaded
        // flips the initial loading screen off once the first list lands (no UI-before-data flash).
        set({ conversations: msg.conversations, projectPath: msg.projectPath, listLoaded: true, pendingDeletes: new Set() })
        break
      case 'history':
        // Guard against a stale reply painting a chat the user already navigated away from.
        if (msg.sessionId === get().sessionId) set({ items: msg.items, running: msg.running })
        break
      case 'agentEvent': {
        // Delete-refusal: an error for a conversation we optimistically removed → roll the row back +
        // surface a toast (not the turn-error notice, whose "Try again" wouldn't make sense here).
        if (msg.event.type === 'error' && s.pendingDeletes.has(msg.sessionId)) {
          const pd = new Set(s.pendingDeletes)
          pd.delete(msg.sessionId)
          set({ pendingDeletes: pd })
          get().addToast("Can't delete a chat while it's running — stop it first.")
          sendList() // reconcile: re-add the row
          break
        }
        if (msg.sessionId !== get().sessionId) break // background turn for another chat — ignore
        get().foldEvent(msg.event)
        break
      }
      case 'aeStatus':
        // Live AE connectivity → status dot. Always apply (not session-scoped): it's app-global state.
        set({ aeConnected: msg.connected })
        break
      case 'restored':
        if (msg.ok) {
          // Project + transcript were rewound one-way → reload the now-truncated history + refresh sidebar.
          if (msg.sessionId === get().sessionId) sendLoadHistory(msg.sessionId)
          sendList()
          get().addToast('Restored to before that request')
        } else {
          get().addToast(msg.message ?? "Couldn't restore the project.")
        }
        break
      case 'attached': {
        // Re-attach to a still-running turn after a reload. `history` (sent just before this on the same
        // socket) already painted the committed transcript; here we add the in-flight prompt bubble
        // (not yet in history) and replay the buffered live events so the view catches up + resumes.
        if (msg.sessionId !== get().sessionId) break
        if (msg.running && msg.userText) {
          set({ items: [...get().items, { kind: 'user', text: msg.userText }] })
        }
        set({ running: msg.running })
        for (const ev of msg.events) get().foldEvent(ev)
        break
      }
    }
  },

  foldEvent: (event) => {
    const s = get()
    // While stopping, the turn's incremental content is frozen — ignore anything still in flight for it
    // (the model abort means little arrives, but a tool_start/text could already be queued). tool_end is
    // allowed through so an in-flight tool row resolves; terminal events still clear state below.
    if (s.cancelling && (event.type === 'text' || event.type === 'tool_start' || event.type === 'steer' || event.type === 'snapshot')) {
      return
    }
    switch (event.type) {
      case 'turn_start':
        set({ running: true, cancelling: false, progressWord: pickWord(), error: null })
        break
      case 'text':
        set({ items: [...s.items, { kind: 'assistant', text: event.text }], progressWord: null })
        break
      case 'tool_start': {
        const liveToolIds = new Set(s.liveToolIds)
        liveToolIds.add(event.id)
        set({
          items: [...s.items, { kind: 'tool', id: event.id, label: event.label, status: 'running' }],
          liveToolIds,
          progressWord: null,
        })
        break
      }
      case 'tool_end': {
        const liveToolIds = new Set(s.liveToolIds)
        liveToolIds.delete(event.id)
        const items: DisplayItem[] = s.items.map((it) =>
          it.kind === 'tool' && it.id === event.id
            ? {
                ...it,
                status: event.ok ? (event.noop ? 'noop' : 'ok') : 'fail',
                // A noop sends the finalized, outcome-accurate label (e.g. "Nothing to undo").
                ...(event.label ? { label: event.label } : {}),
              }
            : it,
        )
        // Between tool_end and the next text/tool, the model is reasoning → show a fresh gerund.
        set({ items, liveToolIds, progressWord: liveToolIds.size === 0 ? pickWord() : s.progressWord })
        break
      }
      case 'steer':
        // A queued steer fired → drop its chip and render it as the user's message.
        set({
          queuedSteers: s.queuedSteers.filter((q) => q.id !== event.id),
          items: [...s.items, { kind: 'user', text: event.text }],
        })
        break
      case 'compaction':
        set({ compacting: event.status === 'start' })
        break
      case 'context_full':
        set({ contextFull: { message: event.message }, running: false, cancelling: false, progressWord: null })
        break
      case 'error':
        set({ error: { friendly: mapError(event.message), raw: event.message }, running: false, cancelling: false, progressWord: null })
        track('turn_error')
        break
      case 'cancelled':
        if (event.discarded) {
          // Stopped before any output → throw the turn away: pull the optimistic user prompt back out
          // of the transcript and return its text to the composer (as if never sent). No divider, and
          // nothing was persisted so the sidebar doesn't need a refresh.
          set({
            items: s.items[s.items.length - 1]?.kind === 'user' ? s.items.slice(0, -1) : s.items,
            restoreDraft: s.lastUserText,
            running: false,
            cancelling: false,
            progressWord: null,
          })
          break
        }
        // The authoritative stop: drop the muted "Stopped" divider into the transcript (mirrors the
        // persisted marker, so live + reload match) and refresh the sidebar (the turn was committed).
        set({ items: [...s.items, { kind: 'interrupted' }], running: false, cancelling: false, progressWord: null })
        sendList()
        break
      case 'done':
        set({ running: false, cancelling: false, progressWord: null })
        track('turn_done')
        sendList() // refresh the sidebar (new row / updated title + lastActivity)
        break
      case 'snapshot': {
        // Tag the most-recent prompt with its backup turnId so "restore to before this request" works
        // immediately (the live path; reload reads the persisted turnId off history instead).
        if (!event.ok || !event.turnId) break
        const items = [...s.items]
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i]
          if (it.kind === 'user') { items[i] = { kind: 'user', text: it.text, turnId: event.turnId }; break }
        }
        set({ items })
        break
      }
    }
  },

  reattachActive: () => {
    // On (re)connect, if a conversation was open, reload its committed history then attach to any
    // in-flight turn. Same socket → backend replies history-then-attached in order, so the committed
    // transcript paints first and the live turn replays on top (no gap, no dup).
    const { sessionId, view } = get()
    if (view === 'chat' && sessionId) {
      sendLoadHistory(sessionId)
      sendAttach(sessionId)
    }
  },

  newChat: () => {
    const sessionId = crypto.randomUUID()
    set({ sessionId, view: 'chat', ...blankConversation() })
    saveNav(sessionId, 'chat')
    track('new_chat')
  },

  openChat: (id) => {
    set({ sessionId: id, view: 'chat', ...blankConversation() })
    saveNav(id, 'chat')
    sendLoadHistory(id)
  },

  goHome: () => {
    set({ view: 'home' })
    saveNav(get().sessionId, 'home')
    sendList()
  },

  sendMessage: (text) => {
    const s = get()
    if (!s.sessionId || !text.trim()) return
    if (s.running) {
      // Mid-turn → queue as a steer; show a removable chip immediately (fires at the next boundary).
      const id = crypto.randomUUID()
      set({ queuedSteers: [...s.queuedSteers, { id, text }] })
      sendQueue(s.sessionId, text, id)
      return
    }
    set({ items: [...s.items, { kind: 'user', text }], lastUserText: text, error: null })
    track('message_sent')
    sendUserChat(s.sessionId, text)
  },

  cancelSteer: (id) => {
    const s = get()
    set({ queuedSteers: s.queuedSteers.filter((q) => q.id !== id) })
    if (s.sessionId) sendRemoveQueue(s.sessionId, id)
  },

  cancelRun: () => {
    // Stop/Esc → instant stop (Claude Code-style): drop the spinner immediately and raise the
    // `cancelling` gate so any events already in flight for this turn stop rendering. The backend
    // aborts the model request and emits `cancelled`, which lands the "Stopped" marker + clears state.
    const s = get()
    if (!s.running || s.cancelling || !s.sessionId) return
    set({ running: false, cancelling: true, progressWord: null })
    sendCancel(s.sessionId)
  },

  requestDelete: (conv) => set({ pendingDeleteConfirm: conv }),
  cancelDelete: () => set({ pendingDeleteConfirm: null }),

  requestRestore: (turnId) => set({ pendingRestoreConfirm: { turnId } }),
  cancelRestore: () => set({ pendingRestoreConfirm: null }),
  confirmRestore: () => {
    const { pendingRestoreConfirm, sessionId } = get()
    if (!pendingRestoreConfirm || !sessionId) return
    set({ pendingRestoreConfirm: null })
    // The backend reverts the .aep + truncates history, then replies `restored` → we reload history.
    sendRestore(sessionId, pendingRestoreConfirm.turnId)
  },
  confirmDelete: () => {
    const conv = get().pendingDeleteConfirm
    if (!conv) return
    set({ pendingDeleteConfirm: null })
    get().deleteConversation(conv.id)
    get().addToast('Conversation deleted')
  },

  deleteConversation: (id) => {
    const s = get()
    const pendingDeletes = new Set(s.pendingDeletes)
    pendingDeletes.add(id)
    set({ conversations: s.conversations.filter((c) => c.id !== id), pendingDeletes })
    track('conversation_deleted')
    sendDelete(id)
    if (s.sessionId === id) get().newChat() // deleting the open chat → drop into a fresh New chat
  },

  renameConversation: (id, title) => {
    // Trim + collapse whitespace to mirror the backend's title rules; an empty result is a cancel (the
    // row keeps its current title). Optimistically repaint the row + mark it renamed, then persist —
    // no ack needed (mirrors delete; the next `list` confirms). The input caps length at 60.
    const clean = title.trim().replace(/\s+/g, ' ')
    if (!clean) return
    set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? { ...c, title: clean, renamed: true } : c)) }))
    track('conversation_renamed')
    sendRename(id, clean)
  },

  addToast: (text) => set((s) => ({ toasts: [...s.toasts, { id: crypto.randomUUID(), text }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clearRestoreDraft: () => set({ restoreDraft: null }),

  retry: () => {
    const s = get()
    if (!s.lastUserText || !s.sessionId) return
    set({ error: null })
    track('message_sent')
    sendUserChat(s.sessionId, s.lastUserText) // resend without duplicating the user bubble
  },

  dismissError: () => set({ error: null }),
}))
