import { OAuth2Client } from 'google-auth-library'
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { env } from '../config/env'
import { query, queryOne } from '../plugins/postgres'
import { signAccessToken, createRefreshToken } from './jwt'

const oauth2Client = new OAuth2Client(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_CALLBACK_URL
)

const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

interface GoogleUser {
  id: string
  email: string
  name: string
  picture: string
  verified_email: boolean
}

interface DbUser {
  id: string
  email: string
  name: string
  avatar_url: string
  role: 'admin' | 'editor' | 'viewer'
}

// Returns the Google OAuth redirect URL (built manually to avoid app_domain param)
export function getAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_CALLBACK_URL,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'select_account',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

// Exchange auth code for user profile
async function getGoogleUser(code: string): Promise<GoogleUser> {
  const { tokens } = await oauth2Client.getToken(code)
  oauth2Client.setCredentials(tokens)

  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })

  if (!res.ok) {
    throw new Error('Failed to fetch Google user profile')
  }

  return res.json() as Promise<GoogleUser>
}

// Upsert user in DB — first user ever becomes admin automatically
async function upsertUser(googleUser: GoogleUser): Promise<DbUser> {
  // Check if this is the very first user (auto-admin)
  const count = await queryOne<{ count: string }>(
    'SELECT COUNT(*)::text as count FROM intrabase_system.users'
  )
  const isFirstUser = count?.count === '0'

  const role = isFirstUser ? 'admin' : 'viewer'

  const user = await queryOne<DbUser>(
    `INSERT INTO intrabase_system.users (email, name, avatar_url, role, last_login_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       avatar_url = EXCLUDED.avatar_url,
       last_login_at = now()
     RETURNING id, email, name, avatar_url, role`,
    [googleUser.email, googleUser.name, googleUser.picture, role]
  )

  if (!user) throw new Error('Failed to upsert user')
  return user
}

// Register Google OAuth routes on the Fastify instance
export async function registerGoogleAuth(fastify: FastifyInstance): Promise<void> {

  // Step 1: Redirect user to Google sign-in
  fastify.get('/api/auth/google', async (_req: FastifyRequest, reply: FastifyReply) => {
    const url = getAuthUrl()
    return reply.redirect(url)
  })

  // Step 2: Google redirects back here with ?code=...
  fastify.get<{ Querystring: { code?: string; error?: string } }>(
    '/api/auth/google/callback',
    async (req, reply) => {
      const { code, error } = req.query

      if (error || !code) {
        return reply.redirect(`${env.DASHBOARD_URL}/login?error=access_denied`)
      }

      try {
        // Exchange code for Google user profile
        const googleUser = await getGoogleUser(code)

        // Enforce domain restriction
        const emailDomain = googleUser.email.split('@')[1]
        if (emailDomain !== env.ALLOWED_EMAIL_DOMAIN) {
          return reply.redirect(
            `${env.DASHBOARD_URL}/login?error=unauthorized_domain`
          )
        }

        if (!googleUser.verified_email) {
          return reply.redirect(`${env.DASHBOARD_URL}/login?error=unverified_email`)
        }

        // Upsert user into our DB
        const user = await upsertUser(googleUser)

        // Issue tokens
        const accessToken = signAccessToken({
          sub: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        })

        const refreshToken = await createRefreshToken(
          user.id,
          req.ip,
          req.headers['user-agent']
        )

        // Set httpOnly cookies
        reply
          .setCookie('ib_access_token', accessToken, {
            httpOnly: true,
            secure: env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 8 * 60 * 60, // 8 hours
          })
          .setCookie('ib_refresh_token', refreshToken, {
            httpOnly: true,
            secure: env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/api/auth/refresh',
            maxAge: 7 * 24 * 60 * 60, // 7 days
          })

        return reply.redirect(`${env.DASHBOARD_URL}/dashboard`)
      } catch (err) {
        console.error('Google OAuth callback error:', err)
        return reply.redirect(`${env.DASHBOARD_URL}/login?error=server_error`)
      }
    }
  )

  // Refresh access token using refresh token cookie
  fastify.post('/api/auth/refresh', async (req: FastifyRequest, reply: FastifyReply) => {
    const { rotateRefreshToken } = await import('./jwt')
    const oldRefreshToken = (req.cookies as Record<string, string>)['ib_refresh_token']

    if (!oldRefreshToken) {
      return reply.status(401).send({ error: 'No refresh token' })
    }

    const tokens = await rotateRefreshToken(oldRefreshToken, req.ip, req.headers['user-agent'])

    if (!tokens) {
      reply.clearCookie('ib_access_token').clearCookie('ib_refresh_token')
      return reply.status(401).send({ error: 'Invalid or expired refresh token' })
    }

    reply
      .setCookie('ib_access_token', tokens.accessToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 8 * 60 * 60,
      })
      .setCookie('ib_refresh_token', tokens.refreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/auth/refresh',
        maxAge: 7 * 24 * 60 * 60,
      })

    return reply.send({ ok: true })
  })

  // Sign out
  fastify.post('/api/auth/logout', async (req: FastifyRequest, reply: FastifyReply) => {
    const { revokeRefreshToken } = await import('./jwt')
    const refreshToken = (req.cookies as Record<string, string>)['ib_refresh_token']

    if (refreshToken) {
      await revokeRefreshToken(refreshToken)
    }

    reply
      .clearCookie('ib_access_token', { path: '/' })
      .clearCookie('ib_refresh_token', { path: '/api/auth/refresh' })

    return reply.send({ ok: true })
  })

  // Return current user info (used by dashboard on load)
  fastify.get('/api/auth/me', async (req: FastifyRequest, reply: FastifyReply) => {
    const { verifyAccessToken } = await import('./jwt')
    const token = (req.cookies as Record<string, string>)['ib_access_token']
      || req.headers.authorization?.replace('Bearer ', '')

    if (!token) return reply.status(401).send({ error: 'Not authenticated' })

    try {
      const payload = verifyAccessToken(token)
      return reply.send({
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        role: payload.role,
      })
    } catch {
      return reply.status(401).send({ error: 'Invalid token' })
    }
  })
}
