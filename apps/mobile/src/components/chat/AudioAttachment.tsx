import type { AudioAttachment as AudioAttachmentData } from '@dsh-mobile/protocol'
import { AlertTriangle, Pause, Play, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  AudioError,
  acquireRemoteAudioUrl,
  formatAudioDuration,
  getAudioMeta,
  getLocalAudioBlob,
  isNotAllowedPlaybackError,
  mediaPlaybackErrorMessage,
  releaseRemoteAudioUrl,
  shouldShowCompatibilityWarning,
  type UploadedAudio,
} from '../../lib/audio'
import { cn } from '../../lib/utils'
import type { VoiceClip } from '../../lib/voice-recorder'
import { useBridgeStore } from '../../store/useBridgeStore'
import { Spinner } from '../ui/Spinner'

type AudioTone = 'surface' | 'bubble'
type PlaybackStatus = 'idle' | 'loading' | 'ready' | 'error'

interface AudioPlayerProps {
  audioId?: string
  blob?: Blob
  durationMs: number
  label: string
  tone: AudioTone
  demo?: boolean
  warning?: string
  disabled?: boolean
  className?: string
}

const WARNING_COPY = '播放副本保留原始格式，iPhone 兼容性可能有限'

function audioErrorCopy(error: unknown): string {
  if (error instanceof AudioError) return error.message
  return '音频加载失败，请重试'
}

function AudioPlayer({
  audioId,
  blob,
  durationMs,
  label,
  tone,
  demo,
  warning,
  disabled = false,
  className,
}: AudioPlayerProps) {
  const token = useBridgeStore((state) => state.authToken)
  const localBlob = blob ?? (audioId === undefined ? undefined : getLocalAudioBlob(audioId))
  const meta = audioId === undefined ? undefined : getAudioMeta(audioId)
  const isDemo = demo === true || meta?.demo === true
  const audioRef = useRef<HTMLAudioElement>(null)
  const localUrlRef = useRef<string | null>(null)
  const remoteAcquiredRef = useRef(false)
  const remoteAbortRef = useRef<AbortController | null>(null)
  const audioIdRef = useRef(audioId)
  const mountedRef = useRef(true)
  audioIdRef.current = audioId
  const sourceMime = localBlob?.type ?? meta?.playbackMimeType ?? ''

  const [status, setStatus] = useState<PlaybackStatus>(() =>
    localBlob === undefined ? 'idle' : 'ready',
  )
  const [playing, setPlaying] = useState(false)
  const [currentMs, setCurrentMs] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    setPlaying(false)
    setCurrentMs(0)
    setError(null)
    setStatus(localBlob === undefined ? 'idle' : 'ready')

    let localUrl: string | null = null
    if (audio !== null) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    if (localBlob !== undefined) {
      localUrl = URL.createObjectURL(localBlob)
      localUrlRef.current = localUrl
      if (audio !== null) {
        audio.src = localUrl
        audio.load()
      }
    }

    return () => {
      remoteAbortRef.current?.abort()
      remoteAbortRef.current = null
      if (audio !== null) {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      }
      if (localUrl !== null) URL.revokeObjectURL(localUrl)
      localUrlRef.current = null
      if (remoteAcquiredRef.current && audioId !== undefined) {
        releaseRemoteAudioUrl(audioId)
      }
      remoteAcquiredRef.current = false
    }
  }, [audioId, localBlob])

  async function togglePlay(): Promise<void> {
    const audio = audioRef.current
    if (audio === null || disabled || status === 'loading') return

    if (playing) {
      audio.pause()
      return
    }
    if (status === 'error') {
      setError(null)
      setStatus(localBlob === undefined ? 'idle' : 'ready')
    }

    if (audio.src.length === 0) {
      if (localBlob !== undefined) {
        const localUrl = localUrlRef.current ?? URL.createObjectURL(localBlob)
        localUrlRef.current = localUrl
        audio.src = localUrl
        audio.load()
        setStatus('ready')
      } else {
        if (audioId === undefined) return
        const requestedId = audioId
        const controller = new AbortController()
        remoteAbortRef.current = controller
        setStatus('loading')
        setError(null)
        try {
          const url = await acquireRemoteAudioUrl(requestedId, token, controller.signal)
          if (!mountedRef.current || audioIdRef.current !== requestedId) {
            releaseRemoteAudioUrl(requestedId)
            return
          }
          remoteAcquiredRef.current = true
          audio.src = url
          audio.load()
          setStatus('ready')
        } catch (loadError) {
          if (!mountedRef.current || audioIdRef.current !== requestedId) return
          setStatus('error')
          setError(audioErrorCopy(loadError))
          return
        } finally {
          if (remoteAbortRef.current === controller) remoteAbortRef.current = null
        }
      }
    }

    try {
      await audio.play()
    } catch (playError) {
      if (!mountedRef.current) return
      if (isNotAllowedPlaybackError(playError)) {
        setStatus('ready')
        setError('浏览器暂停了播放，请再点一次播放')
        return
      }
      setStatus('error')
      setError(mediaPlaybackErrorMessage(sourceMime))
    }
  }

  const bubble = tone === 'bubble'
  const progress = durationMs > 0 ? Math.min(1, currentMs / durationMs) : 0
  const buttonLabel =
    status === 'loading'
      ? '正在加载语音'
      : status === 'error'
        ? '重试播放语音'
        : playing
          ? '暂停语音'
          : '播放语音'

  return (
    <fieldset
      aria-label={label}
      data-testid="audio-player"
      data-audio-id={audioId}
      className={cn(
        'm-0 min-w-0 border-0 p-0',
        bubble && 'rounded-[14px] border border-bubble-ink/15 bg-bubble-ink/[0.06] p-1 pr-2',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={() => {
            void togglePlay()
          }}
          disabled={disabled || status === 'loading'}
          aria-label={buttonLabel}
          className={cn(
            'tap flex size-11 shrink-0 items-center justify-center rounded-full border transition',
            bubble
              ? 'border-bubble-ink/20 bg-bubble-ink/10 text-bubble-ink hover:bg-bubble-ink/15'
              : 'border-line bg-ink-900 text-signal hover:border-signal/30',
            (disabled || status === 'loading') && 'opacity-60',
          )}
        >
          {status === 'loading' ? (
            <Spinner className="size-4" label="正在加载语音" />
          ) : playing ? (
            <Pause aria-hidden className="size-4" strokeWidth={2} />
          ) : (
            <Play aria-hidden className="size-4" strokeWidth={2} />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                'truncate font-mono text-[8.5px] tracking-[0.1em]',
                bubble ? 'text-bubble-ink/65' : 'text-mute',
              )}
            >
              {label}
            </span>
            {isDemo ? (
              <span
                className={cn(
                  'shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[8px] leading-none',
                  bubble
                    ? 'border-bubble-ink/20 bg-bubble-ink/10 text-bubble-ink/70'
                    : 'border-ice/20 bg-ice/10 text-ice',
                )}
              >
                模拟
              </span>
            ) : null}
            <span
              className={cn(
                'ml-auto shrink-0 font-mono text-[9px] tabular-nums',
                bubble ? 'text-bubble-ink/65' : 'text-mute',
              )}
            >
              {formatAudioDuration(currentMs)} / {formatAudioDuration(durationMs)}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="语音播放进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            className={cn(
              'mt-1 h-1 overflow-hidden rounded-full',
              bubble ? 'bg-bubble-ink/15' : 'bg-track',
            )}
          >
            <div
              className={cn('h-full rounded-full', bubble ? 'bg-bubble-ink/70' : 'bg-signal')}
              style={{ width: `${String(progress * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {error !== null ? (
        <p
          role="alert"
          className={cn(
            'mt-1 px-1 text-[9.5px] leading-4',
            bubble ? 'text-bubble-ink/80' : 'text-coral',
          )}
        >
          {error}
        </p>
      ) : null}
      {warning !== undefined ? (
        <p
          className={cn(
            'mt-1 flex items-start gap-1.5 px-1 text-[9.5px] leading-4',
            bubble ? 'text-bubble-ink/75' : 'text-amber',
          )}
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" />
          <span>{warning}</span>
        </p>
      ) : null}

      {/* Voice clips are transcribed into the visible message text; a caption track is not applicable. */}
      {/* biome-ignore lint/a11y/useMediaCaption: voice transcript is rendered in the message bubble */}
      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={(event) => {
          const audio = event.currentTarget
          setCurrentMs(Number.isFinite(audio.currentTime) ? audio.currentTime * 1000 : 0)
        }}
        onPlay={() => {
          setPlaying(true)
          setStatus('ready')
          setError(null)
        }}
        onPause={() => setPlaying(false)}
        onEnded={(event) => {
          setPlaying(false)
          setCurrentMs(0)
          event.currentTarget.currentTime = 0
        }}
        onError={(event) => {
          const audio = event.currentTarget
          if (audio.currentSrc.length === 0) return
          audio.pause()
          audio.removeAttribute('src')
          audio.load()
          if (remoteAcquiredRef.current && audioId !== undefined) {
            releaseRemoteAudioUrl(audioId)
            remoteAcquiredRef.current = false
          }
          setPlaying(false)
          setCurrentMs(0)
          setStatus('error')
          setError(mediaPlaybackErrorMessage(sourceMime))
        }}
        className="hidden"
      />
    </fieldset>
  )
}

export function PendingAudioChip({
  clip,
  uploaded,
  sending,
  demo,
  onRemove,
}: {
  clip: VoiceClip
  uploaded?: UploadedAudio
  sending: boolean
  demo: boolean
  onRemove: () => void
}) {
  const warning =
    uploaded !== undefined && shouldShowCompatibilityWarning({ ...uploaded, demo })
      ? WARNING_COPY
      : undefined

  return (
    <div className="animate-fade-in mb-2 flex items-center gap-2 rounded-[20px] border border-line bg-ink-850/90 py-1.5 pl-2 pr-1.5">
      <AudioPlayer
        blob={clip.blob}
        durationMs={clip.durationMs}
        label={sending ? '正在发送语音' : '待发送语音'}
        tone="surface"
        demo={demo}
        warning={warning}
        disabled={sending}
        className="min-w-0 flex-1"
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={sending}
        aria-label="移除语音"
        className="tap flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-ink-900 text-mute transition hover:border-coral/30 hover:bg-coral/10 hover:text-coral disabled:opacity-40"
      >
        <Trash2 aria-hidden className="size-4" />
      </button>
    </div>
  )
}

export function MessageAudio({ attachment }: { attachment: AudioAttachmentData }) {
  const meta = getAudioMeta(attachment.id)
  const warning = shouldShowCompatibilityWarning(meta) ? WARNING_COPY : undefined
  return (
    <AudioPlayer
      audioId={attachment.id}
      durationMs={attachment.durationMs}
      label="语音"
      tone="bubble"
      demo={meta?.demo === true}
      warning={warning}
      className="mt-2.5"
    />
  )
}
