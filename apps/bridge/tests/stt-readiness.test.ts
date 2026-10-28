import { describe, expect, it, type Mock, vi } from 'vitest'
import { SttReadiness } from '../src/stt/readiness.js'

function firstCall(fetchMock: Mock): { url: unknown; init: RequestInit } {
  const call = fetchMock.mock.calls[0]
  if (call === undefined) throw new Error('fetch was not called')
  return { url: call[0], init: call[1] as RequestInit }
}

function okResponse(): Response {
  return new Response('{}', { status: 200 })
}

describe('SttReadiness', () => {
  it('probes /models with optional bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse())
    const readiness = new SttReadiness({
      baseUrl: 'http://127.0.0.1:8000/v1/',
      apiKey: 'sekret',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    expect(await readiness.reachable()).toBe(true)
    const { url, init } = firstCall(fetchMock)
    expect(String(url)).toBe('http://127.0.0.1:8000/v1/models')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sekret')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('omits authorization without a key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse())
    const readiness = new SttReadiness({
      baseUrl: 'http://127.0.0.1:8000/v1',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    expect(await readiness.reachable()).toBe(true)
    const { init } = firstCall(fetchMock)
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('reports false for non-OK and network failures', async () => {
    const nonOk = vi.fn().mockResolvedValue(new Response('nope', { status: 503 }))
    const first = new SttReadiness({
      baseUrl: 'http://stt:8000/v1',
      fetchImpl: nonOk as unknown as typeof fetch,
    })
    expect(await first.reachable()).toBe(false)

    const rejected = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const second = new SttReadiness({
      baseUrl: 'http://stt:8000/v1',
      fetchImpl: rejected as unknown as typeof fetch,
    })
    expect(await second.reachable()).toBe(false)
  })

  it('never throws when the probe implementation rejects', async () => {
    const throwingFetch = vi.fn(() => {
      throw new Error('synchronous probe failure')
    })
    const readiness = new SttReadiness({
      baseUrl: 'http://stt:8000/v1',
      fetchImpl: throwingFetch as unknown as typeof fetch,
    })

    await expect(readiness.reachable()).resolves.toBe(false)
    expect(throwingFetch).toHaveBeenCalledTimes(1)
  })

  it('times out without hanging', async () => {
    const never = vi.fn().mockReturnValue(new Promise<Response>(() => {}))
    const readiness = new SttReadiness({
      baseUrl: 'http://stt:8000/v1',
      timeoutMs: 10,
      fetchImpl: never as unknown as typeof fetch,
    })

    expect(await readiness.reachable()).toBe(false)
    expect(never).toHaveBeenCalledTimes(1)
  })

  it('caches both reachable and unreachable results', async () => {
    let now = 0
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
    const readiness = new SttReadiness({
      baseUrl: 'http://stt:8000/v1',
      cacheTtlMs: 30_000,
      now: () => now,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    expect(await readiness.reachable()).toBe(true)
    now = 10_000
    expect(await readiness.reachable()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    now = 31_000
    expect(await readiness.reachable()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    now = 60_000
    expect(await readiness.reachable()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
