import { useCallback, useEffect, useRef, useState } from 'react'

/** Bridge STT_TIMEOUT_MS default is 60s; keep a margin for proxy/serialization. */
export const TRANSCRIBE_TIMEOUT_MS = 85_000

export type SttErrorCode =
  | 'unauthorized'
  | 'audio_empty'
  | 'audio_too_long'
  | 'audio_too_large'
  | 'unsupported_audio'
  | 'stt_busy'
  | 'stt_disabled'
  | 'stt_timeout'
  | 'stt_upstream_error'
  | 'network_error'
  | 'invalid_response'
  | 'empty_transcript'

const ERROR_COPY: Record<SttErrorCode, string> = {
  unauthorized: '访问令牌已失效，请重新连接 Bridge',
  audio_empty: '没有录到声音，请再试一次',
  audio_too_long: '录音超过 60 秒，已丢弃',
  audio_too_large: '录音文件过大，请缩短录音',
  unsupported_audio: '当前浏览器录音格式不受支持',
  stt_busy: '语音转写正忙，请稍后重试',
  stt_disabled: 'Bridge 未启用语音转写',
  stt_timeout: '语音转写超时，请重试',
  stt_upstream_error: '语音服务暂时不可用，请重试',
  network_error: '无法连接语音转写服务，请重试',
  invalid_response: '语音转写返回了无法识别的结果',
  empty_transcript: '没有识别到文字，请再试一次',
}

export class SttError extends Error {
  readonly code: SttErrorCode
  readonly maxBytes: number | undefined

  constructor(code: SttErrorCode, maxBytes?: number) {
    const limit =
      code === 'audio_too_large' && maxBytes !== undefined && maxBytes > 0
        ? `（上限 ${String(Math.max(1, Math.round(maxBytes / (1024 * 1024))))} MB）`
        : ''
    super(`${ERROR_COPY[code]}${limit}`)
    this.name = 'SttError'
    this.code = code
    this.maxBytes = maxBytes
  }
}

export interface SttResult {
  text: string
  language: string
  provider: string
  model: string
  durationMs: number
  latencyMs: number
}

export interface TranscribeInput {
  blob: Blob
  durationMs: number
  token: string
  language?: string
  signal?: AbortSignal
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function statusToCode(status: number): SttErrorCode {
  switch (status) {
    case 401:
      return 'unauthorized'
    case 413:
      return 'audio_too_large'
    case 415:
      return 'unsupported_audio'
    case 429:
      return 'stt_busy'
    case 503:
      return 'stt_disabled'
    case 504:
      return 'stt_timeout'
    case 502:
      return 'stt_upstream_error'
    default:
      return status >= 500 ? 'stt_upstream_error' : 'invalid_response'
  }
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) return false
  return (error as { name?: unknown }).name === 'AbortError'
}

function isKnownErrorCode(value: string): value is SttErrorCode {
  return Object.hasOwn(ERROR_COPY, value)
}

async function parseJsonBody(response: Response): Promise<unknown> {
  let raw = ''
  try {
    raw = await response.text()
  } catch {
    return null
  }
  if (raw.length === 0) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

export async function transcribeAudio(input: TranscribeInput): Promise<SttResult> {
  const mimeType = input.blob.type.trim()
  if (mimeType.length === 0) throw new SttError('unsupported_audio')

  const headers = new Headers({
    Authorization: `Bearer ${input.token}`,
    'Content-Type': mimeType,
    'X-Audio-Duration-Ms': String(Math.max(0, Math.round(input.durationMs))),
    Accept: 'application/json',
  })
  if (input.language !== undefined && input.language.trim().length > 0) {
    headers.set('X-Audio-Language', input.language.trim())
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS)
  const external = input.signal
  const forwardAbort = () => controller.abort()
  if (external !== undefined) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', forwardAbort, { once: true })
  }

  let response: Response
  try {
    response = await fetch('/api/transcribe', {
      method: 'POST',
      headers,
      body: input.blob,
      credentials: 'same-origin',
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) throw new SttError('stt_timeout')
    throw new SttError('network_error')
  } finally {
    clearTimeout(timeout)
    external?.removeEventListener('abort', forwardAbort)
  }

  const body = await parseJsonBody(response)
  const record = asRecord(body)

  if (!response.ok) {
    const rawCode = asString(record?.error)
    const code =
      rawCode !== undefined && isKnownErrorCode(rawCode) ? rawCode : statusToCode(response.status)
    const maxBytes = asNumber(record?.maxBytes)
    throw new SttError(code, maxBytes)
  }

  const text = asString(record?.text)
  if (text === undefined) throw new SttError('invalid_response')
  if (text.trim().length === 0) throw new SttError('empty_transcript')

  return {
    text,
    language: asString(record?.language) ?? 'zh',
    provider: asString(record?.provider) ?? 'unknown',
    model: asString(record?.model) ?? 'unknown',
    durationMs: asNumber(record?.durationMs) ?? input.durationMs,
    latencyMs: asNumber(record?.latencyMs) ?? 0,
  }
}

export interface SttHealth {
  enabled: boolean
  provider?: string
  model?: string
  reachable?: boolean
}

export class SttHealthUnavailableError extends Error {
  constructor(message = 'STT health is unavailable') {
    super(message)
    this.name = 'SttHealthUnavailableError'
  }
}

export async function fetchSttHealth(signal?: AbortSignal): Promise<SttHealth> {
  let response: Response
  try {
    response = await fetch('/api/health', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      ...(signal === undefined ? {} : { signal }),
    })
  } catch {
    throw new SttHealthUnavailableError()
  }
  if (!response.ok) throw new SttHealthUnavailableError()

  const body = await parseJsonBody(response)
  const record = asRecord(body)
  const stt = asRecord(record?.stt)
  const enabled = stt?.enabled
  if (typeof enabled !== 'boolean') throw new SttHealthUnavailableError()

  return {
    enabled,
    ...(asString(stt?.provider) === undefined ? {} : { provider: asString(stt?.provider) }),
    ...(asString(stt?.model) === undefined ? {} : { model: asString(stt?.model) }),
    ...(typeof stt?.reachable === 'boolean' ? { reachable: stt.reachable } : {}),
  }
}

export type SttHealthStatus = 'checking' | 'enabled' | 'disabled' | 'unavailable'

export interface SttHealthState {
  status: SttHealthStatus
  detail?: string
  provider?: string
  model?: string
}

export interface SttHealthApi {
  state: SttHealthState
  refresh: () => Promise<SttHealthState>
}

export function useSttHealth({ active, demo }: { active: boolean; demo: boolean }): SttHealthApi {
  const [state, setState] = useState<SttHealthState>(() =>
    demo ? { status: 'enabled', detail: '演示模式' } : { status: 'checking' },
  )
  const mountedRef = useRef(true)
  const requestRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async (): Promise<SttHealthState> => {
    if (demo) {
      const next: SttHealthState = { status: 'enabled', detail: '演示模式' }
      if (mountedRef.current) setState(next)
      return next
    }

    const requestId = requestRef.current + 1
    requestRef.current = requestId
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setState((previous) => ({ ...previous, status: 'checking' }))

    const timeout = setTimeout(() => controller.abort(), 4000)
    try {
      const health = await fetchSttHealth(controller.signal)
      const next: SttHealthState = health.enabled
        ? {
            status: 'enabled',
            ...(health.provider === undefined ? {} : { provider: health.provider }),
            ...(health.model === undefined ? {} : { model: health.model }),
          }
        : {
            status: 'disabled',
            detail: 'Bridge 未启用语音转写',
            ...(health.provider === undefined ? {} : { provider: health.provider }),
            ...(health.model === undefined ? {} : { model: health.model }),
          }
      if (mountedRef.current && requestRef.current === requestId) setState(next)
      return next
    } catch {
      const next: SttHealthState = { status: 'unavailable', detail: '语音服务状态未知' }
      if (mountedRef.current && requestRef.current === requestId) setState(next)
      return next
    } finally {
      clearTimeout(timeout)
    }
  }, [demo])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestRef.current += 1
      controllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (demo) {
      setState({ status: 'enabled', detail: '演示模式' })
      return
    }
    if (!active) {
      setState({ status: 'checking' })
      return
    }
    void refresh()
  }, [active, demo, refresh])

  useEffect(() => {
    if (!active || demo) return
    const handleOnline = (): void => {
      void refresh()
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [active, demo, refresh])

  return { state, refresh }
}
