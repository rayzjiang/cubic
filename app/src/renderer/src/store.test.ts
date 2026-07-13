import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from './store'
import type { AgentEvent, ConversationMeta, DisplayItem } from './protocol'

// A failed/uncommitted turn (generic error, 401, 402, context_full, discarded stop) must be treated
// as never-sent: pull the optimistic user bubble out of the transcript, return its text to the
// composer (restoreDraft), and drop the client-owned pending sidebar row — so it never strands an
// undeletable "ghost" chat. These cases exercise foldEvent's discardUncommittedTurn path.
const meta = (id: string): ConversationMeta => ({ id, title: id, projectPath: '', lastActivity: 0, renamed: false })
const userItem = (text: string): DisplayItem => ({ kind: 'user', text })
const errorEvent: AgentEvent = { type: 'error', message: 'Upstream 502', status: 502 }

describe('foldEvent → discard uncommitted turn', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [],
      pendingNewChats: [],
      sessionId: null,
      running: false,
      items: [],
      lastUserText: null,
      restoreDraft: null,
      error: null,
      contextFull: null,
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('generic error: drops the row, pops the bubble, returns text to the composer (no retryable)', () => {
    useChatStore.setState({
      sessionId: 'new-a',
      running: true,
      items: [userItem('make the logo spin')],
      lastUserText: 'make the logo spin',
      pendingNewChats: [{ id: 'new-a', title: 'make the logo spin' }, { id: 'other-b', title: 'other draft' }],
    })

    useChatStore.getState().foldEvent(errorEvent)

    const s = useChatStore.getState()
    expect(s.pendingNewChats).toEqual([{ id: 'other-b', title: 'other draft' }]) // errored row gone, sibling kept
    expect(s.items).toEqual([]) // optimistic bubble popped
    expect(s.restoreDraft).toBe('make the logo spin') // text back in the composer
    expect(s.running).toBe(false)
    expect(s.error).toMatchObject({ friendly: expect.any(String), raw: 'Upstream 502' })
    expect(s.error).not.toHaveProperty('retryable') // the flag + the "Try again" button are gone
  })

  it('leaves pendingNewChats untouched when the errored chat is already committed', () => {
    // A later turn errors on a chat that already committed (in `conversations`, not pending) → the row
    // filter is a harmless no-op; an unrelated pending row must survive.
    useChatStore.setState({
      sessionId: 'committed-a',
      running: true,
      conversations: [meta('committed-a')],
      pendingNewChats: [{ id: 'unrelated-b', title: 'unrelated draft' }],
    })

    useChatStore.getState().foldEvent(errorEvent)

    expect(useChatStore.getState().pendingNewChats).toEqual([{ id: 'unrelated-b', title: 'unrelated draft' }])
  })

  it('context_full: discards the turn and surfaces the card', () => {
    useChatStore.setState({
      sessionId: 'new-c',
      running: true,
      items: [userItem('a huge paste')],
      lastUserText: 'a huge paste',
      pendingNewChats: [{ id: 'new-c', title: 'a huge paste' }],
    })

    useChatStore.getState().foldEvent({ type: 'context_full', message: 'This chat is full.' })

    const s = useChatStore.getState()
    expect(s.pendingNewChats).toEqual([])
    expect(s.items).toEqual([])
    expect(s.restoreDraft).toBe('a huge paste')
    expect(s.contextFull).toEqual({ message: 'This chat is full.' })
    expect(s.running).toBe(false)
  })

  it('402 paywall: discards the turn, suppresses the error notice', () => {
    // The 402 branch calls window.cubic.refreshBilling(); stub it so the reducer runs in node.
    const refreshBilling = vi.fn(() => Promise.resolve())
    vi.stubGlobal('window', { cubic: { refreshBilling } })
    useChatStore.setState({
      sessionId: 'new-d',
      running: true,
      items: [userItem('spin it')],
      lastUserText: 'spin it',
      pendingNewChats: [{ id: 'new-d', title: 'spin it' }],
    })

    useChatStore.getState().foldEvent({ type: 'error', message: 'over cap', status: 402, reason: 'over_cap' })

    const s = useChatStore.getState()
    expect(refreshBilling).toHaveBeenCalledOnce()
    expect(s.pendingNewChats).toEqual([])
    expect(s.items).toEqual([])
    expect(s.restoreDraft).toBe('spin it') // waiting in the composer for after they subscribe
    expect(s.error).toBeNull() // paywall owns the surface — no transient notice
    expect(s.running).toBe(false)
  })
})
