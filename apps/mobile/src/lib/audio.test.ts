import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDemoAudioMeta,
  createDemoWavBlob,
  fetchAudioBlob,
  formatAudioDuration,
  getAudioMeta,
  getLocalAudioBlob,
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

  it('maps playback 401 and network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401)))
    await expect(fetchAudioBlob({ audioId: 'a', token: 'bad' })).rejects.toMatchObject({
      code: 'unauthorized',
    })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(fetchAudioBlob({ audioId: 'a', token: 'token' })).rejects.toMatchObject({
      code: 'network_error',
    })
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
})
