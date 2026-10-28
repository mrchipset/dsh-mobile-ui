import { afterEach, describe, expect, it, vi } from 'vitest'
import { SttError, TRANSCRIBE_TIMEOUT_MS, transcribeAudio } from './stt'

function clip(): Blob {
  return new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm;codecs=opus' })
}

function request(): Parameters<typeof transcribeAudio>[0] {
  return { blob: clip(), durationMs: 1200, token: 'test-token' }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('transcribeAudio', () => {
  it('prefers a known body error code over the HTTP status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'stt_busy' }, 500))
    vi.stubGlobal('fetch', fetchMock)

    await expect(transcribeAudio(request())).rejects.toMatchObject({ code: 'stt_busy' })
  })

  it('maps 401 to unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401)))

    await expect(transcribeAudio(request())).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('maps 400 audio_empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'audio_empty' }, 400)))

    await expect(transcribeAudio(request())).rejects.toMatchObject({ code: 'audio_empty' })
  })

  it.each(['', '   '])('rejects empty transcript %j', async (text) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ text })))

    await expect(transcribeAudio(request())).rejects.toMatchObject({ code: 'empty_transcript' })
  })

  it('rejects a non-JSON 200 response as invalid_response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(textResponse('not json', 200)))

    await expect(transcribeAudio(request())).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('maps an unknown 500 fault to stt_upstream_error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'internal_error' }, 500)),
    )

    await expect(transcribeAudio(request())).rejects.toMatchObject({
      code: 'stt_upstream_error',
    })
  })

  it('surfaces the server maxBytes on audio_too_large', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: 'audio_too_large', maxBytes: 8 * 1024 * 1024 }, 413),
        ),
    )

    await expect(transcribeAudio(request())).rejects.toMatchObject({
      code: 'audio_too_large',
      message: '录音文件过大，请缩短录音（上限 8 MB）',
    })
  })

  it('maps the internal timeout abort to stt_timeout', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          const rejectAbort = (): void => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          }
          if (signal?.aborted === true) {
            rejectAbort()
            return
          }
          signal?.addEventListener('abort', rejectAbort, { once: true })
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const pending = transcribeAudio(request())
    const rejection = expect(pending).rejects.toMatchObject({ code: 'stt_timeout' })
    await vi.advanceTimersByTimeAsync(TRANSCRIBE_TIMEOUT_MS)
    await rejection
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('does not send X-Audio-Language unless a language is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ text: 'ok' }))
    vi.stubGlobal('fetch', fetchMock)

    await transcribeAudio(request())

    const init = fetchMock.mock.calls[0]?.[1]
    const headers = new Headers(init?.headers)
    expect(headers.get('x-audio-language')).toBeNull()
    expect(headers.get('content-type')).toBe('audio/webm;codecs=opus')
    expect(headers.get('x-audio-duration-ms')).toBe('1200')
  })

  it('keeps SttError instances identifiable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'stt_disabled' }, 503)))

    await expect(transcribeAudio(request())).rejects.toBeInstanceOf(SttError)
  })
})
