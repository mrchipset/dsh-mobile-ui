import { afterEach, describe, expect, it, type Mock, vi } from 'vitest'
import {
  OpenAICompatibleStt,
  type OpenAICompatibleSttOptions,
} from '../src/stt/openai-compatible.js'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeStt(overrides: Partial<OpenAICompatibleSttOptions> = {}): OpenAICompatibleStt {
  return new OpenAICompatibleStt({
    baseUrl: 'http://127.0.0.1:8000/v1/',
    provider: 'funasr',
    model: 'SenseVoiceSmall',
    defaultLanguage: 'zh',
    timeoutMs: 1000,
    ...overrides,
  })
}

function firstFetchCall(fetchMock: Mock): { url: unknown; init: RequestInit } {
  const call = fetchMock.mock.calls[0]
  if (call === undefined) throw new Error('fetch was not called')
  return { url: call[0], init: call[1] as RequestInit }
}

const audio = new Uint8Array([1, 2, 3, 4])

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OpenAICompatibleStt', () => {
  it('maps the request and trims the response text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ text: '  你好  ' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await makeStt().transcribe({
      data: audio,
      mimeType: 'audio/webm',
      durationMs: 1200,
    })

    expect(result).toEqual({
      text: '你好',
      language: 'zh',
      provider: 'funasr',
      model: 'SenseVoiceSmall',
    })

    const { url, init } = firstFetchCall(fetchMock)
    expect(String(url)).toBe('http://127.0.0.1:8000/v1/audio/transcriptions')
    expect(init.method).toBe('POST')
    expect(init.signal).toBeInstanceOf(AbortSignal)

    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()

    const form = init.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('model')).toBe('SenseVoiceSmall')
    expect(form.get('language')).toBe('zh')
    expect(form.get('response_format')).toBe('json')
    const file = form.get('file')
    expect(file).toBeInstanceOf(Blob)
    expect((file as Blob).type).toBe('audio/webm')
  })

  it('passes an explicit language and Authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ text: 'ok' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await makeStt({ apiKey: 'sekret' }).transcribe({
      data: audio,
      mimeType: 'audio/mp4',
      language: 'en',
    })
    expect(result.language).toBe('en')

    const { init } = firstFetchCall(fetchMock)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sekret')
    expect((init.body as FormData).get('language')).toBe('en')
  })

  it('omits authorization for a blank API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ text: 'ok' }))
    vi.stubGlobal('fetch', fetchMock)

    await makeStt({ apiKey: '   ' }).transcribe({ data: audio, mimeType: 'audio/wav' })
    const { init } = firstFetchCall(fetchMock)
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('omits language for auto and prefers the upstream language', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ text: 'ok', language: 'zh' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await makeStt({ defaultLanguage: 'auto' }).transcribe({
      data: audio,
      mimeType: 'audio/webm',
    })
    expect(result.language).toBe('zh')

    const { init } = firstFetchCall(fetchMock)
    expect((init.body as FormData).has('language')).toBe(false)
  })

  it('prefers an upstream language over the requested language', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ text: 'ok', language: 'en' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await makeStt().transcribe({
      data: audio,
      mimeType: 'audio/webm',
      language: 'zh',
    })
    expect(result.language).toBe('en')
  })

  it('maps timeouts to stt_timeout', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout))

    await expect(
      makeStt().transcribe({ data: audio, mimeType: 'audio/webm' }),
    ).rejects.toMatchObject({ code: 'stt_timeout' })
  })

  it('maps network failures to stt_upstream_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    await expect(
      makeStt().transcribe({ data: audio, mimeType: 'audio/webm' }),
    ).rejects.toMatchObject({ code: 'stt_upstream_error' })
  })

  it('records the upstream status for non-OK responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 503 })))

    await expect(
      makeStt().transcribe({ data: audio, mimeType: 'audio/webm' }),
    ).rejects.toMatchObject({
      code: 'stt_upstream_error',
      upstreamStatus: 503,
    })
  })

  it.each([
    ['non-ok status', new Response('nope', { status: 500 })],
    ['invalid JSON', new Response('not-json', { status: 200 })],
    ['blank text', jsonResponse({ text: '   ' })],
    ['missing text', jsonResponse({ result: 'nope' })],
  ])('maps %s to stt_upstream_error', async (_label, response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expect(
      makeStt().transcribe({ data: audio, mimeType: 'audio/webm' }),
    ).rejects.toMatchObject({ code: 'stt_upstream_error' })
  })
})
