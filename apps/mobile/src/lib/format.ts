import type { RenderBlock, SessionSummary } from '@dsh-mobile/protocol'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp)
  if (diff < 45_000) return '刚刚'
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))} 分钟前`
  if (diff < DAY) return `${Math.round(diff / HOUR)} 小时前`
  if (diff < 7 * DAY) return `${Math.round(diff / DAY)} 天前`
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(timestamp)
}

export function formatClock(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp)
}

export function formatShortDate(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
  }).format(timestamp)
}

/** Basename without ever exposing the full server path in the UI. */
export function pathBasename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]/)
  const last = parts[parts.length - 1]
  return last !== undefined && last.length > 0 ? last : 'workspace'
}

export function sessionTitle(session: SessionSummary): string {
  const title = session.title?.trim()
  if (title !== undefined && title.length > 0) return title
  return pathBasename(session.cwd) || `会话 ${session.id.slice(0, 6)}`
}

export function sessionCode(sessionId: string): string {
  return sessionId.slice(0, 6).toUpperCase()
}

export function maskDevice(deviceId: string | null): string {
  if (deviceId === null || deviceId.length === 0) return '无设备'
  if (deviceId.length <= 7) return deviceId
  return `${deviceId.slice(0, 4)}…${deviceId.slice(-3)}`
}

export function formatLeaseState(state: SessionSummary['lease']['state']): string {
  switch (state) {
    case 'idle':
      return '空闲'
    case 'read':
      return '只读'
    case 'write':
      return '可写'
    case 'handoff':
      return '交接中'
  }
}

export function formatMcpState(state: string): string {
  switch (state) {
    case 'connected':
      return '已连接'
    case 'connecting':
      return '连接中'
    case 'reconnecting':
      return '重连中'
    case 'down':
      return '不可用'
    case 'disabled':
      return '已停用'
    default:
      return '未知'
  }
}

export function truncate(text: string, max = 80): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact
}

export function blockPreview(blocks: readonly RenderBlock[]): string {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block === undefined) continue
    if (block.kind === 'message' && block.text.trim().length > 0) return truncate(block.text, 64)
    if (block.kind === 'notice' && block.text.trim().length > 0) return truncate(block.text, 64)
  }
  return '还没有消息'
}

export function countMessages(blocks: readonly RenderBlock[]): number {
  return blocks.filter((block) => block.kind === 'message').length
}

export function safeJson(value: unknown, maxLength = 2400): string {
  try {
    const result = JSON.stringify(value, null, 2)
    if (result === undefined) return ''
    return result.length > maxLength ? `${result.slice(0, maxLength)}\n…` : result
  } catch {
    return ''
  }
}

export function contentTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const texts: string[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (typeof record.text === 'string' && record.text.length > 0) texts.push(record.text)
  }
  return texts
}

/** Hide URLs and obvious absolute paths from status strings surfaced by the Bridge. */
export function redactSensitive(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, '[地址已隐藏]')
    .replace(/(?:[A-Za-z]:\\|\/)(?:[^\s/\\]+[\\/]){1,}[^\s/\\]+/g, '[路径已隐藏]')
    .slice(0, 180)
}

export function promptStopCopy(stopReason: string): string {
  switch (stopReason) {
    case 'end_turn':
      return '本轮完成'
    case 'max_tokens':
      return '达到输出上限'
    case 'cancelled':
    case 'canceled':
      return '已停止'
    case 'refusal':
      return 'Agent 拒绝继续'
    default:
      return '本轮结束'
  }
}
