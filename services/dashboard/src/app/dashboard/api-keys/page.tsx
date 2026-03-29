'use client'

import { useEffect, useState } from 'react'
import { apiKeys } from '@/lib/api'
import type { ApiKey } from '@/lib/types'

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyExpiry, setNewKeyExpiry] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null) // shown once
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  useEffect(() => {
    apiKeys.list()
      .then(setKeys)
      .catch(() => showToast('Failed to load API keys', 'error'))
      .finally(() => setLoading(false))
  }, [])

  const handleCreate = async () => {
    if (!newKeyName.trim()) return
    setCreating(true)
    try {
      const created = await apiKeys.create(newKeyName.trim(), newKeyExpiry || undefined)
      setCreatedKey(created.key)
      setKeys((prev) => [created, ...prev])
      setNewKeyName('')
      setNewKeyExpiry('')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to create key', 'error')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (deleting !== id) { setDeleting(id); return }
    try {
      await apiKeys.delete(id)
      setKeys((prev) => prev.filter((k) => k.id !== id))
      showToast('API key deleted')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to delete key', 'error')
    } finally {
      setDeleting(null)
    }
  }

  const copyKey = () => {
    if (!createdKey) return
    navigator.clipboard.writeText(createdKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-md text-sm font-medium shadow-lg ${
          toast.type === 'success' ? 'bg-accent text-black' : 'bg-danger text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">API Keys</h1>
        <p className="text-sm text-gray-400 mt-1">Manage long-lived tokens for programmatic access</p>
      </div>

      {/* Created key reveal — show once */}
      {createdKey && (
        <div className="mb-6 p-4 rounded-md bg-accent/10 border border-accent/30">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-accent">API key created — save it now!</p>
            <button onClick={() => setCreatedKey(null)} className="text-gray-500 hover:text-white text-xs">Dismiss</button>
          </div>
          <p className="text-xs text-gray-400 mb-3">This key will not be shown again. Copy and store it securely.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-background rounded px-3 py-2 text-xs font-mono text-white break-all">
              {createdKey}
            </code>
            <button onClick={copyKey} className="btn-outline text-xs py-1.5 flex-shrink-0">
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Create new key */}
      <div className="card p-4 mb-6">
        <h2 className="text-sm font-medium text-white mb-3">Create New API Key</h2>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-gray-400 mb-1 block">Name</label>
            <input
              className="input text-sm"
              placeholder="e.g. Production Service, CI/CD Pipeline"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <div className="w-44">
            <label className="text-xs text-gray-400 mb-1 block">Expires (optional)</label>
            <input
              type="date"
              className="input text-sm"
              value={newKeyExpiry}
              onChange={(e) => setNewKeyExpiry(e.target.value)}
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={creating || !newKeyName.trim()}
            className="btn-primary"
          >
            {creating ? 'Creating...' : 'Create Key'}
          </button>
        </div>
      </div>

      {/* Keys table */}
      {loading ? (
        <p className="text-sm text-gray-500">Loading keys...</p>
      ) : keys.length === 0 ? (
        <div className="card p-8 text-center text-gray-500 text-sm">
          No API keys yet. Create one above.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Owner</th>
                <th>Last Used</th>
                <th>Expires</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id}>
                  <td className="text-white font-medium">{key.name}</td>
                  <td>
                    <code className="text-accent font-mono">{key.key_prefix}••••••••</code>
                  </td>
                  <td className="text-gray-400">{key.owner_email ?? '—'}</td>
                  <td className="text-gray-400">
                    {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never'}
                  </td>
                  <td>
                    {key.expires_at ? (
                      <span className={new Date(key.expires_at) < new Date() ? 'text-danger' : 'text-gray-400'}>
                        {new Date(key.expires_at).toLocaleDateString()}
                      </span>
                    ) : (
                      <span className="badge badge-green">Never</span>
                    )}
                  </td>
                  <td className="text-gray-400">{new Date(key.created_at).toLocaleDateString()}</td>
                  <td>
                    <button
                      onClick={() => handleDelete(key.id)}
                      className={`text-xs px-2 py-0.5 rounded transition-colors ${
                        deleting === key.id
                          ? 'bg-danger text-white'
                          : 'text-gray-500 hover:text-danger'
                      }`}
                    >
                      {deleting === key.id ? 'Confirm?' : 'Revoke'}
                    </button>
                    {deleting === key.id && (
                      <button onClick={() => setDeleting(null)} className="text-xs text-gray-500 hover:text-white ml-1">✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 p-4 rounded-md bg-surface border border-border text-xs text-gray-500">
        <strong className="text-gray-400">Usage:</strong>{' '}
        Include the key in the <code className="text-white">Authorization</code> header:{' '}
        <code className="text-accent">Authorization: Bearer {'<your-key>'}</code>
      </div>
    </div>
  )
}
