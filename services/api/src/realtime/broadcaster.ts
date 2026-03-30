import { WebSocket } from 'ws'

export interface RealtimeClient extends WebSocket {
  subscriptions: Set<string>
}

export const clients = new Set<RealtimeClient>()

export function subscribe(ws: RealtimeClient, projectId: string, table: string): void {
  ws.subscriptions.add(`${projectId}:${table}`)
}

export function unregister(ws: RealtimeClient): void {
  clients.delete(ws)
}

export function broadcast(projectId: string, table: string, payload: object): void {
  const channel = `${projectId}:${table}`
  const message = JSON.stringify(payload)
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN && client.subscriptions.has(channel)) {
      client.send(message)
    }
  }
}
