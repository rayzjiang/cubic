import { useEffect, useState } from 'react'

export type BackendStatus = 'connecting' | 'open' | 'disconnected'

/**
 * Thin connection proof (§0): ask main for the port, open a WebSocket to the local backend,
 * report status. Uses the browser `WebSocket` global — no `ws` import, renderer stays
 * sandboxed. NO agentEvent handling / userChat sending — the chat protocol is a later
 * worktree (§C); this only proves the spawn → port → IPC → WS chain end-to-end.
 *
 * One short retry covers the race where the renderer is ready a beat before the spawned
 * backend has bound its port. Real reconnect/connection-state UX is worktree ⑦.
 */
export function useBackendStatus(): BackendStatus {
  const [status, setStatus] = useState<BackendStatus>('connecting')

  useEffect(() => {
    let cancelled = false
    let ws: WebSocket | null = null
    let retried = false

    const connect = async () => {
      const port = await window.cubic.getBackendPort()
      if (cancelled) return
      ws = new WebSocket(`ws://127.0.0.1:${port}`)

      ws.onopen = () => {
        if (!cancelled) setStatus('open')
      }
      ws.onclose = () => {
        if (cancelled) return
        if (!retried) {
          // Backend may not have bound the port yet on first paint — try once more.
          retried = true
          setStatus('connecting')
          setTimeout(() => {
            if (!cancelled) connect()
          }, 500)
        } else {
          setStatus('disconnected')
        }
      }
      // onerror is followed by onclose; let onclose drive the retry/disconnect transition.
    }

    connect()

    return () => {
      cancelled = true
      ws?.close()
    }
  }, [])

  return status
}
