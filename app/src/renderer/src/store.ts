import { create } from 'zustand'
import type { AuthState, BackendStatus, BillingState, CubicEnvName } from '@shared/ipc'
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

// ── Recover a conversation's view from the backend ──
// Load its committed history, then attach to any in-flight turn. Same socket → the backend replies
// history-then-attached in order, so the committed transcript paints first and the live turn (spinner +
// in-flight prompt + buffered events) replays on top — no gap, no dup. Shared by both entry points into a
// chat: reload (reattachActive) and switching chats (openChat). For a non-running chat the `attached`
// reply is `running:false` with an empty buffer, so it's a harmless no-op.
function loadAndAttach(sessionId: string): void {
  sendLoadHistory(sessionId)
  sendAttach(sessionId)
}

// ── Friendly transient-error mapping (raw SDK/transport text → plain English) ──
// `status` = the proxy gate's HTTP status; `reason` = the 402 sub-state ('no_plan' | 'past_due' |
// 'over_cap'). The specific, actionable cases come first (WT-PROXY-GATING §C-6). Wave-3 §D replaces these
// interim messages with real paywall/sign-in screens (routing off the same `reason`).
function mapError(raw: string, status?: number, reason?: string): string {
  if (status === 401) return 'Please sign in again to keep using Cubic.'
  if (status === 402) {
    if (reason === 'no_plan') return 'You need an active plan to use Cubic. Subscribe to get started.'
    if (reason === 'past_due') return "Your last payment didn't go through — update your card to keep using Cubic."
    if (reason === 'over_cap') return "You've used up this month's allowance. Upgrade for more."
    return "You've reached your plan's limit. Upgrade to keep going." // fallback (reason absent)
  }
  // 503 = a gate/server fault on OUR end (entitlement lookup down, or a price-misconfig we caught) — a
  // transient "our problem" message, never an upsell. Retryable (see the `error` case below).
  if (status === 503) return "Cubic is having a temporary issue on our end — we're on it. Try again in a moment."
  // 502 = the proxy couldn't get a good response from the AI service (unreachable, or the upstream API
  // returned an error the proxy remapped) — transient, our problem, retryable. Never a "sign in again".
  if (status === 502) return "Cubic couldn't reach the AI service just now — try again in a moment."
  if (status === 429 || /overloaded|rate.?limit|\b429\b|\b529\b/i.test(raw)) return 'Cubic is busy right now — try again in a moment.'
  if (/network|fetch failed|ECONN|ENOTFOUND|socket hang/i.test(raw)) return "Couldn't reach the server — check your connection and try again."
  if (/AE.?disconnect|plugin not connected|not connected/i.test(raw)) return "After Effects isn't connected. Open AE with the Cubic bridge running."
  if (/timed? ?out|timeout/i.test(raw)) return 'That step took too long. Want to try again?'
  return 'Something went wrong on that step. Want to try again?'
}

// ── Motion-themed progress words, cycled during reasoning gaps (§C "spinner + progress words") ──
const PROGRESS_WORDS = [
  'Animating…', 'Doing…', 'Easing it in…', 'Motioning…', 'Tweening…',
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
  // §B auth state (status + user), pushed by main over IPC. Distinct from billing/entitlement — there
  // is no plan here (that lands with WT-BILLING). The renderer is presentational; main owns the session.
  auth: AuthState
  // §D billing/entitlement DISPLAY state (plan + usage + status), pushed by main over IPC. Drives the
  // account pill, the Settings usage bar, and the paywall/limit states. The enforcement GATE is the
  // proxy (a 402 on a blocked send) — this is the display side. Main owns every Supabase/Stripe call.
  billing: BillingState
  // Which deployment we run as — gates sign-in (prod blocks until signed in; local never blocks).
  cubicEnv: CubicEnvName
  view: 'home' | 'chat'
  projectPath: string
  // sidebar/home list
  conversations: ConversationMeta[]
  listLoaded: boolean
  sidebarCollapsed: boolean
  // Narrow-window overlay drawer (the inline sidebar's replacement below the responsive breakpoint).
  // Transient (starts closed, not persisted); any navigation closes it (see newChat/openChat/goHome).
  mobileDrawerOpen: boolean
  // ── Project-switch (Cubic mirrors AE) ──
  // `projectPath` is the project currently DISPLAYED; `liveProjectPath` is the project actually open in AE.
  // Every `conversations` message reflects live AE, so after each adopt the two are equal — Cubic always
  // shows the open project. A real in-AE switch auto-follows the now-open project and raises a toast (each
  // .aep is its own conversation bucket; switching projects just switches buckets). A switch detected while a
  // turn is running is deferred (we don't update `liveProjectPath` until the turn ends, then auto-follow).
  liveProjectPath: string | null
  // Brand-new chats that have sent a first message but whose turn hasn't committed to disk yet. The
  // renderer owns these rows (it knows it just sent a message — no AE project lookup needed), so they
  // persist across chat switches like Claude.ai. An entry is dropped once the backend list contains its
  // id (committed → real row), or the turn is stopped before any output, or the chat is deleted.
  // In-memory only (a reload self-heals: the active chat re-attaches, a backgrounded one reappears on
  // commit).
  pendingNewChats: { id: string; title: string }[]
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
  // `retryable` = false for 401/402 (signing in / subscribing is the fix, not resending) → ErrorNotice
  // hides "Try again". Everything else (busy/network/timeout/upstream) stays retryable.
  error: { friendly: string; raw: string; retryable: boolean } | null
  lastUserText: string | null
  queuedSteers: { id: string; text: string }[]
  // delete-refusal tracking (rollback an optimistic removal if the backend refuses mid-turn)
  pendingDeletes: Set<string>
  // §D billing UI overlays (root-mounted, store-driven like the confirm modals): the account Settings
  // modal + the plan-picker (Checkout) modal opened from the account menu / Settings / paywalls.
  settingsOpen: boolean
  pickerOpen: boolean
  // P2 destructive account-deletion confirm modal (type-to-confirm), opened from Settings→Account.
  deleteAccountOpen: boolean
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
  setAuth: (s: AuthState) => void
  setBilling: (s: BillingState) => void
  setCubicEnv: (e: CubicEnvName) => void
  toggleSidebar: () => void
  setMobileDrawerOpen: (open: boolean) => void
  toggleMobileDrawer: () => void
  setSettingsOpen: (open: boolean) => void
  setPickerOpen: (open: boolean) => void
  setDeleteAccountOpen: (open: boolean) => void
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
  auth: { status: 'loading', user: null },
  billing: { status: 'loading', entitlement: null, activating: false },
  cubicEnv: 'local',
  // Restore the active conversation + view so a reload lands back where the user was (see reattachActive).
  ...(() => { const n = loadNav(); return { view: n.view, sessionId: n.sessionId } })(),
  projectPath: '',
  conversations: [],
  listLoaded: false,
  sidebarCollapsed: false,
  mobileDrawerOpen: false,
  liveProjectPath: null,
  pendingNewChats: [],
  ...blankConversation(),
  settingsOpen: false,
  pickerOpen: false,
  deleteAccountOpen: false,
  pendingDeletes: new Set(),
  pendingDeleteConfirm: null,
  pendingRestoreConfirm: null,
  toasts: [],
  restoreDraft: null,

  setConnection: (c) => set({ connection: c }),
  setBackendStatus: (s) => set({ backendStatus: s }),
  setAuth: (s) => set({ auth: s }),
  setBilling: (s) => set({ billing: s }),
  setCubicEnv: (e) => set({ cubicEnv: e }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setMobileDrawerOpen: (open) => set({ mobileDrawerOpen: open }),
  toggleMobileDrawer: () => set((s) => ({ mobileDrawerOpen: !s.mobileDrawerOpen })),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setPickerOpen: (open) => set({ pickerOpen: open }),
  setDeleteAccountOpen: (open) => set({ deleteAccountOpen: open }),

  handleServerMessage: (msg) => {
    const s = get()
    switch (msg.type) {
      case 'conversations': {
        // Every `conversations` message reflects the project AE actually has open → mirror it as the live
        // path (the basis for switch detection). After any adopt, projectPath === liveProjectPath: Cubic
        // always shows the open project.
        const live = msg.projectPath
        const liveChanged = s.listLoaded && live !== s.liveProjectPath
        // Adopt the live project's list into the displayed view: reconcile optimistic deletes (no success
        // ack), flip the initial loading screen off, drop any now-persisted pending new-chat row.
        const adopt = (): void => {
          const committed = new Set(msg.conversations.map((c) => c.id))
          set({
            conversations: msg.conversations,
            projectPath: live,
            liveProjectPath: live,
            listLoaded: true,
            pendingDeletes: new Set(),
            pendingNewChats: s.pendingNewChats.filter((p) => !committed.has(p.id)),
          })
        }

        // First list of the session — establish the baseline; never a "switch" (guards the restore-into-
        // chat path, where projectPath is still '').
        if (!s.listLoaded) { adopt(); break }

        // A switch detected WHILE A TURN IS RUNNING → defer silently. Don't yank the user out of the live
        // turn or swap the sidebar; and crucially DON'T update `liveProjectPath`, so the list that arrives
        // after the turn ends still reads as a switch and auto-follows then (with its toast).
        if (liveChanged && s.running) break

        // Untitled project just got SAVED ('' → '/path'): same project gaining a name, not a switch. Adopt
        // the new path but keep the current chat in place (its first/next turn rekeys it on the backend).
        if (liveChanged && s.liveProjectPath === '') { adopt(); break }

        // A real in-AE project switch (File>Open / Increment-and-Save / recovery). Auto-follow the now-open
        // project PRESERVING the view (on a chat, a fresh chat for it; on Home, just its list) and surface a
        // toast so the change isn't silent. Each .aep is its own conversation bucket.
        if (liveChanged) {
          adopt()
          get().addToast(`After Effects switched to ${live.split('/').pop() || 'an untitled project'}`)
          if (s.view === 'chat' && s.sessionId) get().newChat()
          break
        }

        // Same live project, normal refresh (a `done`/`cancelled`/delete/rename push, or AE returning to the
        // project we're on) → just adopt the fresh list.
        adopt()
        break
      }
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
      case 'compaction': {
        // A successful compaction with a real recap leaves a collapsible "View summary" divider. Start
        // shows the pill; done/failed clears it. A no-op/clear 'done' has no `summary`, so nothing is
        // added (matches the silent failure/no-op behavior).
        if (event.status !== 'done' || !event.summary) {
          set({ compacting: event.status === 'start' })
          break
        }
        // Place the divider at the COMPACTION MOMENT — right before the prompt that triggered it (the most
        // recent user item, optimistically added on send). This matches the persisted marker's position on
        // reload, so live and reopened views agree.
        const items = [...s.items]
        let idx = items.length
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].kind === 'user') { idx = i; break }
        }
        items.splice(idx, 0, { kind: 'compaction', summary: event.summary })
        set({ compacting: false, items })
        break
      }
      case 'context_full':
        set({ contextFull: { message: event.message }, running: false, cancelling: false, progressWord: null })
        break
      case 'error': {
        // A 401 DURING a turn is usually just a mid-turn token expiry (#4B), not a real sign-out. Ask
        // main for a token: a refresh that still yields one means the session is valid → this was
        // recoverable, so make it retryable ("try again" resumes with the fresh token, completed steps
        // already saved). Only a definitive sign-out (refresh returns nothing) keeps "please sign in
        // again". Other statuses: 402 (subscribe/upgrade) isn't fixable by resending; everything else is.
        if (event.status === 401) {
          set({ running: false, cancelling: false, progressWord: null })
          void window.cubic.getAccessToken().catch(() => null).then((token) => {
            const recovered = !!token
            set({
              error: {
                friendly: recovered ? 'That got interrupted — try again.' : mapError(event.message, 401, event.reason),
                raw: event.message,
                retryable: recovered,
              },
            })
          })
          track('turn_error')
          break
        }
        // 402 backstop: the proxy just authoritatively rejected the send (blocked/over-cap/past-due). The
        // paywall (banner/takeover, driven by entitlement) is the real surface, so refetch entitlement to
        // flip it — and SUPPRESS the transient error notice (it would double up with the banner). This is
        // the reconciling half of "proactive state + 402 backstop"; the fresh state arrives via onBillingChanged.
        if (event.status === 402) {
          void window.cubic.refreshBilling()
          set({ running: false, cancelling: false, progressWord: null })
          track('turn_error')
          break
        }
        set({ error: { friendly: mapError(event.message, event.status, event.reason), raw: event.message, retryable: true }, running: false, cancelling: false, progressWord: null })
        track('turn_error')
        break
      }
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
            // Stopped before any output on a brand-new chat → the message is un-sent, so drop its
            // client-owned sidebar row (nothing ran or persisted).
            pendingNewChats: s.pendingNewChats.filter((p) => p.id !== s.sessionId),
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
    if (view === 'chat' && sessionId) loadAndAttach(sessionId)
  },

  newChat: () => {
    const sessionId = crypto.randomUUID()
    set({ sessionId, view: 'chat', mobileDrawerOpen: false, ...blankConversation() })
    saveNav(sessionId, 'chat')
    track('new_chat')
  },

  openChat: (id) => {
    // Switching INTO a chat is the same recovery the reload path uses: paint committed history, then
    // re-attach to any still-running turn (restores the spinner + in-flight prompt + buffered live
    // events). Without the attach, switching back to a chat that's still working would lose its spinner
    // and in-flight message until a Home round-trip — the bug this fixes.
    set({ sessionId: id, view: 'chat', mobileDrawerOpen: false, ...blankConversation() })
    saveNav(id, 'chat')
    loadAndAttach(id)
  },

  goHome: () => {
    set({ view: 'home', mobileDrawerOpen: false })
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
    // First message of a brand-new chat (not yet persisted, not already pending) → own its sidebar row
    // client-side so it persists across switches until the turn commits (Claude.ai behavior).
    const isNewChat = !s.conversations.some((c) => c.id === s.sessionId) && !s.pendingNewChats.some((p) => p.id === s.sessionId)
    set({
      items: [...s.items, { kind: 'user', text }],
      lastUserText: text,
      error: null,
      ...(isNewChat ? { pendingNewChats: [...s.pendingNewChats, { id: s.sessionId, title: text }] } : {}),
    })
    track('message_sent')
    void sendUserChat(s.sessionId, text)
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
    set({
      conversations: s.conversations.filter((c) => c.id !== id),
      pendingDeletes,
      pendingNewChats: s.pendingNewChats.filter((p) => p.id !== id),
    })
    track('conversation_deleted')
    sendDelete(id)
    // Post-delete navigation only matters when the deleted chat is the one the pointer is on:
    //  - inside a chat → drop into a fresh New chat (can't stay on a now-gone transcript)
    //  - on Home → stay on Home; just reset the (now-dangling) session pointer to a fresh blank session
    //    so a later reload/reattach doesn't target the deleted conversation.
    // Deleting any other row leaves you exactly where you are.
    if (s.sessionId === id) {
      if (s.view === 'chat') {
        get().newChat()
      } else {
        const sessionId = crypto.randomUUID()
        set({ sessionId, ...blankConversation() })
        saveNav(sessionId, 'home')
      }
    }
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
    void sendUserChat(s.sessionId, s.lastUserText) // resend without duplicating the user bubble
  },

  dismissError: () => set({ error: null }),
}))
