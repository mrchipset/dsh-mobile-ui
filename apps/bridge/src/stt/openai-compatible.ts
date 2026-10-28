import {
  type SpeechToText,
  SttError,
  type SttTranscribeInput,
  type SttTranscribeResult,
} from './types.js'

export interface OpenAICompatibleSttOptions {
  baseUrl: string
  provider: string
  model: string
  defaultLanguage: string
  timeoutMs: number
  apiKey?: string
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case 'audio/webm':
      return 'webm'
    case 'audio/mp4':
      return 'mp4'
    case 'audio/wav':
      return 'wav'
    case 'audio/ogg':
      return 'ogg'
    case 'audio/x-m4a':
      return 'm4a'
    case 'audio/aac':
      return 'aac'
    default:
      return 'bin'
  }
}

function isTimeoutError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const name = 'name' in error ? (error as { name?: unknown }).name : undefined
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined
  return (
    name === 'TimeoutError' || name === 'AbortError' || code === 'ETIMEDOUT' || code === 'ABORT_ERR'
  )
}

/**
 * Minimal OpenAI-compatible transcription client. Uses only Node built-ins so
 * the Bridge stays dependency-free for STT.
 */
export class OpenAICompatibleStt implements SpeechToText {
  private readonly endpoint: string

  constructor(private readonly options: OpenAICompatibleSttOptions) {
    this.endpoint = `${options.baseUrl.replace(/\/$/, '')}/audio/transcriptions`
  }

  async transcribe(input: SttTranscribeInput): Promise<SttTranscribeResult> {
    const bytes = new Uint8Array(input.data)
    const requestedLanguage = input.language ?? this.options.defaultLanguage
    const form = new FormData()
    form.append(
      'file',
      new Blob([bytes.buffer as ArrayBuffer], { type: input.mimeType }),
      `audio.${extensionForMime(input.mimeType)}`,
    )
    form.append('model', this.options.model)
    if (requestedLanguage !== 'auto') form.append('language', requestedLanguage)
    form.append('response_format', 'json')

    const headers: Record<string, string> = {}
    const apiKey = this.options.apiKey?.trim()
    if (apiKey !== undefined && apiKey.length > 0) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    let response: Response
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        body: form,
        headers,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      })
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new SttError('stt_timeout', 'STT service timed out')
      }
      throw new SttError('stt_upstream_error', 'STT service request failed')
    }

    if (!response.ok) {
      throw new SttError(
        'stt_upstream_error',
        `STT service returned HTTP ${response.status}`,
        response.status,
      )
    }

    let payload: unknown
    try {
      payload = (await response.json()) as unknown
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new SttError('stt_timeout', 'STT service timed out')
      }
      throw new SttError('stt_upstream_error', 'STT service returned an invalid response')
    }

    const record =
      typeof payload === 'object' && payload !== null
        ? (payload as { text?: unknown; language?: unknown })
        : undefined
    const text = record?.text
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new SttError('stt_upstream_error', 'STT service returned no transcript')
    }

    const upstreamLanguage =
      typeof record?.language === 'string' && record.language.trim().length > 0
        ? record.language
        : undefined

    return {
      text: text.trim(),
      language: upstreamLanguage ?? requestedLanguage,
      provider: this.options.provider,
      model: this.options.model,
    }
  }
}
