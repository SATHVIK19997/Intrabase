'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { projects as projectsApi } from '@/lib/api'
import type { Project } from '@/lib/types'

const PROJECT_COLORS = [
  '#3ecf8e', '#3b82f6', '#8b5cf6', '#f59e0b',
  '#ef4444', '#06b6d4', '#ec4899', '#84cc16',
]

function CreateProjectModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (p: Project) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#3ecf8e')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Project name is required'); return }
    setLoading(true)
    setError('')
    try {
      const project = await projectsApi.create({ name: name.trim(), description: description.trim() || undefined, color })
      onCreate(project)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create project')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="card w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">New Project</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Project Name *</label>
            <input
              className="input"
              placeholder="e.g. HR System, Finance, Analytics"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              autoFocus
            />
            {name && (
              <p className="text-xs text-gray-600 mt-1">
                Schema: <code className="text-gray-400">{name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || '...'}</code>
              </p>
            )}
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Description</label>
            <input
              className="input"
              placeholder="Optional description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-2 block">Color</label>
            <div className="flex gap-2 flex-wrap">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                  style={{ backgroundColor: c, outline: color === c ? `2px solid ${c}` : 'none', outlineOffset: '2px' }}
                />
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button onClick={handleSubmit} disabled={loading} className="btn-primary flex-1">
              {loading ? 'Creating...' : 'Create Project'}
            </button>
            <button onClick={onClose} className="btn-ghost">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProjectCard({ project, onDelete }: { project: Project; onDelete: (id: string) => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault()
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    try {
      await projectsApi.delete(project.id)
      onDelete(project.id)
    } catch (err) {
      console.error(err)
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <Link href={`/dashboard/projects/${project.id}`} className="block group">
      <div className="card p-5 hover:border-gray-600 transition-all duration-150 h-full">
        {/* Color bar */}
        <div
          className="w-full h-1 rounded-full mb-4 opacity-80"
          style={{ backgroundColor: project.color }}
        />

        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-white group-hover:text-accent transition-colors leading-tight">
            {project.name}
          </h3>
          {/* Delete button */}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className={`flex-shrink-0 text-xs px-2 py-0.5 rounded transition-colors opacity-0 group-hover:opacity-100 ${
              confirmDelete ? 'bg-danger text-white' : 'text-gray-600 hover:text-danger'
            }`}
            title={confirmDelete ? 'Click again to confirm delete' : 'Delete project'}
          >
            {deleting ? '...' : confirmDelete ? 'Confirm?' : '✕'}
          </button>
        </div>

        {project.description && (
          <p className="text-xs text-gray-500 mb-3 line-clamp-2">{project.description}</p>
        )}

        <div className="flex items-center justify-between mt-auto pt-2">
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3.375 19.5h17.25M3.375 19.5V5.625m0 13.875h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 0A2.625 2.625 0 016 3h12a2.625 2.625 0 012.625 2.625" />
            </svg>
            <span className="text-xs text-gray-500">
              {project.table_count} {project.table_count === 1 ? 'table' : 'tables'}
            </span>
          </div>
          <span className="text-xs text-gray-600 font-mono">{project.slug}</span>
        </div>
      </div>
    </Link>
  )
}

export default function ProjectsPage() {
  const [projectList, setProjectList] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    projectsApi.list()
      .then(setProjectList)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const handleCreated = (project: Project) => {
    setProjectList((prev) => [project, ...prev])
    setShowCreate(false)
  }

  const handleDeleted = (id: string) => {
    setProjectList((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <div className="p-8 max-w-6xl">
      {showCreate && (
        <CreateProjectModal onClose={() => setShowCreate(false)} onCreate={handleCreated} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-white">Projects</h1>
          <p className="text-sm text-gray-400 mt-1">Each project has its own isolated schema and tables</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Project
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="h-1 bg-border rounded mb-4" />
              <div className="h-4 bg-border rounded w-2/3 mb-2" />
              <div className="h-3 bg-border rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : projectList.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="w-14 h-14 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375" />
            </svg>
          </div>
          <h3 className="text-base font-medium text-white mb-1">No projects yet</h3>
          <p className="text-sm text-gray-500 mb-6">Create your first project to start organizing your tables</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary mx-auto">
            Create your first project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projectList.map((project) => (
            <ProjectCard key={project.id} project={project} onDelete={handleDeleted} />
          ))}
        </div>
      )}
    </div>
  )
}
