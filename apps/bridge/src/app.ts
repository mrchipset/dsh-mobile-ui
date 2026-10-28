import cookie from '@fastify/cookie'
import websocket from '@fastify/websocket'
import Fastify, { type FastifyInstance } from 'fastify'
import type { AcpSupervisor } from './acp/supervisor.js'
import type { Config } from './config.js'
import { registerHttpRoutes } from './http/server.js'
import type { Logger } from './logger.js'
import type { LeaseManagerPort, SessionRepository } from './ports.js'
import type { SpeechToText, SttReadinessProbe } from './stt/index.js'
import { registerWsRoutes } from './ws/routes.js'

export interface AppDeps {
  config: Config
  repo: SessionRepository
  lease: LeaseManagerPort
  supervisor?: AcpSupervisor
  stt?: SpeechToText
  sttReadiness?: SttReadinessProbe
  logger: Logger
  permissionTtlMs?: number
}

/**
 * Build the Fastify app without listening. Tests and main share this factory.
 */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false })

  void app.register(cookie, { secret: deps.config.bridgeSecret })
  void app.register(websocket)

  registerHttpRoutes(app, deps)

  // WebSocket routes must live inside the @fastify/websocket plugin scope so
  // its onRoute hook rewrites `websocket: true` handlers.
  void app.register(async (instance) => {
    registerWsRoutes(instance, deps)
  })

  return app
}
