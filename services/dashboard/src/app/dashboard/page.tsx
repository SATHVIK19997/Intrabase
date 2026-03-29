'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { tables, auditLogs } from '@/lib/api'
import type { TableInfo, AuditLog } from '@/lib/types'

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-semibold text-white">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  )
}

function methodBadge(method: string) {
  const colors: Record<string, string> = {
    GET:    'badge-blue',
    POST:   'badge-green',
    PATCH:  'badge-yellow',
    DELETE: 'badge-red',
  }
  return <span className={`badge ${colors[method] ?? 'badge-gray'}`}>{method}</span>
}

function statusBadge(code: number) {
  if (code < 300) return <span className="badge badge-green">{code}</span>
  if (code < 400) return <span className="badge badge-blue">{code}</span>
  if (code < 500) return <span className="badge badge-yellow">{code}</span>
  return <span className="badge badge-red">{code}</span>
}

export default function OverviewPage() {
  const [tableList, setTableList] = useState<TableInfo[]>([])
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      tables.list().catch(() => [] as TableInfo[]),
      auditLogs.list({ limit: 8 }).catch(() => [] as AuditLog[]),
    ]).then(([t, l]) => {
      setTableList(t)
      setLogs(l)
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <div className="p-8 text-gray-500 text-sm">Loading overview...</div>
    )
  }

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-white">Overview</h1>
        <p className="text-sm text-gray-400 mt-1">Database and activity summary</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Tables" value={tableList.length} sub="in public schema" />
        <StatCard label="Total Columns" value={tableList.reduce((a, t) => a + t.columns.length, 0)} />
        <StatCard label="Recent Requests" value={logs.length} sub="last 8 API calls" />
        <StatCard
          label="Errors"
          value={logs.filter((l) => l.status_code >= 400).length}
          sub="in recent logs"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tables list */}
        <div className="card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="text-sm font-medium text-white">Tables</h2>
            <Link href="/dashboard/tables" className="text-xs text-accent hover:text-accent-hover">
              View all →
            </Link>
          </div>
          <div className="divide-y divide-border/50">
            {tableList.length === 0 && (
              <p className="px-4 py-6 text-sm text-gray-500 text-center">No tables found in public schema</p>
            )}
            {tableList.slice(0, 8).map((t) => (
              <Link
                key={t.name}
                href={`/dashboard/tables/${t.name}`}
                className="flex items-center justify-between px-4 py-2.5 hover:bg-background/50 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M3.375 19.5h17.25M3.375 19.5V5.625m0 13.875h17.25V5.625m0 0H3.375m0 0A2.625 2.625 0 006 3h12a2.625 2.625 0 012.625 2.625" />
                  </svg>
                  <span className="text-sm text-white font-mono">{t.name}</span>
                </div>
                <span className="text-xs text-gray-500">{t.columns.length} cols</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div className="card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="text-sm font-medium text-white">Recent Activity</h2>
            <Link href="/dashboard/logs" className="text-xs text-accent hover:text-accent-hover">
              View all →
            </Link>
          </div>
          <div className="divide-y divide-border/50">
            {logs.length === 0 && (
              <p className="px-4 py-6 text-sm text-gray-500 text-center">No activity yet</p>
            )}
            {logs.map((log) => (
              <div key={log.id} className="flex items-center gap-3 px-4 py-2.5">
                {methodBadge(log.method)}
                <span className="text-xs text-gray-400 font-mono flex-1 truncate">
                  {log.table_name ?? log.path}
                </span>
                {statusBadge(log.status_code)}
                <span className="text-xs text-gray-600">{log.duration_ms}ms</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
