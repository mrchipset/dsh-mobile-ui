import type { SessionSummary } from '@dsh-mobile/protocol'
import { ArrowUp, LockKeyhole, Mic, MicOff, ShieldAlert, Square } from 'lucide-react'
import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from 'react'
import { SttError, transcribeAudio, useSttHealth } from '../../lib/stt'
import { cn } from '../../lib/utils'
import { firstIssue, promptSchema } from '../../lib/validation'
import { useVoiceRecorder, type VoiceClip } from '../../lib/voice-recorder'
import { type AppMode, type StoreStatus, useBridgeStore } from '../../store/useBridgeStore'
import { Spinner } from '../ui/Spinner'
import { VoiceBar } from './VoiceBar'

interface ComposerProps {
  session: SessionSummary
  mode: AppMode
  status: StoreStatus
  canPrompt: boolean
  cancelling: boolean
  permissionPending: boolean
  onSend: (text: string) => boolean
  onCancel: () => void
  onOpenLease: () => void
  onOpenPermission: () => void
}

function voiceEnvironmentIssue(mode: AppMode): string | null {
  if (mode === 'demo') return null
  if (typeof window === 'undefined') return '当前环境不支持录音'
  if (!window.isSecureContext) return '需要 HTTPS 或 localhost'
  if (typeof MediaRecorder === 'undefined') return '当前浏览器不支持录音'
  if (
    navigator.mediaDevices === undefined ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    return '当前浏览器不支持录音'
  }
  return null
}

export function Composer({
  session,
  mode,
  status,
  canPrompt,
  cancelling,
  permissionPending,
  onSend,
  onCancel,
  onOpenLease,
  onOpenPermission,
}: ComposerProps) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const draftRef = useRef('')
  const pointerHandledRef = useRef(false)
  const holdPointerRef = useRef<number | null>(null)
  const authToken = useBridgeStore((state) => state.authToken)

  const connected = mode === 'demo' || status === 'ready'
  const running = session.running
  const environmentIssue = voiceEnvironmentIssue(mode)
  const stt = useSttHealth({ active: mode === 'live' && status === 'ready', demo: mode === 'demo' })

  function resizeTextarea() {
    const element = textareaRef.current
    if (element === null) return
    element.style.height = '0px'
    element.style.height = `${String(Math.min(element.scrollHeight, 138))}px`
  }

  function insertTranscript(text: string) {
    const cleaned = text.trim()
    if (cleaned.length === 0) return

    const textarea = textareaRef.current
    const current = draftRef.current
    const start = textarea?.selectionStart ?? current.length
    const end = textarea?.selectionEnd ?? current.length
    const before = current.slice(0, Math.max(0, Math.min(start, current.length)))
    const after = current.slice(Math.max(0, Math.max(start, end)))
    const leadingSpace = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
    const trailingSpace = after.length > 0 && !/^\s/.test(after) ? ' ' : ''
    const next = `${before}${leadingSpace}${cleaned}${trailingSpace}${after}`

    draftRef.current = next
    setDraft(next)
    setError(null)

    requestAnimationFrame(() => {
      const target = textareaRef.current
      if (target === null) return
      target.focus()
      const cursor = before.length + leadingSpace.length + cleaned.length
      target.setSelectionRange(cursor, cursor)
      resizeTextarea()
    })
  }

  async function transcribeClip(clip: VoiceClip): Promise<string> {
    try {
      const result = await transcribeAudio({
        blob: clip.blob,
        durationMs: clip.durationMs,
        token: authToken,
        language: 'zh',
      })
      return result.text
    } catch (transcriptionError) {
      if (transcriptionError instanceof SttError && transcriptionError.code === 'stt_disabled') {
        void stt.refresh()
      }
      throw transcriptionError
    }
  }

  const voice = useVoiceRecorder({
    demo: mode === 'demo',
    transcribe: transcribeClip,
    onTranscript: insertTranscript,
  })

  const sttDisabled = mode !== 'demo' && stt.state.status === 'disabled'
  const sttUnavailable = mode !== 'demo' && stt.state.status === 'unavailable'
  const voiceBusy =
    voice.state === 'requesting' || voice.state === 'recording' || voice.state === 'transcribing'
  const sendDisabled = !connected || !canPrompt || running || voiceBusy || draft.trim().length === 0

  const micDisabledReason = !connected
    ? '连接中断'
    : !canPrompt
      ? '写权在另一台设备上'
      : running
        ? 'DSH 正在运行'
        : environmentIssue !== null
          ? environmentIssue
          : sttDisabled
            ? 'Bridge 未启用语音转写'
            : voice.state === 'transcribing'
              ? '正在转写'
              : null
  const micDisabled = micDisabledReason !== null

  const micLabel = micDisabled
    ? `语音输入不可用（${micDisabledReason}）`
    : voice.state === 'recording'
      ? '停止录音并转写'
      : voice.state === 'requesting'
        ? '取消录音请求'
        : voice.state === 'transcribing'
          ? '正在转写语音'
          : '按住说话，或点击开始录音'

  function toggleVoice() {
    if (micDisabled) return
    if (voice.state === 'recording' || voice.state === 'requesting') {
      voice.stop()
      return
    }
    if (voice.state !== 'transcribing') void voice.start()
  }

  function handleMicClick(event: ReactMouseEvent<HTMLButtonElement>) {
    if (event.detail > 0 && pointerHandledRef.current) {
      pointerHandledRef.current = false
      return
    }
    toggleVoice()
  }

  function handleMicPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (micDisabled || event.button !== 0) return
    pointerHandledRef.current = true
    holdPointerRef.current = event.pointerId
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best-effort across browsers.
    }
    if (voice.state !== 'recording' && voice.state !== 'requesting') void voice.start()
  }

  function releaseMicPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    if (holdPointerRef.current !== event.pointerId) return
    holdPointerRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // Capture may already be gone.
      }
    }
    voice.stop()
    setTimeout(() => {
      pointerHandledRef.current = false
    }, 400)
  }

  function submit() {
    const parsed = promptSchema.safeParse(draft)
    if (!parsed.success) {
      setError(firstIssue(parsed.error))
      return
    }
    const accepted = onSend(parsed.data)
    if (!accepted) return
    setDraft('')
    draftRef.current = ''
    setError(null)
    requestAnimationFrame(resizeTextarea)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (!sendDisabled) submit()
    }
  }

  const placeholder = !connected
    ? '连接中断，正在重连…'
    : !canPrompt
      ? '写权在另一台设备上'
      : running
        ? '正在运行，可先输入下一句'
        : mode === 'demo'
          ? '说点什么，试试演示…'
          : '说点什么…'

  const visibleError = error ?? voice.error
  const voiceAnnouncement =
    voice.state === 'requesting'
      ? '正在请求麦克风'
      : voice.state === 'recording'
        ? '正在录音'
        : voice.state === 'transcribing'
          ? '正在转写语音'
          : ''

  return (
    <div className="safe-bottom relative z-30 shrink-0 border-t border-line/60 bg-ink-950/88 px-4 pt-2.5 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-[560px]">
        <span role="status" aria-live="polite" className="sr-only">
          {voiceAnnouncement}
        </span>

        {running ? (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-2xl border border-signal/15 bg-signal/[0.055] px-3.5 py-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="equalizer text-signal" aria-hidden>
                <span />
                <span />
                <span />
                <span />
              </span>
              <p className="truncate text-[11.5px] text-mist">
                {cancelling ? '正在停止生成…' : 'DSH 正在处理这一轮'}
              </p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              disabled={cancelling}
              className="tap flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-ink-850 px-3 text-[11px] font-medium text-coral transition hover:border-coral/35 hover:bg-coral/10 disabled:opacity-50"
            >
              {cancelling ? (
                <Spinner className="text-coral" />
              ) : (
                <Square className="size-3 fill-current" />
              )}
              {cancelling ? '停止中' : '停止'}
            </button>
          </div>
        ) : null}

        {!canPrompt && connected ? (
          <button
            type="button"
            onClick={onOpenLease}
            className="mb-2 flex w-full items-center justify-between gap-3 rounded-2xl border border-amber/20 bg-amber/[0.055] px-3.5 py-2 text-left"
          >
            <span className="flex min-w-0 items-center gap-2">
              <LockKeyhole className="size-3.5 shrink-0 text-amber" />
              <span className="truncate text-[11.5px] text-mist">写权在另一台设备上</span>
            </span>
            <span className="shrink-0 text-[11px] font-medium text-amber">接管写权</span>
          </button>
        ) : null}

        {permissionPending ? (
          <button
            type="button"
            onClick={onOpenPermission}
            className="mb-2 flex w-full items-center justify-between gap-3 rounded-2xl border border-coral/20 bg-coral/[0.06] px-3.5 py-2 text-left"
          >
            <span className="flex min-w-0 items-center gap-2">
              <ShieldAlert className="size-3.5 shrink-0 text-coral" />
              <span className="truncate text-[11.5px] text-mist">有一个工具调用在等你审批</span>
            </span>
            <span className="shrink-0 text-[11px] font-medium text-coral">查看</span>
          </button>
        ) : null}

        {!connected ? (
          <div className="mb-2 flex items-center gap-2 rounded-2xl border border-amber/20 bg-amber/[0.055] px-3.5 py-2">
            <span className="size-1.5 animate-pulse rounded-full bg-amber" />
            <p className="text-[11.5px] text-mist">连接中断，恢复后会自动续上</p>
          </div>
        ) : null}

        {connected && environmentIssue !== null ? (
          <div className="mb-2 flex items-center gap-2 rounded-2xl border border-amber/20 bg-amber/[0.055] px-3.5 py-2.5">
            <MicOff aria-hidden className="size-3.5 shrink-0 text-amber" />
            <p className="text-[11.5px] leading-5 text-mist">语音输入不可用 · {environmentIssue}</p>
          </div>
        ) : null}

        {connected && environmentIssue === null && sttDisabled ? (
          <button
            type="button"
            onClick={() => void stt.refresh()}
            className="mb-2 flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-amber/20 bg-amber/[0.055] px-3.5 py-2.5 text-left"
          >
            <span className="flex min-w-0 items-center gap-2">
              <MicOff aria-hidden className="size-3.5 shrink-0 text-amber" />
              <span className="truncate text-[11.5px] text-mist">Bridge 未启用语音转写</span>
            </span>
            <span className="shrink-0 text-[11px] font-medium text-amber">重新检测</span>
          </button>
        ) : null}

        {connected && environmentIssue === null && sttUnavailable ? (
          <button
            type="button"
            onClick={() => void stt.refresh()}
            className="mb-2 flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-line bg-wash-soft px-3.5 py-2.5 text-left"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Mic aria-hidden className="size-3.5 shrink-0 text-mute" />
              <span className="truncate text-[11.5px] text-mist">语音服务状态未知</span>
            </span>
            <span className="shrink-0 text-[11px] font-medium text-mute">重试检测</span>
          </button>
        ) : null}

        {visibleError !== null ? (
          <p role="alert" className="mb-1.5 px-1 text-[11px] text-coral">
            {visibleError}
          </p>
        ) : null}

        <VoiceBar
          state={voice.state}
          elapsedMs={voice.elapsedMs}
          level={voice.level}
          demo={mode === 'demo'}
          onCancel={voice.cancel}
          onStop={voice.stop}
        />

        <div
          className={cn(
            'composer-shell flex items-end gap-2 rounded-[24px] border border-line bg-ink-850/95 p-1.5 pl-4',
            !connected && 'opacity-70',
          )}
        >
          <label htmlFor="composer-input" className="sr-only">
            给 DSH 发消息
          </label>
          <textarea
            ref={textareaRef}
            id="composer-input"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              draftRef.current = event.target.value
              if (error !== null) setError(null)
              resizeTextarea()
            }}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={placeholder}
            enterKeyHint="enter"
            className="max-h-[138px] min-h-[44px] flex-1 resize-none bg-transparent py-2.5 pr-1 text-[14px] leading-6 text-bone outline-none placeholder:text-mute/70"
          />
          <button
            type="button"
            data-testid="voice-mic"
            onClick={handleMicClick}
            onPointerDown={handleMicPointerDown}
            onPointerUp={releaseMicPointer}
            onPointerCancel={releaseMicPointer}
            onContextMenu={(event) => event.preventDefault()}
            disabled={micDisabled}
            aria-label={micLabel}
            aria-pressed={voice.state === 'recording'}
            aria-busy={voice.state === 'requesting' || voice.state === 'transcribing'}
            title={micLabel}
            className={cn(
              'flex size-11 shrink-0 touch-none select-none items-center justify-center rounded-full border transition-[background-color,border-color,color,transform]',
              voice.state === 'recording'
                ? 'border-coral/35 bg-coral/10 text-coral'
                : voice.state === 'transcribing' || voice.state === 'requesting'
                  ? 'border-signal/25 bg-signal/10 text-signal'
                  : micDisabled
                    ? 'border-line bg-wash-soft text-mute/60'
                    : 'border-line bg-ink-900 text-mist hover:border-ink-500 hover:text-bone active:scale-95',
            )}
          >
            {voice.state === 'transcribing' || voice.state === 'requesting' ? (
              <Spinner
                className="size-4 text-signal"
                label={voice.state === 'transcribing' ? '正在转写' : '正在请求麦克风'}
              />
            ) : sttDisabled || environmentIssue !== null ? (
              <MicOff aria-hidden className="size-[18px]" strokeWidth={1.8} />
            ) : (
              <Mic aria-hidden className="size-[18px]" strokeWidth={1.8} />
            )}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={sendDisabled}
            aria-label="发送消息"
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-full transition',
              sendDisabled
                ? 'bg-wash text-mute'
                : 'bg-signal text-on-signal shadow-primary active:scale-95',
            )}
          >
            <ArrowUp className="size-5" strokeWidth={2.2} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 px-1.5 pb-1.5 pt-1.5">
          <span className="truncate font-mono text-[9px] tracking-[0.04em] text-mute/80">
            {mode === 'demo'
              ? '演示模式 · 回复、审批与语音均为模拟'
              : canPrompt
                ? 'Enter 换行 · ⌘/Ctrl + Enter 发送'
                : '只读 · 接管写权后可输入'}
          </span>
          <span className="shrink-0 font-mono text-[9px] tabular-nums text-mute/70">
            {draft.length > 0 ? `${draft.length} 字符` : '64k 上限'}
          </span>
        </div>
      </div>
    </div>
  )
}
