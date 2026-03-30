import { Client } from 'pg'
import { env } from '../config/env'
import { broadcast } from './broadcaster'

// Derive a direct (non-pooler) connection string from Neon's pooler URL
// Neon pooler hostnames contain "-pooler"; strip it for direct connections
function getDirectUrl(): string {
  const url = env.DATABASE_DIRECT_URL ?? env.DATABASE_URL
  return url.replace(/-pooler\./, '.')
}

let retryDelay = 2000

async function connect(): Promise<void> {
  const client = new Client({ connectionString: getDirectUrl() })

  try {
    await client.connect()
    await client.query('LISTEN intrabase_realtime')
    retryDelay = 2000 // reset backoff on success
    console.log('✅ Realtime listener connected — LISTEN intrabase_realtime')

    client.on('notification', (msg) => {
      if (!msg.payload) return
      try {
        const data = JSON.parse(msg.payload) as {
          projectId: string
          table: string
          op: string
          record: Record<string, unknown>
        }
        broadcast(data.projectId, data.table, {
          type: 'event',
          op: data.op,
          table: data.table,
          record: data.record,
        })
      } catch {
        console.warn('Realtime: failed to parse notification payload')
      }
    })

    client.on('error', (err) => {
      console.error('Realtime listener error:', err.message)
      client.end().catch(() => {})
      scheduleReconnect()
    })

    client.on('end', () => {
      console.warn('Realtime listener disconnected — reconnecting...')
      scheduleReconnect()
    })
  } catch (err) {
    console.error('Realtime listener failed to connect:', (err as Error).message)
    await client.end().catch(() => {})
    scheduleReconnect()
  }
}

function scheduleReconnect(): void {
  setTimeout(() => connect(), retryDelay)
  retryDelay = Math.min(retryDelay * 2, 30000) // cap at 30s
}

export async function startListener(): Promise<void> {
  await connect()
}
