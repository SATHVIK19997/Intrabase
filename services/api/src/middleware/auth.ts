import { FastifyRequest, FastifyReply } from 'fastify'
import { verifyAccessToken, JwtPayload } from '../auth/jwt'
import { verifyApiKey } from '../auth/apiKey'

// Augment FastifyRequest to carry the authenticated user
declare module 'fastify' {
  interface FastifyRequest {
    user: JwtPayload
  }
}

// Extract Bearer token from Authorization header or cookie
function extractToken(req: FastifyRequest): string | null {
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }
  const cookies = req.cookies as Record<string, string>
  return cookies['ib_access_token'] ?? null
}

// Primary auth middleware — accepts JWT (cookie/header) or API key
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = extractToken(req)

  if (!token) {
    return reply.status(401).send({ error: 'Authentication required' })
  }

  // Try JWT first
  try {
    req.user = verifyAccessToken(token)
    return
  } catch {
    // Not a valid JWT — try as API key
  }

  // Try API key
  const apiKeyUser = await verifyApiKey(token)
  if (apiKeyUser) {
    req.user = {
      sub: apiKeyUser.userId,
      email: apiKeyUser.email,
      name: apiKeyUser.name,
      role: apiKeyUser.role as JwtPayload['role'],
    }
    return
  }

  return reply.status(401).send({ error: 'Invalid or expired token' })
}

// Role guard middleware — use after requireAuth
export function requireRole(...roles: Array<'admin' | 'editor' | 'viewer'>) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.user) {
      return reply.status(401).send({ error: 'Authentication required' })
    }
    if (!roles.includes(req.user.role)) {
      return reply.status(403).send({
        error: `Forbidden — requires role: ${roles.join(' or ')}`,
      })
    }
  }
}

// Convenience: admin only
export const requireAdmin = requireRole('admin')

// Convenience: admin or editor
export const requireEditor = requireRole('admin', 'editor')
