'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { users as usersApi, auth } from '@/lib/api'
import type { IntraUser, AuthUser, UserRole } from '@/lib/types'

const ROLES: UserRole[] = ['admin', 'editor', 'viewer']

const roleBadge = (role: UserRole) => {
  const cls = { admin: 'badge-red', editor: 'badge-blue', viewer: 'badge-gray' }
  return <span className={`badge ${cls[role]}`}>{role}</span>
}

export default function UsersPage() {
  const [userList, setUserList] = useState<IntraUser[]>([])
  const [me, setMe] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    Promise.all([usersApi.list(), auth.me()])
      .then(([list, me]) => { setUserList(list); setMe(me) })
      .catch(() => showToast('Failed to load users', 'error'))
      .finally(() => setLoading(false))
  }, [])

  const handleRoleChange = async (userId: string, role: UserRole) => {
    setUpdating(userId)
    try {
      const updated = await usersApi.update(userId, { role })
      setUserList((prev) => prev.map((u) => u.id === userId ? { ...u, role: updated.role } : u))
      showToast('Role updated')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to update role', 'error')
    } finally {
      setUpdating(null)
    }
  }

  const handleToggleActive = async (userId: string, is_active: boolean) => {
    setUpdating(userId)
    try {
      await usersApi.update(userId, { is_active })
      setUserList((prev) => prev.map((u) => u.id === userId ? { ...u, is_active } : u))
      showToast(is_active ? 'User activated' : 'User deactivated')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to update user', 'error')
    } finally {
      setUpdating(null)
    }
  }

  if (me?.role !== 'admin' && !loading) {
    return (
      <div className="p-8">
        <div className="card p-6 text-center text-gray-500">
          <p>Admin access required to manage users.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-5xl">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-md text-sm font-medium shadow-lg ${
          toast.type === 'success' ? 'bg-accent text-black' : 'bg-danger text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">Users</h1>
        <p className="text-sm text-gray-400 mt-1">Manage team access and roles</p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading users...</p>
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Login</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {userList.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      {user.avatar_url ? (
                        <Image
                          src={user.avatar_url}
                          alt={user.name}
                          width={24}
                          height={24}
                          className="rounded-full"
                        />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-accent text-xs font-bold">
                          {user.email.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <p className="text-white text-xs font-medium">{user.name || '—'}</p>
                        <p className="text-gray-500 text-xs">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td>{roleBadge(user.role)}</td>
                  <td>
                    {user.is_active
                      ? <span className="badge badge-green">Active</span>
                      : <span className="badge badge-gray">Inactive</span>}
                  </td>
                  <td className="text-gray-400">
                    {user.last_login_at
                      ? new Date(user.last_login_at).toLocaleDateString()
                      : '—'}
                  </td>
                  <td className="text-gray-400">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td>
                    {user.id !== me?.id ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={user.role}
                          disabled={updating === user.id}
                          onChange={(e) => handleRoleChange(user.id, e.target.value as UserRole)}
                          className="input text-xs py-1 w-24"
                        >
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <button
                          onClick={() => handleToggleActive(user.id, !user.is_active)}
                          disabled={updating === user.id}
                          className={`text-xs px-2 py-1 rounded transition-colors ${
                            user.is_active
                              ? 'text-gray-500 hover:text-danger border border-transparent hover:border-danger/30'
                              : 'text-accent border border-accent/30 hover:bg-accent/10'
                          }`}
                        >
                          {updating === user.id ? '...' : user.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-600">You</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 p-4 rounded-md bg-surface border border-border text-xs text-gray-500">
        <strong className="text-gray-400">Note:</strong> Users are added automatically when they sign in with Google for the first time.
        New users get the <span className="text-white font-medium">viewer</span> role by default.
        The first user ever to sign in gets <span className="text-red-400 font-medium">admin</span>.
      </div>
    </div>
  )
}
