import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { env } from '../config/env'
import { query, queryOne } from '../plugins/postgres'

export interface JwtPayload {
  sub: string       // user UUID
  email: string
  name: string
  role: 'admin' | 'editor' | 'viewer'
  iat?: number
  exp?: number
}

// Parse expiry string like "8h", "7d" into seconds
function expiryToSeconds(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/)
  if (!match) throw new Error(`Invalid expiry format: ${expiry}`)
  const value = parseInt(match[1])
  const unit = match[2]
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }
  return value * multipliers[unit]
}

export function signAccessToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_TOKEN_EXPIRY as jwt.SignOptions['expiresIn'],
  })
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload
}

export async function createRefreshToken(userId: string, ipAddress?: string, userAgent?: string): Promise<string> {
  const token = crypto.randomBytes(64).toString('hex')
  const expiresAt = new Date(Date.now() + expiryToSeconds(env.JWT_REFRESH_TOKEN_EXPIRY) * 1000)

  await query(
    `INSERT INTO intrabase_system.sessions (user_id, refresh_token, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, token, ipAddress ?? null, userAgent ?? null, expiresAt]
  )

  return token
}

export async function rotateRefreshToken(
  oldToken: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{ accessToken: string; refreshToken: string } | null> {
  // Find and validate the session
  const session = await queryOne<{
    id: string
    user_id: string
    expires_at: string
  }>(
    `SELECT id, user_id, expires_at
     FROM intrabase_system.sessions
     WHERE refresh_token = $1`,
    [oldToken]
  )

  if (!session) return null
  if (new Date(session.expires_at) < new Date()) {
    // Expired — delete and reject
    await query(`DELETE FROM intrabase_system.sessions WHERE id = $1`, [session.id])
    return null
  }

  // Get user
  const user = await queryOne<JwtPayload & { id: string }>(
    `SELECT id, email, name, role
     FROM intrabase_system.users
     WHERE id = $1 AND is_active = true`,
    [session.user_id]
  )

  if (!user) return null

  // Delete old session and create new one (rotation)
  await query(`DELETE FROM intrabase_system.sessions WHERE id = $1`, [session.id])

  const accessToken = signAccessToken({ sub: user.id, email: user.email, name: user.name, role: user.role })
  const refreshToken = await createRefreshToken(user.id, ipAddress, userAgent)

  return { accessToken, refreshToken }
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await query(`DELETE FROM intrabase_system.sessions WHERE refresh_token = $1`, [token])
}
