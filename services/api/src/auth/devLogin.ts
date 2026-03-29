/**
 * DEV-ONLY login bypass — skips Google OAuth entirely.
 * Only registered when NODE_ENV=development.
 * Never exists in production builds.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { env } from '../config/env'
import { query, queryOne } from '../plugins/postgres'
import { signAccessToken, createRefreshToken } from './jwt'

export async function registerDevLogin(fastify: FastifyInstance): Promise<void> {
  if (env.NODE_ENV !== 'development') return

  fastify.post<{ Body: { email: string; name?: string } }>(
    '/api/auth/dev-login',
    async (req, reply) => {
      const { email, name } = req.body

      if (!email?.includes('@')) {
        return reply.status(400).send({ error: 'Valid email required' })
      }

      // Count existing users — first one gets admin
      const count = await queryOne<{ count: string }>(
        'SELECT COUNT(*)::text as count FROM intrabase_system.users'
      )
      const isFirstUser = count?.count === '0'

      const user = await queryOne<{
        id: string; email: string; name: string; role: 'admin' | 'editor' | 'viewer'
      }>(
        `INSERT INTO intrabase_system.users (email, name, avatar_url, role, last_login_at)
         VALUES ($1, $2, NULL, $3, now())
         ON CONFLICT (email) DO UPDATE SET
           name = COALESCE(EXCLUDED.name, intrabase_system.users.name),
           last_login_at = now()
         RETURNING id, email, name, role`,
        [email, name ?? email.split('@')[0], isFirstUser ? 'admin' : 'viewer']
      )

      if (!user) return reply.status(500).send({ error: 'Failed to create dev user' })

      const accessToken = signAccessToken({
        sub: user.id, email: user.email, name: user.name, role: user.role,
      })
      const refreshToken = await createRefreshToken(user.id, req.ip)

      reply
        .setCookie('ib_access_token', accessToken, {
          httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 8 * 3600,
        })
        .setCookie('ib_refresh_token', refreshToken, {
          httpOnly: true, secure: false, sameSite: 'lax', path: '/api/auth/refresh', maxAge: 7 * 86400,
        })

      return reply.send({ ok: true, role: user.role, email: user.email })
    }
  )

  fastify.log.warn('⚠️  DEV LOGIN enabled — /api/auth/dev-login is active (development only)')
}
