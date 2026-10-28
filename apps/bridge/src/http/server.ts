import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AcpSupervisor } from '../acp/supervisor.js'
import { verifyToken } from '../auth.js'
import type { Config } from '../config.js'
import type { SessionRepository } from '../ports.js'

export const BRIDGE_VERSION = '0.0.0'

const authBodySchema = z.object({
  token: z.string().min(1).max(256),
})

export interface HttpRouteDeps {
  config: Config
  repo: SessionRepository
  supervisor?: AcpSupervisor
}

export function registerHttpRoutes(app: FastifyInstance, deps: HttpRouteDeps): void {
  const health = async (_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    let dbState: 'ok' | 'error' = 'ok'
    try {
      await deps.repo.list()
    } catch {
      dbState = 'error'
    }

    const agent = deps.config.acpEnabled ? (deps.supervisor?.status ?? 'disconnected') : 'disabled'

    const body = {
      ok: dbState === 'ok',
      uptime: process.uptime(),
      version: BRIDGE_VERSION,
      agent,
      db: dbState,
      acpEnabled: deps.config.acpEnabled,
    }

    return reply.code(dbState === 'ok' ? 200 : 503).send(body)
  }

  app.get('/health', health)
  app.get('/api/health', health)

  app.post('/api/auth', async (request, reply) => {
    const parsed = authBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'invalid_request' })
    }
    if (!verifyToken(parsed.data.token, deps.config.bridgeSecret)) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' })
    }
    return reply.send({ ok: true })
  })
}
