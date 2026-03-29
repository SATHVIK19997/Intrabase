import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { requireAuth, requireEditor } from '../middleware/auth'
import { query, queryOne, withTransaction } from '../plugins/postgres'
import { invalidateSchemaCache } from './introspect'

interface Project {
  id: string
  name: string
  slug: string
  description: string | null
  color: string
  created_by: string | null
  created_at: string
  updated_at: string
  table_count?: number
}

// "My HR System" → "my_hr_system"
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'p_$1')   // schema can't start with a digit
    .slice(0, 50)
}

// Ensure slug is unique — appends _2, _3 if needed
async function uniqueSlug(base: string): Promise<string> {
  let slug = base
  let i = 2
  while (true) {
    const exists = await queryOne(
      `SELECT id FROM intrabase_system.projects WHERE slug = $1`, [slug]
    )
    if (!exists) return slug
    slug = `${base}_${i++}`
  }
}

export async function registerProjectRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /api/projects — list all projects with table count
  fastify.get(
    '/api/projects',
    { preHandler: [requireAuth] },
    async (_req, reply) => {
      const rows = await query<Project>(`
        SELECT
          p.*,
          u.email as created_by_email,
          (
            SELECT COUNT(*)::int
            FROM information_schema.tables t
            WHERE t.table_schema = p.slug
              AND t.table_type = 'BASE TABLE'
          ) as table_count
        FROM intrabase_system.projects p
        LEFT JOIN intrabase_system.users u ON p.created_by = u.id
        ORDER BY p.created_at DESC
      `)
      return reply.send(rows)
    }
  )

  // GET /api/projects/:id — single project + its tables
  fastify.get<{ Params: { id: string } }>(
    '/api/projects/:id',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const project = await queryOne<Project>(
        `SELECT p.*, u.email as created_by_email
         FROM intrabase_system.projects p
         LEFT JOIN intrabase_system.users u ON p.created_by = u.id
         WHERE p.id = $1`,
        [req.params.id]
      )
      if (!project) return reply.status(404).send({ error: 'Project not found' })

      // Get tables in this project's schema
      const tables = await query(`
        SELECT
          c.table_name as name,
          COUNT(col.column_name)::int as column_count,
          (
            SELECT COUNT(col2.column_name)::int
            FROM information_schema.columns col2
            WHERE col2.table_schema = c.table_schema
              AND col2.table_name = c.table_name
              AND col2.column_name IN (
                SELECT kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                WHERE tc.constraint_type = 'PRIMARY KEY'
                  AND tc.table_schema = c.table_schema
                  AND tc.table_name = c.table_name
              )
          ) as pk_count
        FROM information_schema.tables c
        JOIN information_schema.columns col
          ON col.table_schema = c.table_schema AND col.table_name = c.table_name
        WHERE c.table_schema = $1
          AND c.table_type = 'BASE TABLE'
        GROUP BY c.table_schema, c.table_name
        ORDER BY c.table_name
      `, [project.slug])

      return reply.send({ ...project, tables })
    }
  )

  // POST /api/projects — create a new project + PostgreSQL schema
  fastify.post<{
    Body: { name: string; description?: string; color?: string }
  }>(
    '/api/projects',
    { preHandler: [requireAuth, requireEditor] },
    async (req, reply) => {
      const { name, description, color } = req.body
      const userId = req.user.sub

      if (!name?.trim()) {
        return reply.status(400).send({ error: 'Project name is required' })
      }

      const baseSlug = toSlug(name.trim())
      if (!baseSlug) {
        return reply.status(400).send({ error: 'Project name must contain at least one letter or number' })
      }

      const slug = await uniqueSlug(baseSlug)

      const project = await withTransaction(async (client) => {
        // Create the PostgreSQL schema for this project
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${slug}"`)

        // Insert project record
        const result = await client.query(
          `INSERT INTO intrabase_system.projects (name, slug, description, color, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [name.trim(), slug, description ?? null, color ?? '#3ecf8e', userId]
        )
        return result.rows[0] as Project
      })

      invalidateSchemaCache()
      return reply.status(201).send(project)
    }
  )

  // PATCH /api/projects/:id — rename / update description or color
  fastify.patch<{
    Params: { id: string }
    Body: { name?: string; description?: string; color?: string }
  }>(
    '/api/projects/:id',
    { preHandler: [requireAuth, requireEditor] },
    async (req, reply) => {
      const { name, description, color } = req.body
      const updates: string[] = []
      const params: unknown[] = []
      let i = 1

      if (name?.trim())              { updates.push(`name = $${i++}`);        params.push(name.trim()) }
      if (description !== undefined) { updates.push(`description = $${i++}`); params.push(description) }
      if (color)                     { updates.push(`color = $${i++}`);       params.push(color) }

      if (updates.length === 0) return reply.status(400).send({ error: 'Nothing to update' })

      updates.push(`updated_at = now()`)
      params.push(req.params.id)

      const row = await queryOne(
        `UPDATE intrabase_system.projects SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
        params
      )
      if (!row) return reply.status(404).send({ error: 'Project not found' })
      return reply.send(row)
    }
  )

  // DELETE /api/projects/:id — drop schema + all its tables
  fastify.delete<{ Params: { id: string } }>(
    '/api/projects/:id',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (req.user.role !== 'admin') {
        return reply.status(403).send({ error: 'Only admins can delete projects' })
      }

      const project = await queryOne<Project>(
        `SELECT * FROM intrabase_system.projects WHERE id = $1`, [req.params.id]
      )
      if (!project) return reply.status(404).send({ error: 'Project not found' })

      await withTransaction(async (client) => {
        await client.query(`DROP SCHEMA IF EXISTS "${project.slug}" CASCADE`)
        await client.query(`DELETE FROM intrabase_system.projects WHERE id = $1`, [project.id])
      })

      invalidateSchemaCache()
      return reply.send({ ok: true, deleted: project.name })
    }
  )

  // ── Project-scoped REST API ────────────────────────────────────────────────
  // GET  /api/projects/:id/rest/:table
  // POST /api/projects/:id/rest/:table
  // PATCH /api/projects/:id/rest/:table
  // DELETE /api/projects/:id/rest/:table

  const { parseQueryParams, buildSelectQuery, buildInsertQuery, buildUpdateQuery, buildDeleteQuery } =
    await import('./queryBuilder')

  async function getProjectSchema(projectId: string): Promise<string | null> {
    const p = await queryOne<{ slug: string }>(
      `SELECT slug FROM intrabase_system.projects WHERE id = $1`, [projectId]
    )
    return p?.slug ?? null
  }

  async function getProjectColumns(schema: string, table: string) {
    const rows = await query<{
      column_name: string; data_type: string; is_nullable: string
      column_default: string | null; is_pk: boolean
    }>(`
      SELECT
        c.column_name, c.data_type, c.is_nullable, c.column_default,
        COALESCE(pk.is_pk, false) as is_pk
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT kcu.column_name, true as is_pk
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = $1 AND tc.table_name = $2
      ) pk ON c.column_name = pk.column_name
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position
    `, [schema, table])

    return rows.map(r => ({
      name: r.column_name,
      dataType: r.data_type,
      isNullable: r.is_nullable === 'YES',
      columnDefault: r.column_default,
      isPrimaryKey: r.is_pk,
    }))
  }

  type QS = Record<string, string>

  fastify.get<{ Params: { id: string; table: string }; Querystring: QS }>(
    '/api/projects/:id/rest/:table',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const schema = await getProjectSchema(req.params.id)
      if (!schema) return reply.status(404).send({ error: 'Project not found' })

      const columns = await getProjectColumns(schema, req.params.table)
      if (!columns.length) return reply.status(404).send({ error: `Table "${req.params.table}" not found in this project` })

      const parsed = parseQueryParams(req.query as QS, columns)
      const { sql, params } = buildSelectQuery(`"${schema}"."${req.params.table}"`, parsed, columns)
      const rows = await query(sql, params)
      reply.header('Content-Range', `0-${rows.length - 1}/*`)
      return reply.send(rows)
    }
  )

  fastify.post<{ Params: { id: string; table: string }; Body: Record<string, unknown> }>(
    '/api/projects/:id/rest/:table',
    { preHandler: [requireAuth, requireEditor] },
    async (req, reply) => {
      const schema = await getProjectSchema(req.params.id)
      if (!schema) return reply.status(404).send({ error: 'Project not found' })
      const columns = await getProjectColumns(schema, req.params.table)
      if (!columns.length) return reply.status(404).send({ error: `Table "${req.params.table}" not found` })
      const { sql, params } = buildInsertQuery(`"${schema}"."${req.params.table}"`, req.body, columns)
      const rows = await query(sql, params)
      return reply.status(201).send(rows[0] ?? {})
    }
  )

  fastify.patch<{ Params: { id: string; table: string }; Querystring: QS; Body: Record<string, unknown> }>(
    '/api/projects/:id/rest/:table',
    { preHandler: [requireAuth, requireEditor] },
    async (req, reply) => {
      const schema = await getProjectSchema(req.params.id)
      if (!schema) return reply.status(404).send({ error: 'Project not found' })
      const columns = await getProjectColumns(schema, req.params.table)
      if (!columns.length) return reply.status(404).send({ error: `Table "${req.params.table}" not found` })
      const parsed = parseQueryParams(req.query as QS, columns)
      if (!parsed.filters.length) return reply.status(400).send({ error: 'PATCH without filters not allowed' })
      const { sql, params } = buildUpdateQuery(`"${schema}"."${req.params.table}"`, req.body, parsed, columns)
      return reply.send(await query(sql, params))
    }
  )

  fastify.delete<{ Params: { id: string; table: string }; Querystring: QS }>(
    '/api/projects/:id/rest/:table',
    { preHandler: [requireAuth, requireEditor] },
    async (req, reply) => {
      const schema = await getProjectSchema(req.params.id)
      if (!schema) return reply.status(404).send({ error: 'Project not found' })
      const columns = await getProjectColumns(schema, req.params.table)
      if (!columns.length) return reply.status(404).send({ error: `Table "${req.params.table}" not found` })
      const parsed = parseQueryParams(req.query as QS, columns)
      const { sql, params } = buildDeleteQuery(`"${schema}"."${req.params.table}"`, parsed)
      return reply.send(await query(sql, params))
    }
  )

  // GET /api/projects/:id/tables — table list for a project
  fastify.get<{ Params: { id: string } }>(
    '/api/projects/:id/tables',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const schema = await getProjectSchema(req.params.id)
      if (!schema) return reply.status(404).send({ error: 'Project not found' })

      const tables = await query(`
        SELECT
          c.table_name as name,
          COUNT(col.column_name)::int as column_count
        FROM information_schema.tables c
        JOIN information_schema.columns col
          ON col.table_schema = c.table_schema AND col.table_name = c.table_name
        WHERE c.table_schema = $1 AND c.table_type = 'BASE TABLE'
        GROUP BY c.table_name ORDER BY c.table_name
      `, [schema])

      return reply.send(tables)
    }
  )
}
