import type { SessionSummary } from '@dsh-mobile/protocol'
import { ArrowLeft, ChevronDown, LockKeyhole, Radio } from 'lucide-react'
import { formatLeaseState, pathBasename, sessionCode, sessionTitle } from '../../lib/format'
import { cn } from '../../lib/utils'

interface ChatHeaderProps {
  session: SessionSummary | undefined
  sessionId: string
  deviceId: string
  running: boolean
  cancelling: boolean
  onBack: () => void
  onOpenLease: () => void
}

export function ChatHeader({
  session,
  sessionId,
  deviceId,
  running,
  cancelling,
  onBack,
  onOpenLease,
}: ChatHeaderProps) {
  const isWriter = session?.lease.holder === deviceId
  const leaseText =
    session === undefined
      ? '加载中'
      : isWriter
        ? '可写'
        : session.lease.state === 'write'
          ? '只读'
          : formatLeaseState(session.lease.state)
  const title = session === undefined ? '会话' : sessionTitle(session)

  return (
    <header className="safe-top header-blur relative z-30 shrink-0 border-b border-line/60">
      <div className="mx-auto flex w-full max-w-[560px] items-center gap-2 px-3 pb-2.5 pt-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回会话列表"
          className="tap flex shrink-0 items-center justify-center rounded-full text-mist transition hover:bg-wash hover:text-bone"
        >
          <ArrowLeft className="size-5" />
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold leading-tight tracking-[-0.01em] text-bone">
            {title}
          </h1>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 font-mono text-[9px] tracking-[0.1em] text-mute">
              #{sessionCode(sessionId)}
            </span>
            <span aria-hidden className="size-0.5 rounded-full bg-mute/70" />
            <span className="truncate font-mono text-[9px] text-mute">
              {session === undefined ? '同步中' : pathBasename(session.cwd)}
            </span>
            {running ? (
              <span className="ml-1 flex shrink-0 items-center gap-1 text-signal">
                <span className="equalizer" aria-hidden>
                  <span />
                  <span />
                  <span />
                  <span />
                </span>
                <span className="font-mono text-[9px] tracking-[0.06em]">
                  {cancelling ? '停止中' : '运行中'}
                </span>
              </span>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenLease}
          className={cn(
            'lease-chip tap flex shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium',
            isWriter
              ? 'border-signal/25 bg-signal/10 text-signal'
              : session?.lease.state === 'handoff'
                ? 'border-amber/25 bg-amber/10 text-amber'
                : 'border-line bg-ink-850/80 text-mist',
          )}
        >
          {isWriter ? (
            <LockKeyhole className="size-3.5" />
          ) : session?.lease.state === 'handoff' ? (
            <Radio className="size-3.5" />
          ) : (
            <LockKeyhole className="size-3.5" />
          )}
          <span>{leaseText}</span>
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </div>
    </header>
  )
}
