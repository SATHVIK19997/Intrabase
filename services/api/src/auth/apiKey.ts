import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { query, queryOne } from '../plugins/postgres'
import { requireAuth, requireRole } from '../middleware/auth'

const BCRYPT_ROUNDS = 10

export function generateApiKey(): { key: string; prefix: string } {
  const key = crypto.randomBytes(32).toString('hex') // 64 char hex
  const prefix = key.substring(0, 8)
  return { key, prefix }
}

export async function hashApiKey(key: string): Promise<string> {
  return bcrypt.hash(key, BCRYPT_ROUNDS)
}

export async function verifyApiKey(
  key: string
): Promise<{ userId: string; role: string; email: string; name: string } | null> {
  const prefix = key.substring(0, 8)

  // Find all keys with matching prefix (usually just one)
  const candidates = await query<{
    id: string
    key_hash: string
    expires_at: string | null
    user_id: string
    email: string
    name: string
    role: string
    is_active: boolean
  }>(
    `SELECT k.id, k.key_hash, k.expires_at, u.id as user_id, u.email, u.name, u.role, u.is_active
     FROM intrabase_system.api_keys k
     JOIN intrabase_system.users u ON k.user_id = u.id
     WHERE k.key_prefix = $1`,
    [prefix]
  )

  for (const candidate of candidates) {
    if (!candidate.is_active) continue
    if (candidate.expires_at && new Date(candidate.expires_at) < new Date()) continue

    const valid = await bcrypt.compare(key, candidate.key_hash)
    if (valid) {
      // Update last_used_at
      await query(
        `UPDATE intrabase_system.api_keys SET last_used_at = now() WHERE id = $1`,
        [candidate.id]
      )
      return {
        userId: candidate.user_id,
        email: candidate.email,
        name: candidate.name,
        role: candidate.role,
      }
    }
  }

  return null
}

export async function registerApiKeyRoutes(fastify: FastifyInstance): Promise<void> {

  // List API keys for the current user
  fastify.get(
    '/api/keys',
    { preHandler: [requireAuth] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = (req as FastifyRequest & { user: { sub: string; role: string } }).user
      const isAdmin = user.role === 'admin'

      const keys = await query(
        isAdmin
          ? `SELECT k.id, k.name, k.key_prefix, k.expires_at, k.last_used_at, k.created_at,
                    u.email as owner_email
             FROM intrabase_system.api_keys k
             JOIN intrabase_system.users u ON k.user_id = u.id
             ORDER BY k.created_at DESC`
          : `SELECT id, name, key_prefix, expires_at, last_used_at, created_at
             FROM intrabase_system.api_keys
             WHERE user_id = $1
             ORDER BY created_at DESC`,
        isAdmin ? [] : [user.sub]
      )

      return reply.send(keys)
    }
  )

  // Create a new API key
  fastify.post<{
    Body: { name: string; expires_at?: string }
  }>(
    '/api/keys',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = (req as FastifyRequest & { user: { sub: string } }).user
      const { name, expires_at } = req.body

      if (!name?.trim()) {
        return reply.status(400).send({ error: 'name is required' })
      }

      const { key, prefix } = generateApiKey()
      const keyHash = await hashApiKey(key)

      const created = await queryOne<{ id: string; created_at: string }>(
        `INSERT INTO intrabase_system.api_keys (user_id, name, key_prefix, key_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at`,
        [user.sub, name.trim(), prefix, keyHash, expires_at ?? null]
      )

      // Return the full key ONCE — never stored in plaintext
      return reply.status(201).send({
        id: created!.id,
        name,
        key_prefix: prefix,
        key, // shown only once
        created_at: created!.created_at,
        message: 'Save this key now — it will not be shown again.',
      })
    }
  )

  // Delete an API key
  fastify.delete<{ Params: { id: string } }>(
    '/api/keys/:id',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = (req as FastifyRequest & { user: { sub: string; role: string } }).user
      const { id } = req.params

      const deleted = await query(
        user.role === 'admin'
          ? `DELETE FROM intrabase_system.api_keys WHERE id = $1 RETURNING id`
          : `DELETE FROM intrabase_system.api_keys WHERE id = $1 AND user_id = $2 RETURNING id`,
        user.role === 'admin' ? [id] : [id, user.sub]
      )

      if (deleted.length === 0) {
        return reply.status(404).send({ error: 'API key not found' })
      }

      return reply.send({ ok: true })
    }
  )
}
