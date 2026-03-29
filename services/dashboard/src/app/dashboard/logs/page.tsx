'use client'

import { useEffect, useState } from 'react'
import { auditLogs } from '@/lib/api'
import type { AuditLog } from '@/lib/types'

const PAGE_SIZE = 50

function methodBadge(method: string) {
  const cls: Record<string, string> = {
    GET: 'badge-blue', POST: 'badge-green', PATCH: 'badge-yellow', DELETE: 'badge-red',
  }
  return <span className={`badge ${cls[method] ?? 'badge-gray'}`}>{method}</span>
}

function statusBadge(code: number) {
  if (code < 300) return <span className="badge badge-green">{code}</span>
  if (code < 400) return <span className="badge badge-blue">{code}</span>
  if (code < 500) return <span className="badge badge-yellow">{code}</span>
  return <span className="badge badge-red">{code}</span>
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' })
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [tableFilter, setTableFilter] = useState('')

  const fetchLogs = async (off = 0, tbl = tableFilter) => {
    setLoading(true)
    try {
      const data = await auditLogs.list({ limit: PAGE_SIZE, offset: off, table: tbl || undefined })
      setLogs(data)
      setHasMore(data.length === PAGE_SIZE)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchLogs() }, [])

  const handleFilter = () => { setOffset(0); fetchLogs(0, tableFilter) }
  const handlePrev = () => { const o = Math.max(0, offset - PAGE_SIZE); setOffset(o); fetchLogs(o) }
  const handleNext = () => { const o = offset + PAGE_SIZE; setOffset(o); fetchLogs(o) }

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">Audit Logs</h1>
        <p className="text-sm text-gray-400 mt-1">All API calls and SQL editor activity</p>
      </div>

      {/* Filters + pagination */}
      <div className="flex items-center gap-3 mb-4">
        <input
          className="input text-xs py-1.5 w-48"
          placeholder="Filter by table..."
          value={tableFilter}
          onChange={(e) => setTableFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleFilter()}
        />
        <button onClick={handleFilter} className="btn-outline text-xs py-1.5">Filter</button>
        {tableFilter && (
          <button onClick={() => { setTableFilter(''); fetchLogs(0, '') }} className="btn-ghost text-xs py-1.5">Clear</button>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <button onClick={handlePrev} disabled={offset === 0} className="btn-ghost py-1 px-2 disabled:opacity-30">← Prev</button>
          <span>{offset + 1}–{offset + logs.length}</span>
          <button onClick={handleNext} disabled={!hasMore} className="btn-ghost py-1 px-2 disabled:opacity-30">Next →</button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading logs...</p>
      ) : logs.length === 0 ? (
        <div className="card p-8 text-center text-gray-500 text-sm">No logs found.</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Method</th>
                <th>Table / Path</th>
                <th>Status</th>
                <th>Duration</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="text-gray-400 whitespace-nowrap">{formatTime(log.created_at)}</td>
                  <td className="text-gray-300">{log.user_email ?? <span className="text-gray-600">—</span>}</td>
                  <td>{methodBadge(log.method)}</td>
                  <td className="font-mono">
                    {log.table_name ? (
                      <span className="text-white">{log.table_name}</span>
                    ) : (
                      <span className="text-gray-500">{log.path}</span>
                    )}
                  </td>
                  <td>{statusBadge(log.status_code)}</td>
                  <td className="text-gray-400">{log.duration_ms}ms</td>
                  <td className="text-gray-600">{log.ip_address}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
