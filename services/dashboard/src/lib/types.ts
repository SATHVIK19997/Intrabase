// ─── Auth ────────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'editor' | 'viewer'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: UserRole
}

// ─── Schema / Tables ─────────────────────────────────────────────────────────

export interface ColumnInfo {
  name: string
  dataType: string
  isNullable: boolean
  columnDefault: string | null
  isPrimaryKey: boolean
}

export interface TableInfo {
  name: string
  schema: string
  columns: ColumnInfo[]
}

// ─── REST API ─────────────────────────────────────────────────────────────────

export type Row = Record<string, unknown>

export interface QueryResult {
  rows: Row[]
  rowCount: number
  duration_ms: number
}

// ─── Users ───────────────────────────────────────────────────────────────────

export interface IntraUser {
  id: string
  email: string
  name: string
  avatar_url: string | null
  role: UserRole
  is_active: boolean
  last_login_at: string | null
  created_at: string
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

export interface ApiKey {
  id: string
  name: string
  key_prefix: string
  owner_email?: string
  expires_at: string | null
  last_used_at: string | null
  created_at: string
}

export interface CreatedApiKey extends ApiKey {
  key: string // shown once only
  message: string
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export interface AuditLog {
  id: string
  user_email: string | null
  method: string
  path: string
  table_name: string | null
  ip_address: string
  status_code: number
  duration_ms: number
  created_at: string
}

// ─── Projects ────────────────────────────────────────────────────────────────

export interface Project {
  id: string
  name: string
  slug: string
  description: string | null
  color: string
  created_by: string | null
  created_by_email: string | null
  created_at: string
  updated_at: string
  table_count: number
}

export interface ProjectDetail extends Project {
  tables: ProjectTable[]
}

export interface ProjectTable {
  name: string
  column_count: number
  pk_count: number
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

export interface Toast {
  id: string
  type: 'success' | 'error' | 'info'
  message: string
}
