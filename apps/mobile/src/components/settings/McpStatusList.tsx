import type { McpServerStatus } from '@dsh-mobile/protocol'
import { Globe, Server } from 'lucide-react'
import { formatMcpState, formatRelativeTime, redactSensitive } from '../../lib/format'
import { cn } from '../../lib/utils'
import { Badge, type BadgeTone } from '../ui/Badge'

function toneForState(state: McpServerStatus['state']): BadgeTone {
  switch (state) {
    case 'connected':
      return 'signal'
    case 'connecting':
    case 'reconnecting':
      return 'amber'
    case 'down':
      return 'coral'
    case 'disabled':
      return 'ink'
    default:
      return 'muted'
  }
}

function sourceLabel(source: McpServerStatus['source']): string {
  switch (source) {
    case 'process':
      return '进程'
    case 'probe':
      return '探测'
    case 'inferred':
      return '推断'
  }
}

export function McpStatusList({ servers, now }: { servers: McpServerStatus[]; now: number }) {
  return (
    <div className="divide-y divide-line/60">
      {servers.map((server) => (
        <div key={server.server} className="px-4 py-3.5">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-[10px] border',
                server.state === 'connected'
                  ? 'border-signal/20 bg-signal/[0.06] text-signal'
                  : server.state === 'down'
                    ? 'border-coral/20 bg-coral/[0.06] text-coral'
                    : 'border-line bg-ink-900 text-mist',
              )}
            >
              {server.transport === 'http' ? (
                <Globe className="size-4" strokeWidth={1.7} />
              ) : (
                <Server className="size-4" strokeWidth={1.7} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-[13px] font-medium text-bone">{server.server}</p>
                <Badge
                  tone={toneForState(server.state)}
                  dot={server.state === 'connecting' || server.state === 'reconnecting'}
                >
                  {formatMcpState(server.state)}
                </Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[9px] text-mute">
                <span className="uppercase">{server.transport}</span>
                <span aria-hidden className="size-0.5 rounded-full bg-mute/70" />
                <span>{sourceLabel(server.source)}</span>
                <span aria-hidden className="size-0.5 rounded-full bg-mute/70" />
                <span>
                  {server.lastCallAt === undefined
                    ? '尚未调用'
                    : `上次调用 ${formatRelativeTime(server.lastCallAt, now)}`}
                </span>
                {server.lastCallOk !== undefined ? (
                  <span className={server.lastCallOk ? 'text-signal/80' : 'text-coral/80'}>
                    {server.lastCallOk ? '成功' : '失败'}
                  </span>
                ) : null}
              </div>
              {server.lastError !== undefined && server.lastError.length > 0 ? (
                <p className="mt-1.5 line-clamp-2 text-[10px] leading-4 text-coral/75">
                  {redactSensitive(server.lastError)}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
