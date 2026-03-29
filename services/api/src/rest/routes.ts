import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { requireAuth, requireEditor } from '../middleware/auth'
import { query } from '../plugins/postgres'
import {
  listTables,
  getTableInfo,
  invalidateSchemaCache,
} from './introspect'
import {
  parseQueryParams,
  buildSelectQuery,
  buildInsertQuery,
  buildUpdateQuery,
  buildDeleteQuery,
} from './queryBuilder'

type QueryString = Record<string, string>

export async function registerRestRoutes(fastify: FastifyInstance): Promise<void> {

  // ------------------------------------------------------------------
  // GET /api/tables — list all tables with column metadata
  // ------------------------------------------------------------------
  fastify.get(
    '/api/tables',
    { preHandler: [requireAuth] },
    async (_req, reply) => {
      const tables = await listTables()
      return reply.send(tables)
    }
  )

  // ------------------------------------------------------------------
  // GET /api/tables/:table — single table schema
  // ------------------------------------------------------------------
  fastify.get<{ Params: { table: string } }>(
    '/api/tables/:table',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const tableInfo = await getTableInfo(req.params.table)
      if (!tableInfo) return reply.status(404).send({ error: 'Table not found' })
      return reply.send(tableInfo)
    }
  )

  // ------------------------------------------------------------------
  // GET /api/rest/:table — SELECT rows
  // Supports: ?select=col1,col2 ?col=op.val ?order=col.dir ?limit=N ?offset=N
  // ------------------------------------------------------------------
  fastify.get<{ Params: { table: string }; Querystring: QueryString }>(
    '/api/rest/:table',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const { table } = req.params
      const tableInfo = await getTableInfo(table)
      if (!tableInfo) return reply.status(404).send({ error: `Table "${table}" not found` })

      const parsed = parseQueryParams(req.query as Record<string, string>, tableInfo.columns)
      const { sql, params } = buildSelectQuery(`"${table}"`, parsed, tableInfo.columns)

      const rows = await query(sql, params)

      // Return count header like Supabase
      reply.header('Content-Range', `0-${rows.length - 1}/*`)
      return reply.send(rows)
    }
  )

  // ------------------------------------------------------------------
  // POST /api/rest/:table — INSERT a row
  // ------------------------------------------------------------------
  fastify.post<{
    Params: { table: string }
    Body: Record<string, unknown>
  }>(
    '/api/rest/:table',
    { preHandler: [requireAuth, requireEditor] },
    async (req, reply) => {
      const { table } = req.params
      const tableInfo = await getTableInfo(table)
      if (!tableInfo) return reply.status(404).send({ error: `Table "${table}" not found` })

      const { sql, params } = buildInsertQuery(`"${table}"`, req.body, tableInfo.columns)
      const rows = await query(sql, params)
      return reply.status(201).send(rows[0] ?? {})
    }
  )

  // ------------------------------------------------------------------
  // PATCH /api/rest/:table — UPDATE rows matching filters
  // ------------------------------------------------------------------
  fastify.patch<{
    Params: { table: string }
    Querystring: QueryString
    Body: Record<string, unknown>
  }>(
    '/api/rest/:table',
    { preHandler: [requireAuth, requireEditor] },
    async (req, reply) => {
      const { table } = req.params
      const tableInfo = await getTableInfo(table)
      if (!tableInfo) return reply.status(404).send({ error: `Table "${table}" not found` })

      const parsed = parseQueryParams(req.query as Record<string, string>, tableInfo.columns)

      if (parsed.filters.length === 0) {
        return reply.status(400).send({ error: 'PATCH without filters would update all rows — add at least one filter' })
      }

      const { sql, params } = buildUpdateQuery(`"${table}"`, req.body, parsed, tableInfo.columns)
      const rows = await query(sql, params)
      return reply.send(rows)
    }
  )

  // ------------------------------------------------------------------
  // DELETE /api/rest/:table — DELETE rows matching filters
  // ------------------------------------------------------------------
  fastify.delete<{
    Params: { table: string }
    Querystring: QueryString
  }>(
    '/api/rest/:table',
    { preHandler: [requireAuth, requireEditor] },
    async (req, reply) => {
      const { table } = req.params
      const tableInfo = await getTableInfo(table)
      if (!tableInfo) return reply.status(404).send({ error: `Table "${table}" not found` })

      const parsed = parseQueryParams(req.query as Record<string, string>, tableInfo.columns)

      const { sql, params } = buildDeleteQuery(`"${table}"`, parsed)
      const rows = await query(sql, params)
      return reply.send(rows)
    }
  )

  // ------------------------------------------------------------------
  // POST /api/sql — Raw SQL query (admin/editor only)
  // ------------------------------------------------------------------
  fastify.post<{
    Body: { query: string }
  }>(
    '/api/sql',
    { preHandler: [requireAuth, requireEditor] },
    async (req, reply) => {
      const { query: rawSql } = req.body

      if (!rawSql?.trim()) {
        return reply.status(400).send({ error: 'query is required' })
      }

      // Block destructive statements for non-admins
      const user = req.user
      if (user.role !== 'admin') {
        const upper = rawSql.trim().toUpperCase()
        const blocked = ['DROP ', 'TRUNCATE ', 'ALTER ', 'CREATE ', 'GRANT ', 'REVOKE ']
        if (blocked.some((b) => upper.startsWith(b))) {
          return reply.status(403).send({
            error: 'Only admins can run DDL statements (DROP, TRUNCATE, ALTER, CREATE)',
          })
        }
      }

      const start = Date.now()
      const rows = await query(rawSql)
      const duration = Date.now() - start

      // Invalidate schema cache if DDL was likely run
      const upper = rawSql.trim().toUpperCase()
      if (['CREATE ', 'DROP ', 'ALTER '].some((d) => upper.startsWith(d))) {
        invalidateSchemaCache()
      }

      return reply.send({ rows, rowCount: rows.length, duration_ms: duration })
    }
  )

  // ------------------------------------------------------------------
  // GET /api/users — list all users (admin only)
  // ------------------------------------------------------------------
  fastify.get(
    '/api/users',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (req.user.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin only' })
      }
      const users = await query(
        `SELECT id, email, name, avatar_url, role, is_active, last_login_at, created_at
         FROM intrabase_system.users ORDER BY created_at DESC`
      )
      return reply.send(users)
    }
  )

  // ------------------------------------------------------------------
  // PATCH /api/users/:id — update user role or active status (admin only)
  // ------------------------------------------------------------------
  fastify.patch<{
    Params: { id: string }
    Body: { role?: string; is_active?: boolean }
  }>(
    '/api/users/:id',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (req.user.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin only' })
      }

      const { id } = req.params
      const { role, is_active } = req.body

      // Prevent admin from demoting themselves
      if (id === req.user.sub && role && role !== 'admin') {
        return reply.status(400).send({ error: 'Cannot change your own admin role' })
      }

      const updates: string[] = []
      const params: unknown[] = []
      let i = 1

      if (role && ['admin', 'editor', 'viewer'].includes(role)) {
        updates.push(`role = $${i++}`)
        params.push(role)
      }
      if (typeof is_active === 'boolean') {
        updates.push(`is_active = $${i++}`)
        params.push(is_active)
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'Nothing to update' })
      }

      params.push(id)
      const rows = await query(
        `UPDATE intrabase_system.users SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, email, role, is_active`,
        params
      )

      if (rows.length === 0) return reply.status(404).send({ error: 'User not found' })
      return reply.send(rows[0])
    }
  )

  // ------------------------------------------------------------------
  // GET /api/audit-logs — audit log viewer (admin only)
  // ------------------------------------------------------------------
  fastify.get<{ Querystring: { limit?: string; offset?: string; table?: string } }>(
    '/api/audit-logs',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (req.user.role !== 'admin') {
        return reply.status(403).send({ error: 'Admin only' })
      }

      const limit = Math.min(parseInt(req.query.limit ?? '50'), 500)
      const offset = parseInt(req.query.offset ?? '0')
      const tableFilter = req.query.table

      const rows = await query(
        `SELECT l.id, u.email as user_email, l.method, l.path, l.table_name,
                l.ip_address, l.status_code, l.duration_ms, l.created_at
         FROM intrabase_system.audit_logs l
         LEFT JOIN intrabase_system.users u ON l.user_id = u.id
         ${tableFilter ? 'WHERE l.table_name = $3' : ''}
         ORDER BY l.created_at DESC
         LIMIT $1 OFFSET $2`,
        tableFilter ? [limit, offset, tableFilter] : [limit, offset]
      )

      return reply.send(rows)
    }
  )
}
