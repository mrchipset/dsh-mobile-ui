import { Mic, Square, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { VoiceState } from '../../lib/voice-recorder'
import { Spinner } from '../ui/Spinner'

interface VoiceBarProps {
  state: VoiceState
  elapsedMs: number
  level: number
  demo: boolean
  onCancel: () => void
  onStop: () => void
}

const METER_BARS = [
  { id: 'a', weight: 0.56 },
  { id: 'b', weight: 0.82 },
  { id: 'c', weight: 1 },
  { id: 'd', weight: 0.68 },
  { id: 'e', weight: 0.9 },
  { id: 'f', weight: 0.6 },
]

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`
}

export function VoiceBar({ state, elapsedMs, level, demo, onCancel, onStop }: VoiceBarProps) {
  if (state === 'idle' || state === 'error') return null

  const recording = state === 'recording'
  const transcribing = state === 'transcribing'

  return (
    <fieldset
      aria-label="语音录制"
      data-voice-state={state}
      className={cn(
        'animate-fade-in m-0 mb-2 flex min-h-[54px] min-w-0 items-center gap-2.5 rounded-[20px] border px-2.5 py-2',
        recording ? 'border-coral/25 bg-coral/[0.06]' : 'border-line bg-ink-850/85',
      )}
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full border',
          recording
            ? 'border-coral/25 bg-coral/10 text-coral'
            : transcribing
              ? 'border-signal/25 bg-signal/10 text-signal'
              : 'border-line bg-ink-900 text-mist',
        )}
      >
        {recording ? (
          <span className="beacon relative size-2 rounded-full bg-coral" />
        ) : transcribing ? (
          <Spinner className="size-4 text-signal" label="正在转写" />
        ) : (
          <Mic aria-hidden className="size-4" strokeWidth={1.8} />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-[9px] tracking-[0.12em] text-mute">
            {recording ? 'RECORDING' : transcribing ? 'TRANSCRIBING' : 'REQUESTING MIC'}
          </span>
          {demo ? (
            <span className="shrink-0 rounded-full border border-ice/20 bg-ice/10 px-1.5 py-0.5 font-mono text-[8px] leading-none text-ice">
              模拟
            </span>
          ) : null}
          {!recording ? (
            <span className="ml-auto shrink-0 font-mono text-[9px] tabular-nums text-mute">
              {formatElapsed(elapsedMs)}
            </span>
          ) : null}
        </div>

        <div className="mt-1 flex min-w-0 items-center gap-2">
          {recording ? (
            <>
              <span className="shrink-0 font-mono text-[15px] font-medium leading-none tabular-nums text-bone">
                {formatElapsed(elapsedMs)}
              </span>
              <span aria-hidden className="flex h-4 shrink-0 items-end gap-[2px]">
                {METER_BARS.map((bar) => (
                  <span
                    key={bar.id}
                    className="w-[2.5px] origin-bottom rounded-full bg-coral/80 transition-transform duration-100 ease-out"
                    style={{
                      height: '100%',
                      transform: `scaleY(${String(0.16 + level * bar.weight * 0.84)})`,
                    }}
                  />
                ))}
              </span>
              <span className="hidden truncate text-[10px] leading-4 text-mist min-[360px]:inline">
                松开转写
              </span>
            </>
          ) : (
            <span className="truncate text-[11px] leading-5 text-mist">
              {transcribing
                ? demo
                  ? '模拟识别中，不会上传音频'
                  : '上传音频并等待识别'
                : '等待浏览器麦克风权限'}
            </span>
          )}
        </div>
      </div>

      {recording ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onCancel}
            aria-label="取消录音"
            className="tap flex size-11 items-center justify-center rounded-full border border-line bg-ink-900 text-mute transition hover:border-coral/30 hover:bg-coral/10 hover:text-coral"
          >
            <X aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            onClick={onStop}
            aria-label="停止并转写"
            className="tap flex size-11 items-center justify-center rounded-full bg-signal text-on-signal shadow-primary transition active:scale-95"
          >
            <Square aria-hidden className="size-3 fill-current" />
          </button>
        </div>
      ) : transcribing ? null : (
        <button
          type="button"
          onClick={onCancel}
          aria-label="取消录音"
          className="tap flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-ink-900 text-mute transition hover:border-coral/30 hover:text-coral"
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
    </fieldset>
  )
}
