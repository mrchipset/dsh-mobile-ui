import type { PermissionOption, PermissionRequest } from '@dsh-mobile/protocol'
import { Check, Clock, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '../../lib/utils'
import type { AppMode } from '../../store/useBridgeStore'
import { Sheet } from '../ui/Sheet'

const TTL_SECONDS = 180

function optionCopy(option: PermissionOption): string {
  switch (option.kind) {
    case 'allow_once':
      return '允许一次'
    case 'allow_always':
      return '始终允许'
    case 'reject_once':
      return '拒绝一次'
    case 'reject_always':
      return '始终拒绝'
    default:
      return option.name
  }
}

function optionRank(option: PermissionOption): number {
  switch (option.kind) {
    case 'allow_once':
      return 0
    case 'allow_always':
      return 1
    case undefined:
      return 2
    case 'reject_once':
      return 3
    case 'reject_always':
      return 4
  }
}

function formatRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${String(minutes)}:${String(rest).padStart(2, '0')}`
}

interface PermissionSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  request: PermissionRequest
  receivedAt: number | null
  sessionTitle: string
  mode: AppMode
  isWriter: boolean
  busyOptionId: string | null
  onAnswer: (requestId: string, optionId: string) => void
}

export function PermissionSheet({
  open,
  onOpenChange,
  request,
  receivedAt,
  sessionTitle,
  mode,
  isWriter,
  busyOptionId,
  onAnswer,
}: PermissionSheetProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [open])

  const elapsed = receivedAt === null ? 0 : Math.max(0, Math.floor((now - receivedAt) / 1000))
  const remaining = Math.max(0, TTL_SECONDS - elapsed)
  const percent = Math.max(0, Math.min(100, (remaining / TTL_SECONDS) * 100))
  const expired = remaining === 0
  const options = [...request.options].sort((left, right) => optionRank(left) - optionRank(right))

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="PERMISSION · 写权设备"
      title="需要你的确认"
      description={
        isWriter
          ? `来自「${sessionTitle}」的工具调用请求。批准后 DSH 才会继续。`
          : '写权不在本机，当前只能查看，不能代答。'
      }
    >
      <div className="rounded-[18px] border border-line bg-ink-850/80 p-3.5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] border border-amber/25 bg-amber/10">
            <ShieldAlert aria-hidden className="size-[18px] text-amber" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium leading-5 text-bone">
              {request.toolCall.title ?? '工具调用请求'}
            </p>
            <p className="mt-1 truncate font-mono text-[10px] text-mute">
              {request.toolCall.toolCallId}
            </p>
          </div>
        </div>
        <p className="mt-3 border-t border-line/60 pt-3 text-[11.5px] leading-5 text-mist">
          这会修改 Bridge 工作目录内的文件。请确认工具与目标符合你的预期。
        </p>
      </div>

      {!isWriter ? (
        <div className="mt-3 rounded-2xl border border-coral/20 bg-coral/[0.06] px-3.5 py-3 text-[11.5px] leading-5 text-coral">
          只有持有写权的设备可以回答审批。请先接管写权，再回到这里处理。
        </div>
      ) : null}

      <div className="mt-4 space-y-2.5">
        {options.map((option) => {
          const copy = optionCopy(option)
          const busy = busyOptionId === option.optionId
          const isReject = option.kind === 'reject_once' || option.kind === 'reject_always'
          const isAlways = option.kind === 'allow_always'
          const disabled = !isWriter || busyOptionId !== null || expired
          const leading = isReject ? (
            <X className="size-[18px]" />
          ) : isAlways ? (
            <ShieldCheck className="size-[18px]" />
          ) : (
            <Check className="size-[18px]" />
          )

          return (
            <button
              key={option.optionId}
              type="button"
              disabled={disabled}
              onClick={() => onAnswer(request.requestId, option.optionId)}
              className={cn(
                'tap flex min-h-[54px] w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition',
                'disabled:pointer-events-none disabled:opacity-45',
                isReject
                  ? 'border-coral/20 bg-coral/[0.055] text-coral hover:border-coral/40 hover:bg-coral/10'
                  : option.kind === 'allow_once'
                    ? 'border-signal/30 bg-signal text-[#0a1006] hover:bg-signal-strong'
                    : 'border-line bg-ink-800 text-bone hover:border-ink-500 hover:bg-ink-700',
              )}
            >
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full border',
                  isReject
                    ? 'border-coral/25 bg-coral/10'
                    : option.kind === 'allow_once'
                      ? 'border-[#0a1006]/15 bg-[#0a1006]/10'
                      : 'border-line bg-ink-900',
                )}
              >
                {busy ? (
                  <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  leading
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold">{copy}</span>
                <span
                  className={cn(
                    'mt-0.5 block text-[10px] leading-4',
                    option.kind === 'allow_once' ? 'text-[#0a1006]/60' : 'text-mute',
                  )}
                >
                  {option.kind === 'allow_once'
                    ? '仅这一次，之后会再次询问'
                    : option.kind === 'allow_always'
                      ? '本次会话内不再询问同类操作'
                      : option.kind === 'reject_once'
                        ? '这次不执行，保留上下文'
                        : option.kind === 'reject_always'
                          ? '本次会话内拒绝同类操作'
                          : 'Bridge 提供的自定义选项'}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-4 rounded-2xl border border-line/70 bg-ink-950/45 px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.08em] text-mute">
            <Clock className="size-3" />
            {expired ? '等待 Bridge 关闭请求' : `${formatRemaining(remaining)} 后自动取消`}
          </span>
          <span className="font-mono text-[9px] tabular-nums text-mute/70">
            {Math.round(percent)}%
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="permission-timer h-full rounded-full transition-[width] duration-1000 ease-linear"
            style={{ width: `${String(percent)}%` }}
          />
        </div>
        <p className="mt-2.5 text-[10px] leading-4 text-mute/80">
          {mode === 'demo'
            ? '演示审批不会写入真实文件。'
            : '只有写权设备可以回答；审批结果会写入 Bridge 审计记录。'}
        </p>
      </div>
    </Sheet>
  )
}
