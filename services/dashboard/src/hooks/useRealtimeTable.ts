import { useEffect, useRef, useState, useCallback } from 'react'

export interface RealtimeEvent {
  type: 'event'
  op: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: Record<string, unknown>
}

function getWsUrl(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
  return apiUrl.replace(/^http/, 'ws') + '/api/realtime'
}

export function useRealtimeTable(
  projectId: string,
  table: string,
  onEvent: (event: RealtimeEvent) => void
): { connected: boolean } {
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  const handleMessage = useCallback((e: MessageEvent) => {
    try {
      const msg = JSON.parse(e.data as string) as Record<string, unknown>
      if (msg.type === 'event') {
        onEventRef.current(msg as unknown as RealtimeEvent)
      }
    } catch {
      // ignore malformed messages
    }
  }, [])

  useEffect(() => {
    if (!projectId || !table) return

    const ws = new WebSocket(getWsUrl())
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', projectId, table }))
      setConnected(true)
    }

    ws.onmessage = handleMessage
    ws.onclose = () => setConnected(false)
    ws.onerror = () => setConnected(false)

    return () => {
      ws.close()
      wsRef.current = null
      setConnected(false)
    }
  }, [projectId, table, handleMessage])

  return { connected }
}
