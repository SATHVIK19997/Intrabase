'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { tables } from '@/lib/api'
import type { TableInfo } from '@/lib/types'

export default function TablesPage() {
  const [tableList, setTableList] = useState<TableInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    tables.list()
      .then(setTableList)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filtered = tableList.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">Table Editor</h1>
        <p className="text-sm text-gray-400 mt-1">Browse and edit your database tables</p>
      </div>

      <div className="mb-4">
        <input
          className="input max-w-xs"
          placeholder="Search tables..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading tables...</p>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-gray-500 text-sm">
            {search ? `No tables matching "${search}"` : 'No tables found in the public schema.'}
          </p>
          <p className="text-gray-600 text-xs mt-2">
            Use the SQL Editor to create tables.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Table Name</th>
                <th>Columns</th>
                <th>Primary Key</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const pk = t.columns.find((c) => c.isPrimaryKey)
                return (
                  <tr key={t.name}>
                    <td>
                      <span className="font-mono text-white">{t.name}</span>
                    </td>
                    <td>
                      <span className="text-gray-400">{t.columns.length}</span>
                    </td>
                    <td>
                      {pk ? (
                        <span className="font-mono text-accent">{pk.name}</span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td>
                      <Link
                        href={`/dashboard/tables/${t.name}`}
                        className="text-xs text-accent hover:text-accent-hover"
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
