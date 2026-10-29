import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acquireRemoteAudioUrl,
  createDemoAudioMeta,
  createDemoWavBlob,
  fetchAudioBlob,
  formatAudioDuration,
  getAudioMeta,
  getLocalAudioBlob,
  isNotAllowedPlaybackError,
  mediaPlaybackErrorMessage,
  releaseLocalAudio,
  releaseRemoteAudioUrl,
  shouldShowCompatibilityWarning,
  uploadAudio,
} from './audio'

function clip(): Blob {
  return new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm;codecs=opus' })
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('uploadAudio', () => {
  it('posts the raw blob with auth, MIME, and duration and parses the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          id: 'audio-1',
          mimeType: 'audio/webm;codecs=opus',
          playbackMimeType: 'audio/mp4',
          durationMs: 1234,
          sizeBytes: 3,
          transcoded: true,
        },
        201,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const blob = clip()
    const result = await uploadAudio({
      sessionId: 'session-1',
      blob,
      durationMs: 1234,
      token: 'secret',
    })

    expect(result).toMatchObject({ id: 'audio-1', transcoded: true })
    const first = fetchMock.mock.calls[0]
    expect(first?.[0]).toBe('/api/sessions/session-1/audio')
    const init = first?.[1] as RequestInit | undefined
    expect(init?.body).toBe(blob)
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe('Bearer secret')
    expect(headers.get('content-type')).toBe('audio/webm;codecs=opus')
    expect(headers.get('x-audio-duration-ms')).toBe('1234')
  })

  it('maps 401 to unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401)))

    await expect(
      uploadAudio({ sessionId: 's', blob: clip(), durationMs: 900, token: 'bad' }),
    ).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('maps 429 to audio_busy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'audio_busy' }, 429)))

    await expect(
      uploadAudio({ sessionId: 's', blob: clip(), durationMs: 900, token: 'token' }),
    ).rejects.toMatchObject({ code: 'audio_busy' })
  })

  it('surfaces the maxBytes limit on 413', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: 'audio_too_large', maxBytes: 8 * 1024 * 1024 }, 413),
        ),
    )

    await expect(
      uploadAudio({ sessionId: 's', blob: clip(), durationMs: 900, token: 'token' }),
    ).rejects.toMatchObject({
      code: 'audio_too_large',
      message: '录音文件过大，请缩短录音（上限 8 MB）',
    })
  })

  it('maps unknown server faults to audio_upstream_error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'internal_error' }, 500)),
    )

    await expect(
      uploadAudio({ sessionId: 's', blob: clip(), durationMs: 900, token: 'token' }),
    ).rejects.toMatchObject({ code: 'audio_upstream_error' })
  })

  it('maps fetch failures to network_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    await expect(
      uploadAudio({ sessionId: 's', blob: clip(), durationMs: 900, token: 'token' }),
    ).rejects.toMatchObject({ code: 'network_error' })
  })

  it('maps 404 to session_gone and 415 to unsupported_audio', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'session_gone' }, 404)))
    await expect(
      uploadAudio({ sessionId: 'missing', blob: clip(), durationMs: 900, token: 'token' }),
    ).rejects.toMatchObject({ code: 'session_gone' })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'unsupported_audio' }, 415)),
    )
    await expect(
      uploadAudio({ sessionId: 's', blob: clip(), durationMs: 900, token: 'token' }),
    ).rejects.toMatchObject({ code: 'unsupported_audio' })
  })

  it('rejects a successful response missing transcoded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            id: 'audio-x',
            mimeType: 'audio/webm',
            playbackMimeType: 'audio/mp4',
            durationMs: 900,
            sizeBytes: 3,
          },
          201,
        ),
      ),
    )

    await expect(
      uploadAudio({ sessionId: 's', blob: clip(), durationMs: 900, token: 'token' }),
    ).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('maps an aborted upload to audio_timeout', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')))

    await expect(
      uploadAudio({
        sessionId: 's',
        blob: clip(),
        durationMs: 900,
        token: 'token',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'audio_timeout' })
  })
})

describe('fetchAudioBlob', () => {
  it('fetches playback bytes with bearer auth and preserves the response type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([4, 5, 6, 7]), {
        status: 200,
        headers: { 'content-type': 'audio/wav' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const blob = await fetchAudioBlob({ audioId: 'audio-2', token: 'secret' })

    expect(blob.size).toBe(4)
    expect(blob.type).toBe('audio/wav')
    const first = fetchMock.mock.calls[0]
    expect(first?.[0]).toBe('/api/audio/audio-2')
    const init = first?.[1] as RequestInit | undefined
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret')
  })

  it('maps missing playback audio to audio_not_found', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'audio_not_found' }, 404)),
    )

    await expect(fetchAudioBlob({ audioId: 'missing', token: 'token' })).rejects.toMatchObject({
      code: 'audio_not_found',
    })
  })

  it('maps playback 401, 5xx, and network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401)))
    await expect(fetchAudioBlob({ audioId: 'a', token: 'bad' })).rejects.toMatchObject({
      code: 'unauthorized',
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'upstream' }, 500)))
    await expect(fetchAudioBlob({ audioId: 'a', token: 'token' })).rejects.toMatchObject({
      code: 'audio_upstream_error',
    })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(fetchAudioBlob({ audioId: 'a', token: 'token' })).rejects.toMatchObject({
      code: 'network_error',
    })
  })

  it('maps an aborted playback fetch to playback_timeout', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')))

    await expect(
      fetchAudioBlob({ audioId: 'a', token: 'token', signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'playback_timeout' })
  })
})

describe('audio metadata and demo helpers', () => {
  it('creates a playable local WAV preview', () => {
    const wav = createDemoWavBlob(1200)
    expect(wav.type).toBe('audio/wav')
    expect(wav.size).toBeGreaterThan(44)
  })

  it('registers local demo audio metadata and blob', () => {
    const wav = createDemoWavBlob(800)
    const meta = createDemoAudioMeta({ blob: wav, mimeType: 'audio/wav', durationMs: 800 })
    expect(meta.demo).toBe(true)
    expect(meta.transcoded).toBe(true)
    expect(getAudioMeta(meta.id)?.durationMs).toBe(800)
    expect(getLocalAudioBlob(meta.id)).toBe(wav)
  })

  it('formats durations', () => {
    expect(formatAudioDuration(0)).toBe('0:00')
    expect(formatAudioDuration(65_000)).toBe('1:05')
  })

  it('releases local demo audio metadata and blob', () => {
    const wav = createDemoWavBlob(600)
    const meta = createDemoAudioMeta({ blob: wav, mimeType: 'audio/wav', durationMs: 600 })
    releaseLocalAudio(meta.id)
    expect(getAudioMeta(meta.id)).toBeUndefined()
    expect(getLocalAudioBlob(meta.id)).toBeUndefined()
  })
})

describe('audio warning and media helpers', () => {
  it('suppresses the warning for already-playable MP4/M4A fallbacks', () => {
    expect(
      shouldShowCompatibilityWarning({
        transcoded: false,
        playbackMimeType: 'audio/mp4',
      }),
    ).toBe(false)
    expect(
      shouldShowCompatibilityWarning({
        transcoded: false,
        playbackMimeType: 'audio/x-m4a',
      }),
    ).toBe(false)
  })

  it('warns only for real browser fallbacks', () => {
    expect(
      shouldShowCompatibilityWarning({
        transcoded: false,
        playbackMimeType: 'audio/webm;codecs=opus',
      }),
    ).toBe(true)
    expect(
      shouldShowCompatibilityWarning({ transcoded: false, playbackMimeType: 'audio/ogg' }),
    ).toBe(true)
    expect(
      shouldShowCompatibilityWarning({ transcoded: false, playbackMimeType: 'audio/aac' }),
    ).toBe(true)
    expect(
      shouldShowCompatibilityWarning({
        transcoded: true,
        playbackMimeType: 'audio/webm',
      }),
    ).toBe(false)
    expect(
      shouldShowCompatibilityWarning({
        transcoded: false,
        playbackMimeType: 'audio/webm',
        demo: true,
      }),
    ).toBe(false)
  })

  it('uses format-specific media error copy and detects autoplay blocking', () => {
    expect(mediaPlaybackErrorMessage('audio/webm;codecs=opus')).toContain('WebM')
    expect(mediaPlaybackErrorMessage('audio/ogg')).toContain('Ogg')
    expect(mediaPlaybackErrorMessage('audio/aac')).toContain('AAC')
    expect(mediaPlaybackErrorMessage('audio/mp4')).toContain('这段录音')
    expect(isNotAllowedPlaybackError(new DOMException('blocked', 'NotAllowedError'))).toBe(true)
    expect(isNotAllowedPlaybackError(new Error('other'))).toBe(false)
  })
})

describe('remote audio URL cache', () => {
  it('shares one fetch across acquires and revokes only at zero refs', async () => {
    const id = 'remote-shared-test'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2]), {
        status: 200,
        headers: { 'content-type': 'audio/wav' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:shared-test')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    const [first, second] = await Promise.all([
      acquireRemoteAudioUrl(id, 'token'),
      acquireRemoteAudioUrl(id, 'token'),
    ])
    expect(first).toBe('blob:shared-test')
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(createSpy).toHaveBeenCalledTimes(1)

    releaseRemoteAudioUrl(id)
    const third = await acquireRemoteAudioUrl(id, 'token')
    expect(third).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    releaseRemoteAudioUrl(id)
    releaseRemoteAudioUrl(id)
    expect(revokeSpy).toHaveBeenCalledWith('blob:shared-test')
  })

  it('retries after a pending fetch failure', async () => {
    const id = 'remote-fail-test'
    const failingFetch = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', failingFetch)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:retry-test')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    await expect(acquireRemoteAudioUrl(id, 'token')).rejects.toMatchObject({
      code: 'network_error',
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const successFetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([3]), {
        status: 200,
        headers: { 'content-type': 'audio/wav' },
      }),
    )
    vi.stubGlobal('fetch', successFetch)
    const url = await acquireRemoteAudioUrl(id, 'token')
    expect(url).toBe('blob:retry-test')
    expect(successFetch).toHaveBeenCalledTimes(1)
    releaseRemoteAudioUrl(id)
    expect(revokeSpy).toHaveBeenCalledWith('blob:retry-test')
  })

  it('does not create a URL when the caller aborts during fetch (unmount)', async () => {
    const id = 'remote-abort-test'
    const controller = new AbortController()
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          const abort = (): void => reject(new DOMException('aborted', 'AbortError'))
          if (signal?.aborted === true) abort()
          else signal?.addEventListener('abort', abort, { once: true })
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const createSpy = vi.spyOn(URL, 'createObjectURL')

    const pending = acquireRemoteAudioUrl(id, 'token', controller.signal)
    const assertion = expect(pending).rejects.toMatchObject({ code: 'playback_timeout' })
    controller.abort()
    await assertion
    expect(createSpy).not.toHaveBeenCalled()
  })
})
