import { IncomingMessage, Server } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { verifyAccessToken } from '../auth/jwt'
import { verifyApiKey } from '../auth/apiKey'
import { env } from '../config/env'
import { clients, subscribe, unregister, type RealtimeClient } from './broadcaster'

function extractToken(req: IncomingMessage): string | null {
  // Bearer token from Authorization header
  const auth = req.headers['authorization']
  if (auth?.startsWith('Bearer ')) return auth.slice(7)

  // JWT from cookie
  const cookieHeader = req.headers['cookie'] ?? ''
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === 'ib_access_token') return rest.join('=')
  }
  return null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TABLE_RE = /^[a-z][a-z0-9_]*$/

export function attachWebSocketServer(httpServer: Server): void {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/api/realtime',
    verifyClient: ({ origin }: { origin: string }) => {
      // Allow same origin, configured dashboard URL, or no origin (API key clients)
      if (!origin) return true
      return origin === env.DASHBOARD_URL
    },
  })

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    const token = extractToken(req)

    if (!token) {
      ws.close(4401, 'Unauthorized')
      return
    }

    // Try JWT first, then API key
    let authed = false
    try {
      verifyAccessToken(token)
      authed = true
    } catch {
      const apiKeyUser = await verifyApiKey(token)
      if (apiKeyUser) authed = true
    }

    if (!authed) {
      ws.close(4401, 'Unauthorized')
      return
    }

    const rtClient = ws as RealtimeClient
    rtClient.subscriptions = new Set()
    clients.add(rtClient)

    rtClient.send(JSON.stringify({ type: 'connected' }))

    rtClient.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>

        if (msg.type === 'subscribe') {
          const { projectId, table } = msg as { projectId: string; table: string }
          if (!UUID_RE.test(projectId) || !TABLE_RE.test(table)) {
            rtClient.send(JSON.stringify({ type: 'error', message: 'Invalid projectId or table name' }))
            return
          }
          subscribe(rtClient, projectId, table)
          rtClient.send(JSON.stringify({ type: 'ack', channel: `${projectId}:${table}` }))
        } else if (msg.type === 'unsubscribe') {
          const { projectId, table } = msg as { projectId: string; table: string }
          rtClient.subscriptions.delete(`${projectId}:${table}`)
        }
      } catch {
        rtClient.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }))
      }
    })

    rtClient.on('close', () => unregister(rtClient))
    rtClient.on('error', () => unregister(rtClient))
  })

  console.log('🔌 WebSocket server attached at /api/realtime')
}
