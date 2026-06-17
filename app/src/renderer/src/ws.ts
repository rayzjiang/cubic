/**
 * Backend WebSocket transport (single socket). The renderer learns the port from main via the
 * `getBackendPort()` IPC, then opens a browser `WebSocket` directly to the backend (renderer stays
 * sandboxed — no `ws`/`fs`). Inbound server messages are handed to a bound dispatch fn; outbound
 * messages go through the typed send helpers. Full reconnect/connection-state UX is worktree ⑦;
 * here we keep the one-shot startup retry from the original useBackendStatus proof.
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

export function connectBackend(): void {
  let retried = false
  const open = async (): Promise<void> => {
    const port = await window.cubic.getBackendPort()
    socket = new WebSocket(`ws://127.0.0.1:${port}`)
    socket.onopen = () => onStatus('open')
    socket.onmessage = (e) => {
      try {
        dispatch(JSON.parse(e.data as string) as ServerMessage)
      } catch {
        /* ignore non-JSON frames */
      }
    }
    socket.onclose = () => {
      socket = null
      if (!retried) {
        // Backend may not have bound the port yet on first paint — try once more.
        retried = true
        onStatus('connecting')
        setTimeout(() => void open(), 500)
      } else {
        onStatus('disconnected')
      }
    }
    // onerror is followed by onclose; let onclose drive the retry/disconnect transition.
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
export const sendCancel = (sessionId: string): void => wsSend({ type: 'cancel', sessionId })
export const sendAttach = (sessionId: string): void => wsSend({ type: 'attach', sessionId })
export const sendRestore = (sessionId: string, turnId: string): void => wsSend({ type: 'restore', sessionId, turnId })
