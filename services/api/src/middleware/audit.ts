import { FastifyInstance, FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify'
import { query } from '../plugins/postgres'

export function registerAuditHook(fastify: FastifyInstance): void {
  fastify.addHook(
    'onResponse',
    async (req: FastifyRequest, reply: FastifyReply) => {
      // Only audit REST API and SQL editor calls
      const path = req.url.split('?')[0]
      if (!path.startsWith('/api/rest/') && path !== '/api/sql') return

      const userId = req.user?.sub ?? null

      // Extract table name from path: /api/rest/employees → employees
      let tableName: string | null = null
      const match = path.match(/^\/api\/rest\/([^/]+)/)
      if (match) tableName = match[1]

      const durationMs = Math.round(reply.elapsedTime ?? 0)

      // Fire and forget — don't block response
      query(
        `INSERT INTO intrabase_system.audit_logs
         (user_id, method, path, table_name, ip_address, status_code, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          userId,
          req.method,
          path,
          tableName,
          req.ip,
          reply.statusCode,
          durationMs,
        ]
      ).catch((err) => console.error('Audit log write failed:', err))
    }
  )
}
