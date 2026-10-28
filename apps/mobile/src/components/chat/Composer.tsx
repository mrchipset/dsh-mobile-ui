import type { SessionSummary } from '@dsh-mobile/protocol'
import { ArrowUp, LockKeyhole, ShieldAlert, Square } from 'lucide-react'
import { type KeyboardEvent, useRef, useState } from 'react'
import { cn } from '../../lib/utils'
import { firstIssue, promptSchema } from '../../lib/validation'
import type { AppMode, StoreStatus } from '../../store/useBridgeStore'
import { Spinner } from '../ui/Spinner'

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
  const connected = mode === 'demo' || status === 'ready'
  const running = session.running
  const sendDisabled = !connected || !canPrompt || running || draft.trim().length === 0

  function resizeTextarea() {
    const element = textareaRef.current
    if (element === null) return
    element.style.height = '0px'
    element.style.height = `${String(Math.min(element.scrollHeight, 138))}px`
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

  return (
    <div className="safe-bottom relative z-30 shrink-0 border-t border-line/60 bg-ink-950/88 px-4 pt-2.5 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-[560px]">
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

        {error !== null ? (
          <p role="alert" className="mb-1.5 px-1 text-[11px] text-coral">
            {error}
          </p>
        ) : null}

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
            onClick={submit}
            disabled={sendDisabled}
            aria-label="发送消息"
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-full transition',
              sendDisabled
                ? 'bg-white/[0.06] text-mute'
                : 'bg-signal text-[#0a1006] shadow-[0_10px_26px_-10px_rgba(201,247,90,0.7)] active:scale-95',
            )}
          >
            <ArrowUp className="size-5" strokeWidth={2.2} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 px-1.5 pb-1.5 pt-1.5">
          <span className="truncate font-mono text-[9px] tracking-[0.04em] text-mute/80">
            {mode === 'demo'
              ? '演示模式 · 回复与审批均为模拟'
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
