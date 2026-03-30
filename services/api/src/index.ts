import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'

import { env } from './config/env'
import { testConnection } from './plugins/postgres'
import { registerGoogleAuth } from './auth/google'
import { registerDevLogin } from './auth/devLogin'
import { registerApiKeyRoutes } from './auth/apiKey'
import { registerRestRoutes } from './rest/routes'
import { registerProjectRoutes } from './rest/projects'
import { registerAuditHook } from './middleware/audit'
import { introspectSchema } from './rest/introspect'
import { attachWebSocketServer } from './realtime/wsServer'
import { startListener } from './realtime/listener'

async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: env.NODE_ENV === 'development' ? 'info' : 'warn',
      transport: env.NODE_ENV === 'development'
        ? { target: 'pino-pretty' }
        : undefined,
    },
    trustProxy: true, // Nginx sits in front
  })

  // ─── Security ───────────────────────────────────────────────────────────────
  await fastify.register(helmet, {
    contentSecurityPolicy: false, // Dashboard handles its own CSP
  })

  await fastify.register(cors, {
    origin: env.DASHBOARD_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })

  await fastify.register(cookie, {
    secret: env.JWT_SECRET, // Signs cookies for tamper detection
  })

  await fastify.register(rateLimit, {
    max: env.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      // Rate limit by user ID if authenticated, else by IP
      return (req as { user?: { sub: string } }).user?.sub ?? req.ip
    },
    errorResponseBuilder: () => ({
      error: 'Too many requests — slow down',
      statusCode: 429,
    }),
  })

  // ─── Audit Hook ─────────────────────────────────────────────────────────────
  registerAuditHook(fastify)

  // ─── Health Check ───────────────────────────────────────────────────────────
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  // ─── Auth Routes ────────────────────────────────────────────────────────────
  await registerGoogleAuth(fastify)
  await registerDevLogin(fastify)  // no-op in production

  // ─── API Key Routes ─────────────────────────────────────────────────────────
  await registerApiKeyRoutes(fastify)

  // ─── REST API + Admin Routes ─────────────────────────────────────────────────
  await registerRestRoutes(fastify)
  await registerProjectRoutes(fastify)

  // ─── Global Error Handler ────────────────────────────────────────────────────
  fastify.setErrorHandler((error, _req, reply) => {
    fastify.log.error(error)

    if (error.code === 'FST_ERR_VALIDATION') {
      return reply.status(400).send({ error: 'Validation error', details: error.message })
    }

    // PostgreSQL errors
    const pgError = error as { code?: string; detail?: string }
    if (pgError.code === '23505') {
      return reply.status(409).send({ error: 'Duplicate value — unique constraint violated', detail: pgError.detail })
    }
    if (pgError.code === '23503') {
      return reply.status(409).send({ error: 'Foreign key constraint violated', detail: pgError.detail })
    }
    if (pgError.code === '42501') {
      return reply.status(403).send({ error: 'Insufficient privilege — check Row Level Security policies' })
    }
    if (pgError.code?.startsWith('42')) {
      return reply.status(400).send({ error: 'SQL syntax or schema error', detail: error.message })
    }

    const statusCode = error.statusCode ?? 500
    return reply.status(statusCode).send({
      error: statusCode === 500 ? 'Internal server error' : error.message,
    })
  })

  return fastify
}

async function start() {
  const fastify = await buildServer()

  try {
    // Verify PostgreSQL connection
    await testConnection()

    // Pre-warm schema cache
    const tables = await introspectSchema()
    fastify.log.info(`✅ Schema loaded — ${tables.size} public table(s) discovered`)

    // Start listening
    await fastify.listen({ port: env.API_PORT, host: '0.0.0.0' })
    fastify.log.info(`🚀 IntraBase API running on port ${env.API_PORT}`)

    // Attach WebSocket server and start pg LISTEN loop
    attachWebSocketServer(fastify.server)
    startListener().catch((err) => fastify.log.warn('Realtime listener failed to start:', err))
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
