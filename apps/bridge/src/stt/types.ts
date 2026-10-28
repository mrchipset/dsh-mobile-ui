export interface SttTranscribeInput {
  data: Uint8Array
  mimeType: string
  language?: string
  durationMs?: number
}

export interface SttTranscribeResult {
  text: string
  language?: string
  provider: string
  model: string
}

/** Adapter contract shared by the HTTP layer and fake test doubles. */
export interface SpeechToText {
  transcribe(input: SttTranscribeInput): Promise<SttTranscribeResult>
}

export type SttErrorCode = 'stt_timeout' | 'stt_upstream_error'

export class SttError extends Error {
  readonly code: SttErrorCode

  constructor(code: SttErrorCode, message: string) {
    super(message)
    this.name = 'SttError'
    this.code = code
  }
}
