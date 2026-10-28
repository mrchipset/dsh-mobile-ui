import type { SessionSummary } from '@dsh-mobile/protocol'
import { Eye, LockKeyhole, Radio, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatClock, formatLeaseState, maskDevice, sessionTitle } from '../../lib/format'
import { cn } from '../../lib/utils'
import type { AppMode } from '../../store/useBridgeStore'
import { Button } from '../ui/Button'
import { Sheet } from '../ui/Sheet'

interface LeaseSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  session: SessionSummary
  deviceId: string
  mode: AppMode
  busy: boolean
  onTake: () => void
  onRelease: () => void
}

export function LeaseSheet({
  open,
  onOpenChange,
  session,
  deviceId,
  mode,
  busy,
  onTake,
  onRelease,
}: LeaseSheetProps) {
  const isWriter = session.lease.holder === deviceId
  const holderLabel = isWriter ? '本机' : maskDevice(session.lease.holder)
  const stateCopy = formatLeaseState(session.lease.state)
  const tone =
    isWriter || session.lease.state === 'write'
      ? 'signal'
      : session.lease.state === 'handoff'
        ? 'amber'
        : 'muted'

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="LEASE · 单写权"
      title="写权与设备"
      description="写权只控制输入和审批，不会中断另一台设备正在运行的回复。"
      footer={
        <div className="space-y-2">
          <Button
            variant={isWriter ? 'danger' : 'primary'}
            size="lg"
            className="w-full"
            loading={busy}
            onClick={() => {
              if (isWriter) onRelease()
              else onTake()
              onOpenChange(false)
            }}
            leading={isWriter ? <Radio className="size-4" /> : <LockKeyhole className="size-4" />}
          >
            {isWriter ? '释放写权' : '接管写权'}
          </Button>
          <p className="text-center text-[10px] leading-4 text-mute">
            {isWriter
              ? '释放后本机变成只读，其他设备可以接管。'
              : '接管立即生效，原设备会降为只读并收到提示。'}
          </p>
        </div>
      }
    >
      <div className="rounded-[18px] border border-line bg-ink-850/80 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="mono-label text-mute">CURRENT HOLDER</p>
            <p className="mt-1.5 truncate text-[16px] font-semibold text-bone">{holderLabel}</p>
            <p className="mt-0.5 truncate font-mono text-[9px] text-mute">
              {session.lease.holder ?? '无写权设备'}
            </p>
          </div>
          <span
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-full border',
              tone === 'signal'
                ? 'border-signal/25 bg-signal/10 text-signal'
                : tone === 'amber'
                  ? 'border-amber/25 bg-amber/10 text-amber'
                  : 'border-line bg-ink-900 text-mist',
            )}
          >
            {isWriter ? (
              <LockKeyhole className="size-5" />
            ) : session.lease.state === 'handoff' ? (
              <Radio className="size-5" />
            ) : (
              <Eye className="size-5" />
            )}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
          <span className="rounded-full border border-line bg-ink-900 px-2.5 py-1 font-mono text-[9px] tracking-[0.08em] text-mist">
            {stateCopy}
          </span>
          <span className="truncate rounded-full border border-line bg-ink-900 px-2.5 py-1 font-mono text-[9px] text-mute">
            {sessionTitle(session)}
          </span>
          {session.lease.deadline !== undefined ? (
            <span className="rounded-full border border-amber/20 bg-amber/[0.06] px-2.5 py-1 font-mono text-[9px] text-amber">
              宽限至 {formatClock(session.lease.deadline)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <StateRow
          icon={<ShieldCheck className="size-4" />}
          title="可写"
          copy="只有一台设备能输入和审批。提示词运行期间不会换手。"
          active={session.lease.state === 'write'}
        />
        <StateRow
          icon={<Eye className="size-4" />}
          title="只读"
          copy="继续接收流式更新，可以随时接管写权。"
          active={session.lease.state === 'read' || session.lease.state === 'idle'}
        />
        <StateRow
          icon={<Radio className="size-4" />}
          title="交接中"
          copy="原写者刚断线，Bridge 会保留 10 秒宽限。"
          active={session.lease.state === 'handoff'}
        />
      </div>

      <p className="mt-4 px-1 text-[10px] leading-4 text-mute/80">
        {mode === 'demo'
          ? '演示模式下，写权切换只影响本地界面，不会请求真实 Bridge。'
          : '审批权跟随写权。未处理的审批会在 180 秒后由 Bridge 自动取消。'}
      </p>
    </Sheet>
  )
}

function StateRow({
  icon,
  title,
  copy,
  active,
}: {
  icon: ReactNode
  title: string
  copy: string
  active: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-2xl border px-3.5 py-3',
        active ? 'border-signal/20 bg-signal/[0.045]' : 'border-line/60 bg-ink-900/30',
      )}
    >
      <span className={cn('mt-0.5 shrink-0', active ? 'text-signal' : 'text-mute')}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-bone">{title}</p>
        <p className="mt-0.5 text-[10.5px] leading-4 text-mist/80">{copy}</p>
      </div>
    </div>
  )
}
