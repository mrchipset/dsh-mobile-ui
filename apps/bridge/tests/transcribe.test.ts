import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { openDatabase } from '../src/db/index.js'
import { LeaseManager } from '../src/lease/manager.js'
import { createLogger, type Logger } from '../src/logger.js'
import {
  type SpeechToText,
  SttError,
  type SttTranscribeInput,
  type SttTranscribeResult,
} from '../src/stt/index.js'

const secret = 'correct-horse-battery'
const audio = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])

interface Harness {
  app: FastifyInstance
  close: () => Promise<void>
}

function makeHarness(
  env: Record<string, string>,
  stt?: SpeechToText,
  logger: Logger = createLogger('silent'),
): Harness {
  const config = loadConfig({
    BRIDGE_SECRET: secret,
    ACP_ENABLED: 'false',
    ...env,
  } as NodeJS.ProcessEnv)
  const opened = openDatabase({ ...config, dbPath: ':memory:' })
  const lease = new LeaseManager({ graceMs: config.leaseGraceMs })
  const app = buildApp({
    config,
    repo: opened.repo,
    lease,
    ...(stt === undefined ? {} : { stt }),
    logger,
  })

  return {
    app,
    close: async () => {
      await app.close()
      lease.dispose()
      opened.close()
    },
  }
}

function fakeStt(overrides: Partial<SttTranscribeResult> = {}): SpeechToText {
  return {
    async transcribe(input) {
      return {
        text: '你好',
        language: input.language ?? 'zh',
        provider: 'funasr',
        model: 'SenseVoiceSmall',
        ...overrides,
      }
    },
  }
}

function audioHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${secret}`,
    'content-type': 'audio/webm;codecs=opus',
    ...extra,
  }
}

describe('POST /api/transcribe', () => {
  it('rejects missing and invalid bearer tokens', async () => {
    const harness = makeHarness({ STT_ENABLED: 'true' }, fakeStt())
    try {
      const missing = await harness.app.inject({
        method: 'POST',
        url: '/api/transcribe',
        headers: { 'content-type': 'audio/webm' },
        payload: audio,
      })
      expect(missing.statusCode).toBe(401)
      expect(missing.json()).toEqual({ error: 'unauthorized' })

      const invalid = await harness.app.inject({
        method: 'POST',
        url: '/api/transcribe',
        headers: {
          authorization: 'Bearer wrong',
          'content-type': 'audio/webm',
        },
        payload: audio,
      })
      expect(invalid.statusCode).toBe(401)
    } finally {
      await harness.close()
    }
  })

  it('transcribes a raw audio body', async () => {
    const seen: SttTranscribeInput[] = []
    const stt: SpeechToText = {
      async transcribe(input) {
        seen.push(input)
        return {
          text: '把支付回调改成异步处理',
          language: input.language ?? 'zh',
          provider: 'funasr',
          model: 'SenseVoiceSmall',
        }
      },
    }
    const harness = makeHarness({ STT_ENABLED: 'true' }, stt)
    try {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/transcribe',
        headers: audioHeaders({ 'x-audio-duration-ms': '1200' }),
        payload: audio,
      })

      expect(response.statusCode).toBe(200)
      const body = response.json() as {
        text: string
        language: string
        provider: string
        model: string
        durationMs: number
        latencyMs: number
      }
      expect(body).toMatchObject({
        text: '把支付回调改成异步处理',
        language: 'zh',
        provider: 'funasr',
        model: 'SenseVoiceSmall',
        durationMs: 1200,
      })
      expect(typeof body.latencyMs).toBe('number')
      expect(seen[0]?.mimeType).toBe('audio/webm')
      expect(seen[0]?.durationMs).toBe(1200)
      expect(seen[0] === undefined ? undefined : Buffer.from(seen[0].data)).toEqual(audio)
    } finally {
      await harness.close()
    }
  })

  it('returns 401 before rejecting an oversized unauthenticated body', async () => {
    const harness = makeHarness({ STT_ENABLED: 'true', STT_MAX_BYTES: '4' }, fakeStt())
    try {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/transcribe',
        headers: { 'content-type': 'audio/webm' },
        payload: audio,
      })
      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({ error: 'unauthorized' })
    } finally {
      await harness.close()
    }
  })

  it('returns the audio_too_large envelope for oversized audio', async () => {
    const harness = makeHarness({ STT_ENABLED: 'true', STT_MAX_BYTES: '4' }, fakeStt())
    try {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/transcribe',
        headers: audioHeaders(),
        payload: audio,
      })
      expect(response.statusCode).toBe(413)
      expect(response.json()).toEqual({ error: 'audio_too_large', maxBytes: 4 })
    } finally {
      await harness.close()
    }
  })

  it('returns 415 for an unsupported audio type', async () => {
    const harness = makeHarness({ STT_ENABLED: 'true' }, fakeStt())
    try {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/transcribe',
        headers: {
          authorization: `Bearer ${secret}`,
          'content-type': 'application/octet-stream',
        },
        payload: audio,
      })
      expect(response.statusCode).toBe(415)
    } finally {
      await harness.close()
    }
  })

  it('returns 503 when STT is disabled', async () => {
    const harness = makeHarness({})
    try {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/transcribe',
        headers: audioHeaders(),
        payload: audio,
      })
      expect(response.statusCode).toBe(503)
      expect(response.json()).toEqual({ error: 'stt_disabled' })
    } finally {
      await harness.close()
    }
  })

  it('returns 504 when the adapter times out', async () => {
    const timeout: SpeechToText = {
      async transcribe() {
        throw new SttError('stt_timeout', 'timeout')
      },
    }
    const harness = makeHarness({ STT_ENABLED: 'true' }, timeout)
    try {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/transcribe',
        headers: audioHeaders(),
        payload: audio,
      })
      expect(response.statusCode).toBe(504)
      expect(response.json()).toEqual({ error: 'stt_timeout' })
    } finally {
      await harness.close()
    }
  })

  it('returns 502 for adapter failures', async () => {
    const failing: SpeechToText = {
      async transcribe() {
        throw new SttError('stt_upstream_error', 'upstream')
      },
    }
    const harness = makeHarness({ STT_ENABLED: 'true' }, failing)
    try {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/transcribe',
        headers: audioHeaders(),
        payload: audio,
      })
      expect(response.statusCode).toBe(502)
      expect(response.json()).toEqual({ error: 'stt_upstream_error' })
    } finally {
      await harness.close()
    }
  })

  it('rejects durations above the configured cap', async () => {
    const harness = makeHarness({ STT_ENABLED: 'true', STT_MAX_DURATION_MS: '1000' }, fakeStt())
    try {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/transcribe',
        headers: audioHeaders({ 'x-audio-duration-ms': '1001' }),
        payload: audio,
      })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error: 'audio_too_long' })
    } finally {
      await harness.close()
    }
  })

  it('returns 429 while the configured concurrency slot is busy', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let markStarted: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const slow: SpeechToText = {
      async transcribe() {
        markStarted()
        await gate
        return {
          text: 'ok',
          language: 'zh',
          provider: 'funasr',
          model: 'SenseVoiceSmall',
        }
      },
    }
    const harness = makeHarness({ STT_ENABLED: 'true', STT_CONCURRENCY: '1' }, slow)

    const first = harness.app.inject({
      method: 'POST',
      url: '/api/transcribe',
      headers: audioHeaders(),
      payload: audio,
    })
    await started

    try {
      const second = await harness.app.inject({
        method: 'POST',
        url: '/api/transcribe',
        headers: audioHeaders(),
        payload: audio,
      })
      expect(second.statusCode).toBe(429)
      expect(second.json()).toEqual({ error: 'stt_busy' })
    } finally {
      release()
      const firstResponse = await first
      expect(firstResponse.statusCode).toBe(200)
      await harness.close()
    }
  })

  it('returns 400 for an empty body', async () => {
    const harness = makeHarness({ STT_ENABLED: 'true' }, fakeStt())
    try {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/transcribe',
        headers: audioHeaders(),
        payload: Buffer.alloc(0),
      })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error: 'audio_empty' })
    } finally {
      await harness.close()
    }
  })

  it.each(['audio/mp4', 'audio/x-m4a', 'audio/aac'])(
    'accepts the iOS MIME type %s',
    async (mimeType) => {
      const harness = makeHarness({ STT_ENABLED: 'true' }, fakeStt())
      try {
        const response = await harness.app.inject({
          method: 'POST',
          url: '/api/transcribe',
          headers: {
            authorization: `Bearer ${secret}`,
            'content-type': mimeType,
          },
          payload: audio,
        })
        expect(response.statusCode).toBe(200)
      } finally {
        await harness.close()
      }
    },
  )

  it('releases the concurrency slot after a timeout', async () => {
    let calls = 0
    const flaky: SpeechToText = {
      async transcribe() {
        calls += 1
        if (calls === 1) throw new SttError('stt_timeout', 'timeout')
        return {
          text: 'ok',
          language: 'zh',
          provider: 'funasr',
          model: 'SenseVoiceSmall',
        }
      },
    }
    const harness = makeHarness({ STT_ENABLED: 'true', STT_CONCURRENCY: '1' }, flaky)
    try {
      const first = await harness.app.inject({
        method: 'POST',
        url: '/api/transcribe',
        headers: audioHeaders(),
        payload: audio,
      })
      expect(first.statusCode).toBe(504)

      const second = await harness.app.inject({
        method: 'POST',
        url: '/api/transcribe',
        headers: audioHeaders(),
        payload: audio,
      })
      expect(second.statusCode).toBe(200)
    } finally {
      await harness.close()
    }
  })

  it('logs only safe failure metadata', async () => {
    const logs: string[] = []
    const captureLogger = {
      info: (...args: unknown[]) => logs.push(JSON.stringify(args[0])),
      warn: (...args: unknown[]) => logs.push(JSON.stringify(args[0])),
      debug: () => {},
      error: () => {},
    } as unknown as Logger

    let calls = 0
    const transcript = 'TRANSCRIPT-UNIQUE'
    const audioMarker = Buffer.from('AUDIO-UNIQUE')
    const stt: SpeechToText = {
      async transcribe() {
        calls += 1
        if (calls === 1) {
          return {
            text: transcript,
            language: 'zh',
            provider: 'funasr',
            model: 'SenseVoiceSmall',
          }
        }
        throw new SttError('stt_upstream_error', 'upstream failed', 503)
      },
    }

    const harness = makeHarness(
      {
        STT_ENABLED: 'true',
        STT_BASE_URL: 'http://stt.internal:9999/v1',
        STT_API_KEY_ENV: 'STT_TEST_KEY',
      },
      stt,
      captureLogger,
    )
    try {
      const success = await harness.app.inject({
        method: 'POST',
        url: '/api/transcribe',
        headers: audioHeaders(),
        payload: audioMarker,
      })
      expect(success.statusCode).toBe(200)

      const failure = await harness.app.inject({
        method: 'POST',
        url: '/api/transcribe',
        headers: audioHeaders(),
        payload: audioMarker,
      })
      expect(failure.statusCode).toBe(502)
    } finally {
      await harness.close()
    }

    const joined = logs.join('\n')
    expect(joined).toContain('"upstreamStatus":503')
    expect(joined).not.toContain(transcript)
    expect(joined).not.toContain('AUDIO-UNIQUE')
    expect(joined).not.toContain('http://stt.internal:9999/v1')
    expect(joined).not.toContain('super-secret-key')
  })
})
