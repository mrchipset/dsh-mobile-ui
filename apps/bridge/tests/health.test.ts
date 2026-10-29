import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import type { AudioTranscoder } from '../src/audio/transcoder.js'
import { loadConfig } from '../src/config.js'
import { type OpenDatabaseResult, openDatabase } from '../src/db/index.js'
import { LeaseManager } from '../src/lease/manager.js'
import { createLogger } from '../src/logger.js'

let opened: OpenDatabaseResult | undefined

afterEach(() => {
  opened?.close()
  opened = undefined
})

describe('health endpoint', () => {
  it('returns 200 with ACP disabled', async () => {
    const config = loadConfig({
      BRIDGE_SECRET: 'correct-horse-battery',
      ACP_ENABLED: 'false',
    } as NodeJS.ProcessEnv)
    opened = openDatabase({ ...config, dbPath: ':memory:' })
    const lease = new LeaseManager({ graceMs: config.leaseGraceMs })
    const app = buildApp({
      config,
      repo: opened.repo,
      lease,
      logger: createLogger('silent'),
    })

    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      ok: true,
      db: 'ok',
      acpEnabled: false,
      agent: 'disabled',
      stt: {
        enabled: false,
        provider: 'funasr',
        model: 'paraformer',
        reachable: false,
      },
      audio: { ffmpeg: false },
    })

    const apiResponse = await app.inject({ method: 'GET', url: '/api/health' })
    expect(apiResponse.statusCode).toBe(200)

    await app.close()
    lease.dispose()
  })

  it('reports cached STT readiness when enabled', async () => {
    const config = loadConfig({
      BRIDGE_SECRET: 'correct-horse-battery',
      ACP_ENABLED: 'false',
      STT_ENABLED: 'true',
      STT_PROVIDER: 'funasr',
      STT_MODEL: 'paraformer-int8',
    } as NodeJS.ProcessEnv)
    opened = openDatabase({ ...config, dbPath: ':memory:' })
    const lease = new LeaseManager({ graceMs: config.leaseGraceMs })
    const app = buildApp({
      config,
      repo: opened.repo,
      lease,
      sttReadiness: { reachable: async () => true },
      logger: createLogger('silent'),
    })

    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      ok: true,
      stt: {
        enabled: true,
        provider: 'funasr',
        model: 'paraformer-int8',
        reachable: true,
      },
    })

    await app.close()
    lease.dispose()
  })

  it('does not probe STT when disabled', async () => {
    const config = loadConfig({
      BRIDGE_SECRET: 'correct-horse-battery',
      ACP_ENABLED: 'false',
    } as NodeJS.ProcessEnv)
    opened = openDatabase({ ...config, dbPath: ':memory:' })
    const lease = new LeaseManager({ graceMs: config.leaseGraceMs })
    let calls = 0
    const app = buildApp({
      config,
      repo: opened.repo,
      lease,
      sttReadiness: {
        reachable: async () => {
          calls += 1
          return true
        },
      },
      logger: createLogger('silent'),
    })

    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      stt: { enabled: false, reachable: false },
    })
    expect(calls).toBe(0)

    await app.close()
    lease.dispose()
  })

  it('keeps health healthy when the readiness probe fails', async () => {
    const config = loadConfig({
      BRIDGE_SECRET: 'correct-horse-battery',
      ACP_ENABLED: 'false',
      STT_ENABLED: 'true',
    } as NodeJS.ProcessEnv)
    opened = openDatabase({ ...config, dbPath: ':memory:' })
    const lease = new LeaseManager({ graceMs: config.leaseGraceMs })
    const app = buildApp({
      config,
      repo: opened.repo,
      lease,
      sttReadiness: {
        reachable: async () => {
          throw new Error('probe failed')
        },
      },
      logger: createLogger('silent'),
    })

    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      ok: true,
      stt: { enabled: true, reachable: false },
    })

    await app.close()
    lease.dispose()
  })

  it('reports transcoder availability without failing health', async () => {
    const config = loadConfig({
      BRIDGE_SECRET: 'correct-horse-battery',
      ACP_ENABLED: 'false',
    } as NodeJS.ProcessEnv)
    opened = openDatabase({ ...config, dbPath: ':memory:' })
    const lease = new LeaseManager({ graceMs: config.leaseGraceMs })
    const transcoder: AudioTranscoder = {
      transcode: async (input) => ({
        data: input.data,
        mimeType: input.mimeType,
        transcoded: false,
      }),
      isAvailable: async () => true,
    }
    const app = buildApp({
      config,
      repo: opened.repo,
      lease,
      transcoder,
      logger: createLogger('silent'),
    })

    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ audio: { ffmpeg: true } })

    await app.close()
    lease.dispose()
  })

  it('accepts and rejects the auth probe token', async () => {
    const config = loadConfig({
      BRIDGE_SECRET: 'correct-horse-battery',
      ACP_ENABLED: 'false',
    } as NodeJS.ProcessEnv)
    opened = openDatabase({ ...config, dbPath: ':memory:' })
    const lease = new LeaseManager({ graceMs: config.leaseGraceMs })
    const app = buildApp({
      config,
      repo: opened.repo,
      lease,
      logger: createLogger('silent'),
    })

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/auth',
      payload: { token: 'correct-horse-battery' },
    })
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json()).toEqual({ ok: true })

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/auth',
      payload: { token: 'wrong' },
    })
    expect(rejected.statusCode).toBe(401)

    await app.close()
    lease.dispose()
  })
})
