import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

const secret = 'correct-horse-battery'

describe('loadConfig', () => {
  it('applies documented defaults', () => {
    const config = loadConfig({ BRIDGE_SECRET: secret } as NodeJS.ProcessEnv)

    expect(config.dshBin).toBe('dsh')
    expect(config.dshArgs).toEqual(['--profile', 'acp'])
    expect(config.dshCwd).toBe(process.cwd())
    expect(config.dshProfile).toBe('acp')
    expect(config.workspaceRoot).toBe(resolve(process.cwd()))
    expect(config.dbPath).toBe(resolve(process.cwd(), './data/bridge.db'))
    expect(config.bridgePort).toBe(8787)
    expect(config.internalPort).toBe(8788)
    expect(config.retentionUpdates).toBe(5000)
    expect(config.leaseGraceMs).toBe(10000)
    expect(config.permissionTtlMs).toBe(180000)
    expect(config.logLevel).toBe('info')
    expect(config.acpEnabled).toBe(true)
    expect(config.sttEnabled).toBe(false)
    expect(config.sttProvider).toBe('funasr')
    expect(config.sttBaseUrl).toBe('http://127.0.0.1:8000/v1')
    expect(config.sttModel).toBe('SenseVoiceSmall')
    expect(config.sttLanguage).toBe('zh')
    expect(config.sttTimeoutMs).toBe(60000)
    expect(config.sttMaxBytes).toBe(8388608)
    expect(config.sttMaxDurationMs).toBe(60000)
    expect(config.sttConcurrency).toBe(1)
    expect(config.sttApiKeyEnv).toBeUndefined()
  })

  it('parses STT overrides', () => {
    const config = loadConfig({
      BRIDGE_SECRET: secret,
      STT_ENABLED: 'true',
      STT_PROVIDER: 'funasr',
      STT_BASE_URL: 'http://192.168.1.50:8000/v1',
      STT_MODEL: 'SenseVoiceSmall-int8',
      STT_LANGUAGE: 'auto',
      STT_TIMEOUT_MS: '120000',
      STT_MAX_BYTES: '1048576',
      STT_MAX_DURATION_MS: '30000',
      STT_CONCURRENCY: '2',
      STT_API_KEY_ENV: 'STT_API_KEY',
    } as NodeJS.ProcessEnv)

    expect(config.sttEnabled).toBe(true)
    expect(config.sttBaseUrl).toBe('http://192.168.1.50:8000/v1')
    expect(config.sttModel).toBe('SenseVoiceSmall-int8')
    expect(config.sttLanguage).toBe('auto')
    expect(config.sttTimeoutMs).toBe(120000)
    expect(config.sttMaxBytes).toBe(1048576)
    expect(config.sttMaxDurationMs).toBe(30000)
    expect(config.sttConcurrency).toBe(2)
    expect(config.sttApiKeyEnv).toBe('STT_API_KEY')
  })

  it('rejects an invalid STT_BASE_URL', () => {
    expect(() =>
      loadConfig({
        BRIDGE_SECRET: secret,
        STT_BASE_URL: 'not-a-url',
      } as NodeJS.ProcessEnv),
    ).toThrow()
  })

  it('uses DSH_PROFILE only when DSH_ARGS is absent', () => {
    const profileOnly = loadConfig({
      BRIDGE_SECRET: secret,
      DSH_PROFILE: 'mobile',
    } as NodeJS.ProcessEnv)
    expect(profileOnly.dshArgs).toEqual(['--profile', 'mobile'])

    const argsWin = loadConfig({
      BRIDGE_SECRET: secret,
      DSH_PROFILE: 'mobile',
      DSH_ARGS: '["--profile","acp","--verbose"]',
    } as NodeJS.ProcessEnv)
    expect(argsWin.dshArgs).toEqual(['--profile', 'acp', '--verbose'])
  })

  it('rejects malformed DSH_ARGS JSON', () => {
    expect(() =>
      loadConfig({ BRIDGE_SECRET: secret, DSH_ARGS: 'not-json' } as NodeJS.ProcessEnv),
    ).toThrow(/DSH_ARGS/)
  })

  it('rejects non-string DSH_ARGS entries', () => {
    expect(() =>
      loadConfig({ BRIDGE_SECRET: secret, DSH_ARGS: '["--profile", 1]' } as NodeJS.ProcessEnv),
    ).toThrow(/DSH_ARGS/)
  })

  it('requires BRIDGE_SECRET of at least 8 characters', () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow()
    expect(() => loadConfig({ BRIDGE_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow()
  })

  it('parses explicit booleans', () => {
    const config = loadConfig({
      BRIDGE_SECRET: secret,
      ACP_ENABLED: 'false',
      DB_PATH: './tmp/bridge.db',
    } as NodeJS.ProcessEnv)
    expect(config.acpEnabled).toBe(false)
    expect(config.dbPath).toBe(resolve(process.cwd(), './tmp/bridge.db'))
  })

  it('keeps :memory: untouched for tests', () => {
    const config = loadConfig({
      BRIDGE_SECRET: secret,
      DB_PATH: ':memory:',
    } as NodeJS.ProcessEnv)
    expect(config.dbPath).toBe(':memory:')
  })
})
