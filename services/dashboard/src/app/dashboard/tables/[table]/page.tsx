'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { tables, rest } from '@/lib/api'
import { TableGrid } from '@/components/TableGrid'
import type { TableInfo, Row } from '@/lib/types'

const PAGE_SIZE = 50

export default function TableEditorPage() {
  const params = useParams()
  const tableName = params.table as string

  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [search, setSearch] = useState('')
  const [searchCol, setSearchCol] = useState('')
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchRows = useCallback(async (off = 0) => {
    setLoading(true)
    try {
      const params: Record<string, string> = {
        limit: String(PAGE_SIZE),
        offset: String(off),
        order: 'created_at.desc',
      }
      if (search && searchCol) {
        params[searchCol] = `ilike.%${search}%`
      }
      const data = await rest.select(tableName, params)
      setRows(data)
      setHasMore(data.length === PAGE_SIZE)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to load rows', 'error')
    } finally {
      setLoading(false)
    }
  }, [tableName, search, searchCol])

  useEffect(() => {
    Promise.all([
      tables.get(tableName),
      rest.select(tableName, { limit: String(PAGE_SIZE), offset: '0', order: 'created_at.desc' }),
    ]).then(([info, data]) => {
      setTableInfo(info)
      setRows(data)
      setHasMore(data.length === PAGE_SIZE)
      if (info.columns.length > 0) {
        setSearchCol(info.columns.find((c) => c.dataType.includes('text') || c.dataType.includes('char'))?.name ?? '')
      }
    }).catch((e: unknown) => {
      showToast(e instanceof Error ? e.message : 'Failed to load table', 'error')
    }).finally(() => setLoading(false))
  }, [tableName])

  const handleInsert = async (row: Record<string, unknown>) => {
    await rest.insert(tableName, row)
    showToast('Row inserted')
    fetchRows(offset)
  }

  const handleUpdate = async (pkCol: string, pkVal: unknown, data: Record<string, unknown>) => {
    await rest.update(tableName, { [pkCol]: `eq.${pkVal}` }, data)
    showToast('Row updated')
    setRows((prev) =>
      prev.map((r) => (r[pkCol] === pkVal ? { ...r, ...data } : r))
    )
  }

  const handleDelete = async (pkCol: string, pkVal: unknown) => {
    await rest.delete(tableName, { [pkCol]: `eq.${pkVal}` })
    showToast('Row deleted')
    setRows((prev) => prev.filter((r) => r[pkCol] !== pkVal))
  }

  const handleSearch = () => fetchRows(0)

  const handlePrev = () => {
    const newOffset = Math.max(0, offset - PAGE_SIZE)
    setOffset(newOffset)
    fetchRows(newOffset)
  }

  const handleNext = () => {
    const newOffset = offset + PAGE_SIZE
    setOffset(newOffset)
    fetchRows(newOffset)
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border bg-surface flex-shrink-0">
        <Link href="/dashboard/tables" className="text-gray-500 hover:text-white transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
        </Link>
        <h1 className="text-sm font-semibold text-white font-mono">{tableName}</h1>
        {tableInfo && (
          <span className="text-xs text-gray-500">{tableInfo.columns.length} columns</span>
        )}

        <div className="flex-1" />

        {/* Search */}
        {tableInfo && (
          <div className="flex items-center gap-2">
            <select
              className="input text-xs py-1 w-36"
              value={searchCol}
              onChange={(e) => setSearchCol(e.target.value)}
            >
              <option value="">All columns</option>
              {tableInfo.columns.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
            <input
              className="input text-xs py-1 w-48"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <button onClick={handleSearch} className="btn-outline text-xs py-1">Filter</button>
            {search && (
              <button onClick={() => { setSearch(''); fetchRows(0) }} className="btn-ghost text-xs py-1">Clear</button>
            )}
          </div>
        )}

        {/* Pagination */}
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <button onClick={handlePrev} disabled={offset === 0} className="btn-ghost py-1 px-2 disabled:opacity-30">← Prev</button>
          <span>{offset + 1}–{offset + rows.length}</span>
          <button onClick={handleNext} disabled={!hasMore} className="btn-ghost py-1 px-2 disabled:opacity-30">Next →</button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-md text-sm font-medium shadow-lg ${
          toast.type === 'success' ? 'bg-accent text-black' : 'bg-danger text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Table grid */}
      <div className="flex-1 overflow-hidden">
        {!tableInfo ? (
          <div className="p-8 text-gray-500 text-sm">Loading...</div>
        ) : (
          <TableGrid
            columns={tableInfo.columns}
            rows={rows}
            onInsert={handleInsert}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            loading={loading}
          />
        )}
      </div>

      {/* Schema footer */}
      {tableInfo && (
        <div className="flex-shrink-0 px-4 py-2 border-t border-border bg-surface/50 overflow-x-auto">
          <div className="flex gap-4">
            {tableInfo.columns.map((col) => (
              <div key={col.name} className="flex-shrink-0 text-xs">
                <span className={col.isPrimaryKey ? 'text-accent font-medium' : 'text-gray-400'}>
                  {col.name}
                </span>
                <span className="text-gray-600 ml-1">{col.dataType}</span>
                {!col.isNullable && <span className="text-red-500 ml-0.5">*</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
