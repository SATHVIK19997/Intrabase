import type { AuthUser, TableInfo, Row, QueryResult, IntraUser, ApiKey, CreatedApiKey, AuditLog, Project, ProjectDetail } from './types'

const API_BASE =
  typeof window === 'undefined'
    ? process.env.API_URL ?? 'http://api:3001'     // server-side (container)
    : '/api'                                        // client-side (via nginx proxy)

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })

  if (res.status === 401) {
    // Try to refresh token once
    const refreshed = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    if (refreshed.ok) {
      // Retry original request
      const retry = await fetch(`${API_BASE}${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options?.headers },
        ...options,
      })
      if (retry.ok) return retry.json() as Promise<T>
    }
    // Redirect to login
    if (typeof window !== 'undefined') {
      window.location.href = '/login'
    }
    throw new Error('Unauthenticated')
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }

  // Handle 204 No Content
  if (res.status === 204) return undefined as T

  return res.json() as Promise<T>
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const auth = {
  me: () => apiFetch<AuthUser>('/auth/me'),
  logout: () => apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  googleSignInUrl: () => `${API_BASE}/auth/google`,
}

// ─── Tables ───────────────────────────────────────────────────────────────────

export const tables = {
  list: () => apiFetch<TableInfo[]>('/tables'),
  get: (name: string) => apiFetch<TableInfo>(`/tables/${name}`),
}

// ─── REST — rows ──────────────────────────────────────────────────────────────

export const rest = {
  select: (table: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString()
    return apiFetch<Row[]>(`/rest/${table}${qs ? `?${qs}` : ''}`)
  },

  insert: (table: string, row: Record<string, unknown>) =>
    apiFetch<Row>(`/rest/${table}`, { method: 'POST', body: JSON.stringify(row) }),

  update: (table: string, filters: Record<string, string>, data: Record<string, unknown>) => {
    const qs = new URLSearchParams(filters).toString()
    return apiFetch<Row[]>(`/rest/${table}?${qs}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  },

  delete: (table: string, filters: Record<string, string>) => {
    const qs = new URLSearchParams(filters).toString()
    return apiFetch<Row[]>(`/rest/${table}?${qs}`, { method: 'DELETE' })
  },
}

// ─── SQL Editor ───────────────────────────────────────────────────────────────

export const sql = {
  run: (query: string) =>
    apiFetch<QueryResult>('/sql', { method: 'POST', body: JSON.stringify({ query }) }),
}

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = {
  list: () => apiFetch<IntraUser[]>('/users'),
  update: (id: string, data: { role?: string; is_active?: boolean }) =>
    apiFetch<IntraUser>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

export const apiKeys = {
  list: () => apiFetch<ApiKey[]>('/keys'),
  create: (name: string, expires_at?: string) =>
    apiFetch<CreatedApiKey>('/keys', {
      method: 'POST',
      body: JSON.stringify({ name, expires_at }),
    }),
  delete: (id: string) =>
    apiFetch<{ ok: boolean }>(`/keys/${id}`, { method: 'DELETE' }),
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export const projects = {
  list: () => apiFetch<Project[]>('/projects'),
  get: (id: string) => apiFetch<ProjectDetail>(`/projects/${id}`),
  create: (data: { name: string; description?: string; color?: string }) =>
    apiFetch<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; description?: string; color?: string }) =>
    apiFetch<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) =>
    apiFetch<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
  tables: (id: string) => apiFetch<{ name: string; column_count: number }[]>(`/projects/${id}/tables`),

  // Project-scoped REST
  restExport: async (projectId: string, table: string): Promise<string> => {
    const res = await fetch(`${API_BASE}/projects/${projectId}/rest/${table}/export`, {
      credentials: 'include',
    })
    if (res.status === 401) {
      const refreshed = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
      if (refreshed.ok) {
        const retry = await fetch(`${API_BASE}/projects/${projectId}/rest/${table}/export`, { credentials: 'include' })
        if (retry.ok) return retry.text()
      }
      if (typeof window !== 'undefined') window.location.href = '/login'
      throw new Error('Unauthenticated')
    }
    if (!res.ok) throw new Error(`Export failed: ${res.statusText}`)
    return res.text()
  },
  restImport: (projectId: string, table: string, csv: string) =>
    apiFetch<{ inserted: number; total: number; errors: string[] }>(
      `/projects/${projectId}/rest/${table}/import`,
      { method: 'POST', body: JSON.stringify({ csv }) }
    ),

  restSelect: (projectId: string, table: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString()
    return apiFetch<Row[]>(`/projects/${projectId}/rest/${table}${qs ? `?${qs}` : ''}`)
  },
  restInsert: (projectId: string, table: string, row: Record<string, unknown>) =>
    apiFetch<Row>(`/projects/${projectId}/rest/${table}`, { method: 'POST', body: JSON.stringify(row) }),
  restUpdate: (projectId: string, table: string, filters: Record<string, string>, data: Record<string, unknown>) => {
    const qs = new URLSearchParams(filters).toString()
    return apiFetch<Row[]>(`/projects/${projectId}/rest/${table}?${qs}`, { method: 'PATCH', body: JSON.stringify(data) })
  },
  restDelete: (projectId: string, table: string, filters: Record<string, string>) => {
    const qs = new URLSearchParams(filters).toString()
    return apiFetch<Row[]>(`/projects/${projectId}/rest/${table}?${qs}`, { method: 'DELETE' })
  },
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export const auditLogs = {
  list: (params: { limit?: number; offset?: number; table?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
    ).toString()
    return apiFetch<AuditLog[]>(`/audit-logs${qs ? `?${qs}` : ''}`)
  },
}
