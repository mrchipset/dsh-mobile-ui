export interface UploadedAudio {
  id: string
  mimeType: string
  playbackMimeType: string
  durationMs: number
  sizeBytes: number
  transcoded: boolean
}

export interface AudioMeta extends UploadedAudio {
  demo?: boolean
}

export type AudioErrorCode =
  | 'unauthorized'
  | 'session_gone'
  | 'audio_empty'
  | 'audio_duration_required'
  | 'invalid_audio_duration'
  | 'audio_too_long'
  | 'audio_too_large'
  | 'unsupported_audio'
  | 'audio_busy'
  | 'audio_not_found'
  | 'audio_upstream_error'
  | 'network_error'
  | 'invalid_response'

const AUDIO_ERROR_COPY: Record<AudioErrorCode, string> = {
  unauthorized: '访问令牌已失效，请重新连接 Bridge',
  session_gone: '会话已不存在',
  audio_empty: '没有可上传的录音',
  audio_duration_required: '录音时长缺失，请重新录制',
  invalid_audio_duration: '录音时长无效，请重新录制',
  audio_too_long: '录音超过 60 秒，已丢弃',
  audio_too_large: '录音文件过大，请缩短录音',
  unsupported_audio: '当前录音格式不受支持',
  audio_busy: '音频处理正忙，请稍后重试',
  audio_not_found: '语音已不存在',
  audio_upstream_error: '音频服务暂时不可用，请重试',
  network_error: '网络中断，无法访问语音服务',
  invalid_response: '音频服务返回了无法识别的结果',
}

export class AudioError extends Error {
  readonly code: AudioErrorCode
  readonly maxBytes: number | undefined

  constructor(code: AudioErrorCode, maxBytes?: number) {
    const limit =
      code === 'audio_too_large' && maxBytes !== undefined && maxBytes > 0
        ? `（上限 ${String(Math.max(1, Math.round(maxBytes / (1024 * 1024))))} MB）`
        : ''
    super(`${AUDIO_ERROR_COPY[code]}${limit}`)
    this.name = 'AudioError'
    this.code = code
    this.maxBytes = maxBytes
  }
}

interface UploadAudioInput {
  sessionId: string
  blob: Blob
  durationMs: number
  token: string
  signal?: AbortSignal
}

interface FetchAudioInput {
  audioId: string
  token: string
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

function isKnownError(value: string): value is AudioErrorCode {
  return Object.hasOwn(AUDIO_ERROR_COPY, value)
}

function statusToCode(status: number): AudioErrorCode {
  switch (status) {
    case 401:
      return 'unauthorized'
    case 404:
      return 'session_gone'
    case 413:
      return 'audio_too_large'
    case 415:
      return 'unsupported_audio'
    case 429:
      return 'audio_busy'
    default:
      return status >= 500 ? 'audio_upstream_error' : 'invalid_response'
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text()
    if (text.length === 0) return null
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

export async function uploadAudio(input: UploadAudioInput): Promise<UploadedAudio> {
  const mimeType = input.blob.type.trim()
  if (mimeType.length === 0) throw new AudioError('unsupported_audio')

  let response: Response
  try {
    response = await fetch(`/api/sessions/${encodeURIComponent(input.sessionId)}/audio`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.token}`,
        'Content-Type': mimeType,
        'X-Audio-Duration-Ms': String(Math.max(0, Math.round(input.durationMs))),
        Accept: 'application/json',
      },
      body: input.blob,
      credentials: 'same-origin',
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
  } catch {
    throw new AudioError('network_error')
  }

  const body = await readJson(response)
  const record = asRecord(body)
  if (!response.ok) {
    const rawCode = asString(record?.error)
    const code =
      rawCode !== undefined && isKnownError(rawCode) ? rawCode : statusToCode(response.status)
    throw new AudioError(code, asNumber(record?.maxBytes))
  }

  const id = asString(record?.id)
  const responseMime = asString(record?.mimeType)
  const playbackMimeType = asString(record?.playbackMimeType)
  const durationMs = asNumber(record?.durationMs)
  const sizeBytes = asNumber(record?.sizeBytes)
  const transcoded = record?.transcoded
  if (
    id === undefined ||
    id.length === 0 ||
    responseMime === undefined ||
    playbackMimeType === undefined ||
    durationMs === undefined ||
    sizeBytes === undefined ||
    typeof transcoded !== 'boolean'
  ) {
    throw new AudioError('invalid_response')
  }

  return { id, mimeType: responseMime, playbackMimeType, durationMs, sizeBytes, transcoded }
}

export async function fetchAudioBlob(input: FetchAudioInput): Promise<Blob> {
  let response: Response
  try {
    response = await fetch(`/api/audio/${encodeURIComponent(input.audioId)}`, {
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: 'audio/*',
      },
      credentials: 'same-origin',
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
  } catch {
    throw new AudioError('network_error')
  }

  if (!response.ok) {
    if (response.status === 401) throw new AudioError('unauthorized')
    if (response.status === 404) throw new AudioError('audio_not_found')
    throw new AudioError(response.status >= 500 ? 'audio_upstream_error' : 'invalid_response')
  }

  let blob: Blob
  try {
    blob = await response.blob()
  } catch {
    throw new AudioError('network_error')
  }
  if (blob.size === 0) throw new AudioError('invalid_response')
  if (blob.type.length > 0) return blob

  const headerType = response.headers.get('content-type')?.trim() ?? ''
  return headerType.length > 0 ? new Blob([blob], { type: headerType }) : blob
}

export function formatAudioDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index))
  }
}

/** Small local-only WAV used to exercise preview/player UI in demo mode. */
export function createDemoWavBlob(durationMs: number): Blob {
  const sampleRate = 8000
  const safeDuration = Math.max(0.2, Math.min(60, durationMs / 1000))
  const frames = Math.max(1, Math.floor(sampleRate * safeDuration))
  const dataBytes = frames * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / sampleRate
    const envelope = Math.min(1, frame / 320, (frames - frame) / 320)
    const sample = Math.sin(2 * Math.PI * 392 * time) * 0.16 * envelope
    view.setInt16(44 + frame * 2, Math.round(sample * 32767), true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

const audioMeta = new Map<string, AudioMeta>()
const localAudio = new Map<string, Blob>()
const remoteUrls = new Map<string, { url: string; refs: number }>()
const pendingRemoteUrls = new Map<string, Promise<string>>()

export function rememberAudioMeta(meta: AudioMeta): void {
  audioMeta.set(meta.id, { ...meta })
}

export function getAudioMeta(audioId: string): AudioMeta | undefined {
  return audioMeta.get(audioId)
}

export function createAudioId(prefix = 'audio-'): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi !== undefined && typeof cryptoApi.randomUUID === 'function') {
    return `${prefix}${cryptoApi.randomUUID()}`
  }
  return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createDemoAudioMeta(clip: {
  blob: Blob
  mimeType: string
  durationMs: number
}): AudioMeta {
  const meta: AudioMeta = {
    id: createAudioId('demo-audio-'),
    mimeType: clip.mimeType,
    playbackMimeType: clip.mimeType,
    durationMs: clip.durationMs,
    sizeBytes: clip.blob.size,
    transcoded: true,
    demo: true,
  }
  rememberAudioMeta(meta)
  localAudio.set(meta.id, clip.blob)
  return meta
}

export function getLocalAudioBlob(audioId: string): Blob | undefined {
  return localAudio.get(audioId)
}

export function clearLocalAudio(): void {
  localAudio.clear()
  for (const [id, meta] of audioMeta) {
    if (meta.demo === true) audioMeta.delete(id)
  }
}

export async function acquireRemoteAudioUrl(audioId: string, token: string): Promise<string> {
  const cached = remoteUrls.get(audioId)
  if (cached !== undefined) {
    cached.refs += 1
    return cached.url
  }

  const existing = pendingRemoteUrls.get(audioId)
  const pending =
    existing ??
    fetchAudioBlob({ audioId, token }).then((blob) => {
      const url = URL.createObjectURL(blob)
      remoteUrls.set(audioId, { url, refs: 0 })
      return url
    })

  if (existing === undefined) {
    pendingRemoteUrls.set(audioId, pending)
    pending.finally(() => pendingRemoteUrls.delete(audioId)).catch(() => undefined)
  }

  const url = await pending
  const entry = remoteUrls.get(audioId)
  if (entry !== undefined) entry.refs += 1
  return url
}

export function releaseRemoteAudioUrl(audioId: string): void {
  const entry = remoteUrls.get(audioId)
  if (entry === undefined) return
  entry.refs -= 1
  if (entry.refs > 0) return
  URL.revokeObjectURL(entry.url)
  remoteUrls.delete(audioId)
}
