'use client'

import { useState } from 'react'
import { SqlEditor } from '@/components/SqlEditor'
import { sql as sqlApi } from '@/lib/api'
import type { QueryResult, Row } from '@/lib/types'

const EXAMPLES = [
  { label: 'List tables', query: `SELECT table_name, table_type\nFROM information_schema.tables\nWHERE table_schema = 'public'\nORDER BY table_name;` },
  { label: 'Table columns', query: `SELECT column_name, data_type, is_nullable, column_default\nFROM information_schema.columns\nWHERE table_schema = 'public'\n  AND table_name = 'your_table'\nORDER BY ordinal_position;` },
  { label: 'Row counts', query: `SELECT\n  relname AS table_name,\n  n_live_tup AS row_count\nFROM pg_stat_user_tables\nORDER BY n_live_tup DESC;` },
  { label: 'DB size', query: `SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;` },
]

function methodBadge(code: number) {
  if (code < 300) return 'badge-green'
  return 'badge-red'
}

export default function SqlEditorPage() {
  const [query, setQuery] = useState('SELECT now();')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<string[]>([])

  const runQuery = async () => {
    if (!query.trim()) return
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await sqlApi.run(query)
      setResult(res)
      setHistory((h) => [query, ...h.filter((q) => q !== query)].slice(0, 20))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Query failed')
    } finally {
      setRunning(false)
    }
  }

  const exportCsv = () => {
    if (!result || result.rows.length === 0) return
    const cols = Object.keys(result.rows[0])
    const lines = [
      cols.join(','),
      ...result.rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? '')).join(',')),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'query_result.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const resultColumns = result && result.rows.length > 0 ? Object.keys(result.rows[0]) : []

  return (
    <div className="flex h-screen">
      {/* Left panel: history */}
      <div className="w-48 flex-shrink-0 border-r border-border bg-surface flex flex-col">
        <div className="px-3 py-3 border-b border-border">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Examples</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              onClick={() => setQuery(ex.query)}
              className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:text-white hover:bg-background border-b border-border/30 transition-colors"
            >
              {ex.label}
            </button>
          ))}
          {history.length > 0 && (
            <>
              <div className="px-3 py-2 border-b border-border">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">History</p>
              </div>
              {history.map((q, i) => (
                <button
                  key={i}
                  onClick={() => setQuery(q)}
                  className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:text-white hover:bg-background border-b border-border/30 transition-colors truncate"
                  title={q}
                >
                  {q.slice(0, 40)}{q.length > 40 ? '…' : ''}
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Main editor area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Editor */}
        <div className="flex-shrink-0 p-4 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-sm font-semibold text-white">SQL Editor</h1>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-600">Ctrl+Enter to run</span>
              <button
                onClick={runQuery}
                disabled={running}
                className="btn-primary text-xs py-1.5"
              >
                {running ? (
                  <span className="flex items-center gap-1.5">
                    <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Running...
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                    </svg>
                    Run Query
                  </span>
                )}
              </button>
            </div>
          </div>
          <SqlEditor value={query} onChange={setQuery} onRun={runQuery} height="200px" />
        </div>

        {/* Results */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {error ? (
            <div className="p-4">
              <div className="p-3 rounded-md bg-danger/10 border border-danger/30 text-danger text-xs font-mono">
                {error}
              </div>
            </div>
          ) : result ? (
            <>
              {/* Results header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-border flex-shrink-0">
                <div className="flex items-center gap-3">
                  <span className="badge badge-green">{result.rowCount} rows</span>
                  <span className="text-xs text-gray-500">{result.duration_ms}ms</span>
                </div>
                {result.rows.length > 0 && (
                  <button onClick={exportCsv} className="btn-ghost text-xs py-1">
                    Export CSV
                  </button>
                )}
              </div>

              {/* Results table */}
              <div className="flex-1 overflow-auto">
                {result.rows.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-gray-500">Query returned no rows.</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        {resultColumns.map((col) => (
                          <th key={col}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, i) => (
                        <tr key={i}>
                          {resultColumns.map((col) => (
                            <td key={col}>
                              {row[col] == null ? (
                                <span className="text-gray-600 italic">null</span>
                              ) : (
                                String(row[col])
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center flex-1 text-gray-600 text-sm">
              Run a query to see results
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
