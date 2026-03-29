'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { projects as projectsApi, sql as sqlApi } from '@/lib/api'
import { TableGrid } from '@/components/TableGrid'
import { SqlEditor } from '@/components/SqlEditor'
import { CreateTableModal } from '@/components/CreateTableModal'
import type { ProjectDetail, ProjectTable, Row, ColumnInfo } from '@/lib/types'

const PAGE_SIZE = 50

// ── Inline table editor for a project table ───────────────────────────────────
function ProjectTableEditor({
  projectId,
  table,
  onClose,
}: {
  projectId: string
  table: string
  onClose: () => void
}) {
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchRows = useCallback(async (off = 0) => {
    setLoading(true)
    try {
      const data = await projectsApi.restSelect(projectId, table, {
        limit: String(PAGE_SIZE), offset: String(off),
      })
      setRows(data)
      setHasMore(data.length === PAGE_SIZE)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to load', 'error')
    } finally {
      setLoading(false)
    }
  }, [projectId, table])

  useEffect(() => {
    // Get columns via SQL introspection
    sqlApi.run(`
      SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
             COALESCE(pk.is_pk, false) as is_pk
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT kcu.column_name, true as is_pk
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = (SELECT slug FROM intrabase_system.projects WHERE id = '${projectId}')
          AND tc.table_name = '${table}'
      ) pk ON c.column_name = pk.column_name
      WHERE c.table_schema = (SELECT slug FROM intrabase_system.projects WHERE id = '${projectId}')
        AND c.table_name = '${table}'
      ORDER BY c.ordinal_position
    `).then((res) => {
      setColumns(res.rows.map((r) => ({
        name: r.column_name as string,
        dataType: r.data_type as string,
        isNullable: r.is_nullable === 'YES',
        columnDefault: r.column_default as string | null,
        isPrimaryKey: r.is_pk as boolean,
      })))
    }).catch(console.error)

    fetchRows(0)
  }, [projectId, table, fetchRows])

  const handlePrev = () => { const o = Math.max(0, offset - PAGE_SIZE); setOffset(o); fetchRows(o) }
  const handleNext = () => { const o = offset + PAGE_SIZE; setOffset(o); fetchRows(o) }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface/50 flex-shrink-0">
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
        </button>
        <span className="text-sm font-mono font-medium text-white">{table}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <button onClick={handlePrev} disabled={offset === 0} className="btn-ghost py-1 px-2 disabled:opacity-30">← Prev</button>
          <span>{offset + 1}–{offset + rows.length}</span>
          <button onClick={handleNext} disabled={!hasMore} className="btn-ghost py-1 px-2 disabled:opacity-30">Next →</button>
        </div>
      </div>

      {toast && (
        <div className={`absolute top-16 right-4 z-50 px-4 py-2 rounded-md text-sm font-medium shadow-lg ${
          toast.type === 'success' ? 'bg-accent text-black' : 'bg-danger text-white'
        }`}>{toast.msg}</div>
      )}

      <div className="flex-1 overflow-hidden">
        {columns.length === 0 ? (
          <div className="p-8 text-sm text-gray-500">Loading columns...</div>
        ) : (
          <TableGrid
            columns={columns}
            rows={rows}
            loading={loading}
            onInsert={async (row) => {
              await projectsApi.restInsert(projectId, table, row)
              showToast('Row inserted')
              fetchRows(offset)
            }}
            onUpdate={async (pkCol, pkVal, data) => {
              await projectsApi.restUpdate(projectId, table, { [pkCol]: `eq.${pkVal}` }, data)
              showToast('Row updated')
              setRows((prev) => prev.map((r) => r[pkCol] === pkVal ? { ...r, ...data } : r))
            }}
            onDelete={async (pkCol, pkVal) => {
              await projectsApi.restDelete(projectId, table, { [pkCol]: `eq.${pkVal}` })
              showToast('Row deleted')
              setRows((prev) => prev.filter((r) => r[pkCol] !== pkVal))
            }}
          />
        )}
      </div>
    </div>
  )
}

// ── Main Project Detail Page ──────────────────────────────────────────────────
export default function ProjectDetailPage() {
  const params = useParams()
  const projectId = params.id as string

  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'tables' | 'sql'>('tables')
  const [showCreateTable, setShowCreateTable] = useState(false)
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [sqlQuery, setSqlQuery] = useState('')
  const [sqlResult, setSqlResult] = useState<{ rows: Row[]; rowCount: number; duration_ms: number } | null>(null)
  const [sqlError, setSqlError] = useState<string | null>(null)
  const [sqlRunning, setSqlRunning] = useState(false)
  const [editingProject, setEditingProject] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')

  useEffect(() => {
    projectsApi.get(projectId)
      .then((p) => {
        setProject(p)
        setSqlQuery(`-- Tables in project: ${p.name}\nSELECT table_name FROM information_schema.tables WHERE table_schema = '${p.slug}' ORDER BY table_name;`)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [projectId])

  const runSql = async () => {
    setSqlRunning(true); setSqlError(null); setSqlResult(null)
    try { setSqlResult(await sqlApi.run(sqlQuery)) }
    catch (e: unknown) { setSqlError(e instanceof Error ? e.message : 'Query failed') }
    finally { setSqlRunning(false) }
  }

  const refreshTables = () => {
    projectsApi.get(projectId).then(setProject).catch(console.error)
  }

  const saveEdit = async () => {
    if (!project) return
    try {
      const updated = await projectsApi.update(project.id, { name: editName, description: editDesc })
      setProject((p) => p ? { ...p, ...updated } : p)
      setEditingProject(false)
    } catch (e: unknown) {
      console.error(e)
    }
  }

  if (loading) return <div className="p-8 text-sm text-gray-500">Loading project...</div>
  if (!project) return <div className="p-8 text-sm text-danger">Project not found.</div>

  return (
    <div className="flex flex-col h-screen">

      {/* Create Table Modal */}
      {showCreateTable && project && (
        <CreateTableModal
          schema={project.slug}
          projectId={project.id}
          onClose={() => setShowCreateTable(false)}
          runSql={async (sql) => {
            const result = await sqlApi.run(sql)
            return result
          }}
          onCreated={(tableName) => {
            setShowCreateTable(false)
            refreshTables()
            setSelectedTable(tableName)
            setActiveTab('tables')
          }}
        />
      )}

      {/* Project header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-border bg-surface">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/projects" className="text-gray-500 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </Link>

          {/* Color dot */}
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project.color }} />

          {editingProject ? (
            <div className="flex items-center gap-2 flex-1">
              <input className="input text-sm py-1 w-48" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
              <input className="input text-xs py-1 w-64 text-gray-400" placeholder="Description" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
              <button onClick={saveEdit} className="btn-primary text-xs py-1">Save</button>
              <button onClick={() => setEditingProject(false)} className="btn-ghost text-xs py-1">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-1">
              <h1 className="text-base font-semibold text-white">{project.name}</h1>
              {project.description && <span className="text-sm text-gray-500">{project.description}</span>}
              <code className="text-xs text-gray-600 bg-background px-2 py-0.5 rounded">{project.slug}</code>
              <button onClick={() => { setEditingProject(true); setEditName(project.name); setEditDesc(project.description ?? '') }}
                className="text-gray-600 hover:text-white transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                </svg>
              </button>
            </div>
          )}

          {/* Tabs */}
          <div className="flex items-center gap-1 bg-background rounded-md p-1">
            {(['tables', 'sql'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setSelectedTable(null) }}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors capitalize ${
                  activeTab === tab ? 'bg-surface text-white' : 'text-gray-500 hover:text-white'
                }`}
              >
                {tab === 'tables' ? `Tables (${project.tables.length})` : 'SQL Editor'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden flex">

        {/* ── Tables tab ── */}
        {activeTab === 'tables' && (
          <>
            {/* Table list sidebar */}
            <div className="w-52 flex-shrink-0 border-r border-border bg-surface flex flex-col">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Tables</span>
                <button
                  onClick={() => setShowCreateTable(true)}
                  title="Create new table"
                  className="text-gray-600 hover:text-accent transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto py-1">
                {project.tables.length === 0 ? (
                  <div className="px-3 py-6 text-center">
                    <p className="text-xs text-gray-600 mb-3">No tables yet</p>
                    <button
                      onClick={() => setShowCreateTable(true)}
                      className="text-xs text-accent hover:text-accent-hover"
                    >
                      Create a table →
                    </button>
                  </div>
                ) : (
                  project.tables.map((t) => (
                    <button
                      key={t.name}
                      onClick={() => setSelectedTable(t.name)}
                      className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors border-b border-border/30 ${
                        selectedTable === t.name
                          ? 'bg-accent/10 text-accent'
                          : 'text-gray-400 hover:text-white hover:bg-background'
                      }`}
                    >
                      <span className="text-xs font-mono">{t.name}</span>
                      <span className="text-xs text-gray-600">{t.column_count}</span>
                    </button>
                  ))
                )}
              </div>
              {project.tables.length > 0 && (
                <div className="border-t border-border px-3 py-2">
                  <button
                    onClick={refreshTables}
                    className="text-xs text-gray-600 hover:text-white flex items-center gap-1.5 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    Refresh
                  </button>
                </div>
              )}
            </div>

            {/* Table editor or empty state */}
            <div className="flex-1 overflow-hidden relative">
              {selectedTable ? (
                <ProjectTableEditor
                  projectId={projectId}
                  table={selectedTable}
                  onClose={() => setSelectedTable(null)}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-center px-8">
                  <div>
                    <p className="text-gray-500 text-sm mb-1">
                      {project.tables.length > 0
                        ? 'Select a table from the left to view and edit its data'
                        : 'This project has no tables yet'}
                    </p>
                    {project.tables.length === 0 && (
                      <button
                        onClick={() => setShowCreateTable(true)}
                        className="btn-outline text-xs mt-3"
                      >
                        Create your first table
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── SQL tab ── */}
        {activeTab === 'sql' && (
          <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">
                Schema: <code className="text-accent">{project.slug}</code> — use <code className="text-accent">{project.slug}.tablename</code> in your queries
              </p>
              <div className="flex gap-2">
                <span className="text-xs text-gray-600">Ctrl+Enter to run</span>
                <button onClick={runSql} disabled={sqlRunning} className="btn-primary text-xs py-1.5">
                  {sqlRunning ? 'Running...' : '▶ Run'}
                </button>
              </div>
            </div>

            <SqlEditor value={sqlQuery} onChange={setSqlQuery} onRun={runSql} height="220px" />

            {/* Results */}
            <div className="flex-1 overflow-auto">
              {sqlError ? (
                <div className="p-3 rounded-md bg-danger/10 border border-danger/30 text-danger text-xs font-mono">{sqlError}</div>
              ) : sqlResult ? (
                <>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="badge badge-green">{sqlResult.rowCount} rows</span>
                    <span className="text-xs text-gray-500">{sqlResult.duration_ms}ms</span>
                    <button
                      onClick={refreshTables}
                      className="text-xs text-accent hover:text-accent-hover ml-auto"
                    >
                      Refresh table list
                    </button>
                  </div>
                  {sqlResult.rows.length > 0 && (
                    <div className="card overflow-auto max-h-72">
                      <table className="data-table">
                        <thead>
                          <tr>{Object.keys(sqlResult.rows[0]).map((c) => <th key={c}>{c}</th>)}</tr>
                        </thead>
                        <tbody>
                          {sqlResult.rows.map((row, i) => (
                            <tr key={i}>
                              {Object.values(row).map((v, j) => (
                                <td key={j}>{v == null ? <span className="text-gray-600 italic">null</span> : String(v)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-gray-600">Run a query to see results</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
