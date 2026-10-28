import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
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
        model: 'SenseVoiceSmall',
      },
    })

    const apiResponse = await app.inject({ method: 'GET', url: '/api/health' })
    expect(apiResponse.statusCode).toBe(200)

    await app.close()
    lease.dispose()
  })

  it('reports configured STT state without probing the service', async () => {
    const config = loadConfig({
      BRIDGE_SECRET: 'correct-horse-battery',
      ACP_ENABLED: 'false',
      STT_ENABLED: 'true',
      STT_PROVIDER: 'funasr',
      STT_MODEL: 'SenseVoiceSmall-int8',
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
      stt: {
        enabled: true,
        provider: 'funasr',
        model: 'SenseVoiceSmall-int8',
      },
    })

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
