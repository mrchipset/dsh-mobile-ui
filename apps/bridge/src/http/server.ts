import { randomUUID } from 'node:crypto'
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AcpSupervisor } from '../acp/supervisor.js'
import type { AudioTranscoder } from '../audio/transcoder.js'
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
  transcoder?: AudioTranscoder
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

function durationFromHeader(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
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

    let ffmpeg = false
    if (deps.transcoder !== undefined) {
      try {
        ffmpeg = await deps.transcoder.isAvailable()
      } catch {
        ffmpeg = false
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
      audio: { ffmpeg },
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
  let transcodeInFlight = 0

  const requireBridgeAuth = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = bearerToken(headerValue(request.headers.authorization))
    if (token === undefined || !verifyToken(token, deps.config.bridgeSecret)) {
      reply.code(401).send({ error: 'unauthorized' })
    }
  }

  const audioBodyErrorHandler = (
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
    if (error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || error.statusCode === 415) {
      return reply.code(415).send({ error: 'unsupported_audio' })
    }
    return reply.code(error.statusCode ?? 500).send({ error: 'internal_error' })
  }

  app.post<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/audio',
    {
      bodyLimit: deps.config.sttMaxBytes,
      onRequest: requireBridgeAuth,
      errorHandler: audioBodyErrorHandler,
    },
    async (request, reply) => {
      const sessionId = request.params.sessionId
      const session = await deps.repo.get(sessionId)
      if (session === undefined) {
        return reply.code(404).send({ error: 'session_gone' })
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
      if (rawDuration === undefined || rawDuration.trim() === '') {
        return reply.code(400).send({ error: 'audio_duration_required' })
      }
      const durationMs = durationFromHeader(rawDuration)
      if (durationMs === undefined) {
        return reply.code(400).send({ error: 'invalid_audio_duration' })
      }
      if (durationMs > deps.config.sttMaxDurationMs) {
        return reply.code(400).send({ error: 'audio_too_long' })
      }

      let playback: { data: Buffer; mimeType: string; transcoded: boolean }
      const alreadyPlayable = mediaType === 'audio/mp4' || mediaType === 'audio/x-m4a'
      if (alreadyPlayable || deps.transcoder === undefined) {
        playback = { data: body, mimeType: mediaType, transcoded: false }
      } else {
        if (transcodeInFlight >= deps.config.audioTranscodeConcurrency) {
          return reply.code(429).send({ error: 'audio_busy' })
        }
        transcodeInFlight += 1
        try {
          playback = await deps.transcoder.transcode({ data: body, mimeType: mediaType })
        } finally {
          transcodeInFlight -= 1
        }
      }
      const id = randomUUID()

      await deps.repo.insertAudio({
        id,
        sessionId,
        mimeType: mediaType,
        playbackMimeType: playback.mimeType,
        durationMs,
        sizeBytes: body.byteLength,
        original: body,
        playback: playback.data,
        createdAt: Date.now(),
      })

      return reply.code(201).send({
        id,
        mimeType: mediaType,
        playbackMimeType: playback.mimeType,
        durationMs,
        sizeBytes: body.byteLength,
        transcoded: playback.transcoded,
      })
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/audio/:id',
    { onRequest: requireBridgeAuth },
    async (request, reply) => {
      const audio = await deps.repo.getAudio(request.params.id)
      if (audio === undefined) {
        return reply.code(404).send({ error: 'audio_not_found' })
      }

      return reply
        .header('Content-Type', audio.playbackMimeType)
        .header('Content-Length', String(audio.playback.byteLength))
        .header('Cache-Control', 'private, max-age=86400')
        .send(audio.playback)
    },
  )

  app.post(
    '/api/transcribe',
    {
      bodyLimit: deps.config.sttMaxBytes,
      onRequest: requireBridgeAuth,
      errorHandler: audioBodyErrorHandler,
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

      const durationMs = durationFromHeader(headerValue(request.headers['x-audio-duration-ms']))
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
