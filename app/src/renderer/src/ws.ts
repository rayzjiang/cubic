/**
 * Backend WebSocket transport (single socket). The renderer learns the backend's {port, token} from
 * main via the `getBackendPort()` IPC, opens a browser `WebSocket` directly to the backend (renderer
 * stays sandboxed — no `ws`/`fs`), and authenticates by sending a `hello` carrying the per-launch token
 * as its FIRST frame (the backend drops any socket whose first frame lacks it). Inbound server messages
 * are handed to a bound dispatch fn; outbound
 * messages go through the typed send helpers. The socket reconnects indefinitely with a bounded
 * backoff so a backend restart (the supervisor in main bounded-restarts the child — §B6) self-heals:
 * the renderer keeps showing "connecting" and rejoins automatically, and App.tsx's `connection`
 * effect re-fires `sendList()` + `reattachActive()` on each successful reconnect.
 */
import type { ClientMessage, ServerMessage } from './protocol'

export type Connection = 'connecting' | 'open' | 'disconnected'

let socket: WebSocket | null = null
let dispatch: (msg: ServerMessage) => void = () => {}
let onStatus: (s: Connection) => void = () => {}

/** Wire the transport to the store (dispatch server messages + report connection status). */
export function bindWs(d: (msg: ServerMessage) => void, s: (status: Connection) => void): void {
  dispatch = d
  onStatus = s
}

// Reconnect backoff: quick at first (backend may just be (re)binding the port), capped so we keep
// retrying forever at a steady cadence without hammering.
const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 3000]

export function connectBackend(): void {
  let attempt = 0
  // Keep retrying indefinitely so a backend restart (§B6) reconnects on its own; the dot stays
  // "connecting" throughout (the actionable cause — reconnecting/port-in-use — comes from main).
  const retry = (): void => {
    onStatus('connecting')
    const delay = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)]
    attempt++
    setTimeout(() => void open(), delay)
  }
  const open = async (): Promise<void> => {
    let conn: { port: number; token: string }
    try {
      conn = await window.cubic.getBackendPort()
    } catch {
      // Backend hasn't reported ready yet (whenReady timed out during a crash/restart) — back off + re-ask.
      retry()
      return
    }
    socket = new WebSocket(`ws://127.0.0.1:${conn.port}`)
    socket.onopen = () => {
      // Authenticate FIRST — before App.tsx's `list`/reattach — or the backend drops this socket.
      socket!.send(JSON.stringify({ type: 'hello', token: conn.token, role: 'ui' }))
      attempt = 0 // healthy connection → reset backoff
      onStatus('open')
    }
    socket.onmessage = (e) => {
      try {
        dispatch(JSON.parse(e.data as string) as ServerMessage)
      } catch {
        /* ignore non-JSON frames */
      }
    }
    socket.onclose = () => {
      socket = null
      retry()
    }
    // onerror is followed by onclose; let onclose drive the reconnect.
  }
  onStatus('connecting')
  void open()
}

function wsSend(msg: ClientMessage): void {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
}

export const sendList = (): void => wsSend({ type: 'list' })
export const sendLoadHistory = (sessionId: string): void => wsSend({ type: 'loadHistory', sessionId })
export const sendUserChat = (sessionId: string, text: string): void => wsSend({ type: 'userChat', sessionId, text })
export const sendQueue = (sessionId: string, text: string, id: string): void => wsSend({ type: 'queue', sessionId, text, id })
export const sendRemoveQueue = (sessionId: string, id: string): void => wsSend({ type: 'removeQueue', sessionId, id })
export const sendDelete = (sessionId: string): void => wsSend({ type: 'delete', sessionId })
export const sendRename = (sessionId: string, title: string): void => wsSend({ type: 'rename', sessionId, title })
export const sendCancel = (sessionId: string): void => wsSend({ type: 'cancel', sessionId })
export const sendAttach = (sessionId: string): void => wsSend({ type: 'attach', sessionId })
export const sendRestore = (sessionId: string, turnId: string): void => wsSend({ type: 'restore', sessionId, turnId })
