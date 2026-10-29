import type { SessionSummary } from '@dsh-mobile/protocol'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import type { AudioTranscoder } from '../src/audio/transcoder.js'
import { loadConfig } from '../src/config.js'
import { type OpenDatabaseResult, openDatabase } from '../src/db/index.js'
import { LeaseManager } from '../src/lease/manager.js'
import { createLogger } from '../src/logger.js'
import type { SessionRepository } from '../src/ports.js'

const secret = 'correct-horse-battery'
const audio = Buffer.from('ORIGINAL-AUDIO-BYTES')
const playback = Buffer.from('PLAYBACK-M4A')
let transcodeCalls = 0
const transcoder: AudioTranscoder = {
  async transcode() {
    transcodeCalls += 1
    return { data: playback, mimeType: 'audio/mp4', transcoded: true }
  },
  async isAvailable() {
    return true
  },
}

interface Harness {
  app: FastifyInstance
  repo: SessionRepository
}

let active: { app: FastifyInstance; repo: OpenDatabaseResult; lease: LeaseManager } | undefined

afterEach(async () => {
  if (active !== undefined) {
    await active.app.close()
    active.lease.dispose()
    active.repo.close()
    active = undefined
  }
  transcodeCalls = 0
})

function makeHarness(
  env: Record<string, string> = {},
  transcoderImpl: AudioTranscoder | null = transcoder,
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
    ...(transcoderImpl === null ? {} : { transcoder: transcoderImpl }),
    logger: createLogger('silent'),
  })
  active = { app, repo: opened, lease }
  return { app, repo: opened.repo }
}

async function seedSession(repo: SessionRepository, id = 's1'): Promise<void> {
  const summary: SessionSummary = {
    id,
    title: null,
    cwd: 'C:/workspace',
    createdAt: 1000,
    lastActivityAt: 1000,
    lastSeq: 0,
    lease: { state: 'idle', holder: null },
    running: false,
  }
  await repo.upsert(summary)
}

function uploadHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${secret}`,
    'content-type': 'audio/webm;codecs=opus',
    ...extra,
  }
}

describe('voice attachment HTTP API', () => {
  it('requires auth and an existing session', async () => {
    const { app, repo } = makeHarness()
    await seedSession(repo)

    const noAuth = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/audio',
      headers: { 'content-type': 'audio/webm' },
      payload: audio,
    })
    expect(noAuth.statusCode).toBe(401)

    const missingSession = await app.inject({
      method: 'POST',
      url: '/api/sessions/missing/audio',
      headers: uploadHeaders(),
      payload: audio,
    })
    expect(missingSession.statusCode).toBe(404)
    expect(missingSession.json()).toEqual({ error: 'session_gone' })

    const getNoAuth = await app.inject({ method: 'GET', url: '/api/audio/a1' })
    expect(getNoAuth.statusCode).toBe(401)
  })

  it('stores original and playback bytes and serves the playback copy', async () => {
    const { app, repo } = makeHarness()
    await seedSession(repo)

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/audio',
      headers: uploadHeaders({ 'x-audio-duration-ms': '1200' }),
      payload: audio,
    })

    expect(response.statusCode).toBe(201)
    const body = response.json() as {
      id: string
      mimeType: string
      playbackMimeType: string
      durationMs: number
      sizeBytes: number
    }
    expect(body).toMatchObject({
      mimeType: 'audio/webm',
      playbackMimeType: 'audio/mp4',
      durationMs: 1200,
      sizeBytes: audio.byteLength,
      transcoded: true,
    })
    expect(body.id.length).toBeGreaterThan(0)

    const stored = await repo.getAudio(body.id)
    expect(stored?.original.equals(audio)).toBe(true)
    expect(stored?.playback.equals(playback)).toBe(true)
    expect(stored?.clientMsgId).toBeNull()

    const playbackResponse = await app.inject({
      method: 'GET',
      url: `/api/audio/${body.id}`,
      headers: { authorization: `Bearer ${secret}` },
    })
    expect(playbackResponse.statusCode).toBe(200)
    expect(playbackResponse.headers['content-type']).toBe('audio/mp4')
    expect(playbackResponse.headers['content-length']).toBe(String(playback.byteLength))
    expect(playbackResponse.headers['cache-control']).toBe('private, max-age=86400')
    expect(playbackResponse.rawPayload.equals(playback)).toBe(true)

    const missing = await app.inject({
      method: 'GET',
      url: '/api/audio/missing',
      headers: { authorization: `Bearer ${secret}` },
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toEqual({ error: 'audio_not_found' })
  })

  it('keeps the original bytes when no transcoder is wired', async () => {
    const { app, repo } = makeHarness({}, null)
    await seedSession(repo)

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/audio',
      headers: uploadHeaders({ 'x-audio-duration-ms': '500' }),
      payload: audio,
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      mimeType: 'audio/webm',
      playbackMimeType: 'audio/webm',
      durationMs: 500,
      transcoded: false,
    })
  })

  it('enforces size, MIME, empty body, and duration limits', async () => {
    const { app, repo } = makeHarness({ STT_MAX_BYTES: '4', STT_MAX_DURATION_MS: '1000' })
    await seedSession(repo)

    const tooLarge = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/audio',
      headers: uploadHeaders(),
      payload: audio,
    })
    expect(tooLarge.statusCode).toBe(413)
    expect(tooLarge.json()).toEqual({ error: 'audio_too_large', maxBytes: 4 })

    const unsupported = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/audio',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/octet-stream',
      },
      payload: Buffer.from('x'),
    })
    expect(unsupported.statusCode).toBe(415)
    expect(unsupported.json()).toEqual({ error: 'unsupported_audio' })

    const missingDuration = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/audio',
      headers: uploadHeaders(),
      payload: Buffer.from('x'),
    })
    expect(missingDuration.statusCode).toBe(400)
    expect(missingDuration.json()).toEqual({ error: 'audio_duration_required' })

    const invalidDuration = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/audio',
      headers: uploadHeaders({ 'x-audio-duration-ms': 'soon' }),
      payload: Buffer.from('x'),
    })
    expect(invalidDuration.statusCode).toBe(400)
    expect(invalidDuration.json()).toEqual({ error: 'invalid_audio_duration' })

    const empty = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/audio',
      headers: uploadHeaders(),
      payload: Buffer.alloc(0),
    })
    expect(empty.statusCode).toBe(400)
    expect(empty.json()).toEqual({ error: 'audio_empty' })

    const tooLong = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/audio',
      headers: uploadHeaders({ 'x-audio-duration-ms': '1001' }),
      payload: Buffer.from('x'),
    })
    expect(tooLong.statusCode).toBe(400)
    expect(tooLong.json()).toEqual({ error: 'audio_too_long' })
  })

  it('skips ffmpeg for already-playable M4A input', async () => {
    const { app, repo } = makeHarness()
    await seedSession(repo)

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/s1/audio',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'audio/x-m4a',
        'x-audio-duration-ms': '800',
      },
      payload: audio,
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      playbackMimeType: 'audio/x-m4a',
      transcoded: false,
    })
    expect(transcodeCalls).toBe(0)
  })

  it('returns 429 audio_busy while a transcode slot is occupied', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let markStarted: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const slow: AudioTranscoder = {
      async transcode() {
        markStarted()
        await gate
        return { data: playback, mimeType: 'audio/mp4', transcoded: true }
      },
      async isAvailable() {
        return true
      },
    }
    const { app, repo } = makeHarness({ AUDIO_TRANSCODE_CONCURRENCY: '1' }, slow)
    await seedSession(repo)

    const first = app.inject({
      method: 'POST',
      url: '/api/sessions/s1/audio',
      headers: uploadHeaders({ 'x-audio-duration-ms': '900' }),
      payload: audio,
    })
    await started

    try {
      const second = await app.inject({
        method: 'POST',
        url: '/api/sessions/s1/audio',
        headers: uploadHeaders({ 'x-audio-duration-ms': '900' }),
        payload: audio,
      })
      expect(second.statusCode).toBe(429)
      expect(second.json()).toEqual({ error: 'audio_busy' })
    } finally {
      release()
      expect((await first).statusCode).toBe(201)
    }
  })
})
