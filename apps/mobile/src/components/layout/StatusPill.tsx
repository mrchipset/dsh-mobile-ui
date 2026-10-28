import type { StoreStatus } from '../../store/useBridgeStore'
import { Badge, type BadgeTone } from '../ui/Badge'

function copyFor(status: StoreStatus): { label: string; tone: BadgeTone } {
  switch (status) {
    case 'demo':
      return { label: '演示', tone: 'ice' }
    case 'ready':
      return { label: '已连接', tone: 'signal' }
    case 'connecting':
      return { label: '连接中', tone: 'amber' }
    case 'authenticating':
      return { label: '校验中', tone: 'amber' }
    case 'reconnecting':
      return { label: '重连中', tone: 'amber' }
    case 'offline':
      return { label: '离线', tone: 'coral' }
    case 'unauthorized':
      return { label: '未授权', tone: 'coral' }
    case 'idle':
      return { label: '待机', tone: 'muted' }
  }
}

export function StatusPill({ status, className }: { status: StoreStatus; className?: string }) {
  const { label, tone } = copyFor(status)
  return (
    <Badge
      tone={tone}
      dot
      pulse={status === 'connecting' || status === 'authenticating'}
      className={className}
    >
      {label}
    </Badge>
  )
}
