import type { RenderBlock, SessionSummary } from '@dsh-mobile/protocol'
import { Link } from '@tanstack/react-router'
import { ChevronRight, LockKeyhole, ShieldAlert } from 'lucide-react'
import type { CSSProperties } from 'react'
import { blockPreview, formatRelativeTime, pathBasename, sessionTitle } from '../../lib/format'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/Badge'

export function leaseLabel(
  session: SessionSummary,
  deviceId: string,
): {
  label: string
  tone: 'signal' | 'amber' | 'muted'
} {
  if (session.lease.state === 'write') {
    return session.lease.holder === deviceId
      ? { label: '可写', tone: 'signal' }
      : { label: '他机写入', tone: 'amber' }
  }
  if (session.lease.state === 'handoff') return { label: '交接中', tone: 'amber' }
  if (session.lease.state === 'read') return { label: '只读', tone: 'muted' }
  return { label: '空闲', tone: 'muted' }
}

interface SessionRowProps {
  session: SessionSummary
  index: number
  deviceId: string
  blocks: readonly RenderBlock[] | undefined
  hasPermission: boolean
  now: number
}

export function SessionRow({
  session,
  index,
  deviceId,
  blocks,
  hasPermission,
  now,
}: SessionRowProps) {
  const lease = leaseLabel(session, deviceId)
  const preview = blocks === undefined ? '还没有消息' : blockPreview(blocks)
  const title = sessionTitle(session)

  return (
    <Link
      to="/sessions/$sessionId"
      params={{ sessionId: session.id }}
      style={{ '--reveal-delay': `${80 + index * 55}ms` } as CSSProperties}
      className="session-card card-sheen reveal group relative block overflow-hidden rounded-[24px] border border-line bg-ink-850/80 p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-[9px] tracking-[0.14em] text-mute">
            #{String(index + 1).padStart(2, '0')}
          </span>
          {session.running ? (
            <Badge tone="signal" dot pulse>
              运行中
            </Badge>
          ) : null}
          {hasPermission ? (
            <Badge tone="coral" dot>
              <ShieldAlert aria-hidden className="size-3" />
              待审批
            </Badge>
          ) : null}
        </div>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-mute">
          {formatRelativeTime(session.lastActivityAt, now)}
        </span>
      </div>

      <div className="mt-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[17px] font-semibold leading-snug tracking-[-0.01em] text-bone">
            {title}
          </h3>
          <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-5 text-mist/85">{preview}</p>
        </div>
        <ChevronRight
          aria-hidden
          className="mt-1 size-4 shrink-0 text-mute transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-signal"
        />
      </div>

      <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-line/60 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-[10px] text-mute">
            {pathBasename(session.cwd)}
          </span>
          <span aria-hidden className="size-0.5 rounded-full bg-mute/70" />
          <span className="shrink-0 font-mono text-[10px] text-mute">{session.lastSeq} 次更新</span>
        </div>
        <Badge tone={lease.tone} className={cn(lease.tone === 'muted' && 'border-line/80')}>
          {lease.tone === 'muted' ? <LockKeyhole aria-hidden className="size-2.5" /> : null}
          {lease.label}
        </Badge>
      </div>
    </Link>
  )
}
