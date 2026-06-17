import { create } from 'zustand'
import type { AgentEvent, ConversationMeta, DisplayItem, ServerMessage } from './protocol'
import {
  type Connection,
  sendCancel,
  sendDelete,
  sendList,
  sendLoadHistory,
  sendQueue,
  sendRemoveQueue,
  sendUserChat,
} from './ws'
import { track } from './analytics'

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
  toasts: { id: string; text: string }[]
  // actions
  setConnection: (c: Connection) => void
  toggleSidebar: () => void
  handleServerMessage: (msg: ServerMessage) => void
  foldEvent: (event: AgentEvent) => void
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
  addToast: (text: string) => void
  dismissToast: (id: string) => void
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
  view: 'home',
  projectPath: '',
  conversations: [],
  listLoaded: false,
  sidebarCollapsed: false,
  sessionId: null,
  ...blankConversation(),
  pendingDeletes: new Set(),
  pendingDeleteConfirm: null,
  toasts: [],

  setConnection: (c) => set({ connection: c }),
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
      case 'attached':
        // Re-attach renderer half is worktree ⑥ — ignored here.
        break
    }
  },

  foldEvent: (event) => {
    const s = get()
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
        set({ running: false, cancelling: false, progressWord: null })
        break
      case 'done':
        set({ running: false, cancelling: false, progressWord: null })
        track('turn_done')
        sendList() // refresh the sidebar (new row / updated title + lastActivity)
        break
      case 'snapshot':
        break // pre-turn backup — not rendered
    }
  },

  newChat: () => {
    set({ sessionId: crypto.randomUUID(), view: 'chat', ...blankConversation() })
    track('new_chat')
  },

  openChat: (id) => {
    set({ sessionId: id, view: 'chat', ...blankConversation() })
    sendLoadHistory(id)
  },

  goHome: () => {
    set({ view: 'home' })
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
    // Stop/Esc → abort the in-flight turn. Flip `cancelling` immediately for instant feedback; the
    // backend aborts the model request and emits `cancelled`, which clears running + cancelling.
    const s = get()
    if (!s.running || s.cancelling || !s.sessionId) return
    set({ cancelling: true })
    sendCancel(s.sessionId)
  },

  requestDelete: (conv) => set({ pendingDeleteConfirm: conv }),
  cancelDelete: () => set({ pendingDeleteConfirm: null }),
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

  addToast: (text) => set((s) => ({ toasts: [...s.toasts, { id: crypto.randomUUID(), text }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  retry: () => {
    const s = get()
    if (!s.lastUserText || !s.sessionId) return
    set({ error: null })
    track('message_sent')
    sendUserChat(s.sessionId, s.lastUserText) // resend without duplicating the user bubble
  },

  dismissError: () => set({ error: null }),
}))
