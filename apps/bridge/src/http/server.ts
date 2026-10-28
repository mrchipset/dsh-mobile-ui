import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AcpSupervisor } from '../acp/supervisor.js'
import { verifyToken } from '../auth.js'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import type { SessionRepository } from '../ports.js'
import { type SpeechToText, SttError, type SttReadinessProbe } from '../stt/index.js'

export const BRIDGE_VERSION = '0.0.0'

const ACCEPTED_AUDIO_TYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'audio/x-m4a',
  'audio/aac',
])

const authBodySchema = z.object({
  token: z.string().min(1).max(256),
})

export interface HttpRouteDeps {
  config: Config
  repo: SessionRepository
  supervisor?: AcpSupervisor
  stt?: SpeechToText
  sttReadiness?: SttReadinessProbe
  logger: Logger
}

function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1]
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function mediaTypeOf(header: string | undefined): string {
  return (header ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

export function registerHttpRoutes(app: FastifyInstance, deps: HttpRouteDeps): void {
  app.addContentTypeParser(/^audio\//, { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body)
  })

  const health = async (_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    let dbState: 'ok' | 'error' = 'ok'
    try {
      await deps.repo.list()
    } catch {
      dbState = 'error'
    }

    const agent = deps.config.acpEnabled ? (deps.supervisor?.status ?? 'disconnected') : 'disabled'

    let reachable = false
    if (deps.config.sttEnabled && deps.sttReadiness !== undefined) {
      try {
        reachable = await deps.sttReadiness.reachable()
      } catch {
        reachable = false
      }
    }

    const body = {
      ok: dbState === 'ok',
      uptime: process.uptime(),
      version: BRIDGE_VERSION,
      agent,
      db: dbState,
      acpEnabled: deps.config.acpEnabled,
      stt: {
        enabled: deps.config.sttEnabled,
        provider: deps.config.sttProvider,
        model: deps.config.sttModel,
        reachable,
      },
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

  let inFlight = 0

  const requireTranscribeAuth = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const token = bearerToken(headerValue(request.headers.authorization))
    if (token === undefined || !verifyToken(token, deps.config.bridgeSecret)) {
      reply.code(401).send({ error: 'unauthorized' })
    }
  }

  const transcribeErrorHandler = (
    error: FastifyError,
    _request: FastifyRequest,
    reply: FastifyReply,
  ): FastifyReply => {
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({
        error: 'audio_too_large',
        maxBytes: deps.config.sttMaxBytes,
      })
    }
    return reply.code(error.statusCode ?? 500).send({ error: 'internal_error' })
  }

  app.post(
    '/api/transcribe',
    {
      bodyLimit: deps.config.sttMaxBytes,
      onRequest: requireTranscribeAuth,
      errorHandler: transcribeErrorHandler,
    },
    async (request, reply) => {
      if (!deps.config.sttEnabled || deps.stt === undefined) {
        return reply.code(503).send({ error: 'stt_disabled' })
      }

      const mediaType = mediaTypeOf(headerValue(request.headers['content-type']))
      if (!ACCEPTED_AUDIO_TYPES.has(mediaType)) {
        return reply.code(415).send({ error: 'unsupported_audio' })
      }

      const body = request.body
      if (!Buffer.isBuffer(body) || body.byteLength === 0) {
        return reply.code(400).send({ error: 'audio_empty' })
      }

      const rawDuration = headerValue(request.headers['x-audio-duration-ms'])
      const parsedDuration =
        rawDuration === undefined ? Number.NaN : Number.parseInt(rawDuration, 10)
      const durationMs =
        Number.isFinite(parsedDuration) && parsedDuration >= 0 ? parsedDuration : undefined
      if (durationMs !== undefined && durationMs > deps.config.sttMaxDurationMs) {
        return reply.code(400).send({ error: 'audio_too_long' })
      }

      if (inFlight >= deps.config.sttConcurrency) {
        return reply.code(429).send({ error: 'stt_busy' })
      }

      const requestedLanguage = headerValue(request.headers['x-audio-language'])?.trim()

      inFlight += 1
      const startedAt = Date.now()
      try {
        const result = await deps.stt.transcribe({
          data: body,
          mimeType: mediaType,
          ...(requestedLanguage === undefined || requestedLanguage.length === 0
            ? {}
            : { language: requestedLanguage }),
          ...(durationMs === undefined ? {} : { durationMs }),
        })
        const latencyMs = Date.now() - startedAt

        deps.logger.info(
          {
            bytes: body.byteLength,
            durationMs: durationMs ?? 0,
            latencyMs,
            provider: result.provider,
          },
          'transcription completed',
        )

        return reply.send({
          text: result.text,
          language: result.language ?? deps.config.sttLanguage,
          provider: result.provider,
          model: result.model,
          durationMs: durationMs ?? 0,
          latencyMs,
        })
      } catch (error) {
        const latencyMs = Date.now() - startedAt
        if (error instanceof SttError) {
          deps.logger.warn(
            {
              bytes: body.byteLength,
              durationMs: durationMs ?? 0,
              latencyMs,
              errorCode: error.code,
              ...(error.upstreamStatus === undefined
                ? {}
                : { upstreamStatus: error.upstreamStatus }),
            },
            'transcription failed',
          )
          return reply.code(error.code === 'stt_timeout' ? 504 : 502).send({ error: error.code })
        }

        deps.logger.warn(
          {
            bytes: body.byteLength,
            durationMs: durationMs ?? 0,
            latencyMs,
            errorCode: 'stt_upstream_error',
          },
          'transcription failed',
        )
        return reply.code(502).send({ error: 'stt_upstream_error' })
      } finally {
        inFlight -= 1
      }
    },
  )
}
