import type {
  MessageBlock,
  NoticeBlock,
  PlanEntry,
  RenderBlock,
  ThoughtBlock,
  ToolCallBlock,
  ToolCallStatus,
} from './blocks'
import type { ImageRef, StoredUpdate } from './entities'

export interface FoldOptions {
  /** Epoch ms when the Bridge first recorded anything for this session. */
  historyStartsAt?: number
  /** True when older updates were pruned before this snapshot. */
  historyTruncated?: boolean
}

type JsonRecord = Record<string, unknown>

const IMAGE_MIME_TYPES = new Set<ImageRef['mimeType']>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function asToolStatus(value: unknown): ToolCallStatus | undefined {
  return value === 'pending' ||
    value === 'in_progress' ||
    value === 'completed' ||
    value === 'failed'
    ? value
    : undefined
}

function asImageMime(value: string): ImageRef['mimeType'] | undefined {
  return IMAGE_MIME_TYPES.has(value as ImageRef['mimeType'])
    ? (value as ImageRef['mimeType'])
    : undefined
}

function readContent(content: unknown): { text?: string; image?: ImageRef } {
  const record = asRecord(content)
  if (record === undefined) return {}

  if (record.type === 'text') {
    const text = asString(record.text)
    return text === undefined ? {} : { text }
  }

  if (record.type === 'image') {
    const data = asString(record.data)
    const mimeType = asString(record.mimeType)
    if (data !== undefined && mimeType !== undefined) {
      const validMime = asImageMime(mimeType)
      if (validMime !== undefined) return { image: { mimeType: validMime, data } }
    }
    return { text: '[image]' }
  }

  if (record.type === 'resource_link') {
    const name = asString(record.name) ?? asString(record.uri) ?? 'resource'
    return { text: `[${name}]` }
  }

  if (record.type === 'resource') {
    return { text: '[resource]' }
  }

  if (record.type === 'audio') {
    return { text: '[audio]' }
  }

  return {}
}

function readPlanEntries(value: unknown): PlanEntry[] | undefined {
  const entries = asArray(value)
  if (entries === undefined) return undefined
  const parsed: PlanEntry[] = []
  for (const entry of entries) {
    const record = asRecord(entry)
    if (record === undefined) continue
    const content = asString(record.content)
    if (content === undefined) continue
    const status =
      record.status === 'pending' ||
      record.status === 'in_progress' ||
      record.status === 'completed'
        ? record.status
        : 'pending'
    const priority =
      record.priority === 'high' || record.priority === 'medium' || record.priority === 'low'
        ? record.priority
        : 'medium'
    parsed.push({ content, status, priority })
  }
  return parsed
}

/**
 * Pure projection of persisted ACP updates into the blocks the mobile client renders.
 * Unknown `sessionUpdate` variants are preserved as `unknown` blocks instead of throwing.
 */
export function fold(updates: readonly StoredUpdate[], options: FoldOptions = {}): RenderBlock[] {
  const blocks: RenderBlock[] = []
  const positions = new Map<string, number>()
  const lastMessageKey = new Map<string, string>()
  let anonymousMessages = 0
  let notices = 0

  const get = <T extends RenderBlock>(id: string): T | undefined => {
    const index = positions.get(id)
    return index === undefined ? undefined : (blocks[index] as T | undefined)
  }

  const put = (block: RenderBlock): void => {
    const index = positions.get(block.id)
    if (index === undefined) {
      positions.set(block.id, blocks.length)
      blocks.push(block)
    } else {
      blocks[index] = block
    }
  }

  const remove = (id: string): void => {
    const index = positions.get(id)
    if (index === undefined) return
    blocks.splice(index, 1)
    positions.clear()
    for (const [blockIndex, block] of blocks.entries()) positions.set(block.id, blockIndex)
  }

  const notice = (
    level: NoticeBlock['level'],
    text: string,
    code: string | undefined,
    seq: number,
  ): void => {
    notices += 1
    put({
      kind: 'notice',
      id: `notice:${seq}:${code ?? notices}`,
      level,
      text,
      code,
      seq,
    })
  }

  if (options.historyTruncated === true) {
    notice('warning', 'Older history was truncated.', 'history_truncated', 0)
  }
  if (options.historyStartsAt !== undefined) {
    notice(
      'info',
      'History is only visible from the point this Bridge first observed the session.',
      'history_starts_at',
      options.historyStartsAt,
    )
  }

  const messageIdFor = (role: 'user' | 'assistant' | 'thought', payload: JsonRecord): string => {
    const explicit = asString(payload.messageId)
    if (explicit !== undefined) {
      const key = `${role}:${explicit}`
      lastMessageKey.set(role, key)
      return key
    }
    const previous = lastMessageKey.get(role)
    if (previous !== undefined) return previous
    anonymousMessages += 1
    const key = `${role}:anonymous:${anonymousMessages}`
    lastMessageKey.set(role, key)
    return key
  }

  for (const update of updates) {
    const payload = asRecord(update.payload)
    const kind = asString(payload?.sessionUpdate) ?? update.kind
    const seq = update.seq

    if (kind === 'user_message_chunk' || kind === 'agent_message_chunk') {
      if (payload === undefined) continue
      const { text, image } = readContent(payload.content)
      if (text === undefined && image === undefined) continue
      const role = kind === 'user_message_chunk' ? 'user' : 'assistant'
      const key = messageIdFor(role, payload)
      const id = `msg:${key}`
      const existing = get<MessageBlock>(id)
      if (existing === undefined) {
        put({
          kind: 'message',
          id,
          role,
          text: text ?? '',
          ...(image === undefined ? {} : { images: [image] }),
          ...(asString(payload.messageId) === undefined
            ? {}
            : { messageId: asString(payload.messageId) }),
          streaming: role === 'assistant',
          seq,
        })
      } else {
        put({
          ...existing,
          text: existing.text + (text ?? ''),
          ...(image === undefined ? {} : { images: [...(existing.images ?? []), image] }),
          streaming: role === 'assistant',
          seq,
        })
      }
      continue
    }

    if (kind === 'agent_thought_chunk') {
      if (payload === undefined) continue
      const { text } = readContent(payload.content)
      if (text === undefined) continue
      const key = messageIdFor('thought', payload)
      const id = `thought:${key}`
      const existing = get<ThoughtBlock>(id)
      if (existing === undefined) {
        put({
          kind: 'thought',
          id,
          text,
          ...(asString(payload.messageId) === undefined
            ? {}
            : { messageId: asString(payload.messageId) }),
          streaming: true,
          seq,
        })
      } else {
        put({ ...existing, text: existing.text + text, streaming: true, seq })
      }
      continue
    }

    if (kind === 'tool_call' || kind === 'tool_call_update') {
      if (payload === undefined) continue
      const toolCallId = asString(payload.toolCallId)
      if (toolCallId === undefined) continue
      const id = `tool:${toolCallId}`
      const existing = get<ToolCallBlock>(id)
      const title = asString(payload.title)
      const toolKind = asString(payload.kind)
      const status = asToolStatus(payload.status)
      const content = asArray(payload.content)
      const locations = asArray(payload.locations)
      const rawInput = 'rawInput' in payload ? payload.rawInput : undefined
      const rawOutput = 'rawOutput' in payload ? payload.rawOutput : undefined

      if (existing === undefined) {
        put({
          kind: 'tool_call',
          id,
          toolCallId,
          title: title ?? toolCallId,
          ...(toolKind === undefined ? {} : { toolKind }),
          status: status ?? 'pending',
          ...(content === undefined ? {} : { content }),
          ...(locations === undefined ? {} : { locations }),
          ...(rawInput === undefined ? {} : { rawInput }),
          ...(rawOutput === undefined ? {} : { rawOutput }),
          seq,
        })
      } else {
        put({
          ...existing,
          title: title ?? existing.title,
          ...(toolKind === undefined ? {} : { toolKind }),
          status: status ?? existing.status,
          ...(content === undefined ? {} : { content }),
          ...(locations === undefined ? {} : { locations }),
          ...(rawInput === undefined ? {} : { rawInput }),
          ...(rawOutput === undefined ? {} : { rawOutput }),
          seq,
        })
      }
      continue
    }

    if (kind === 'plan' || kind === 'plan_update') {
      if (payload === undefined) continue
      let planId: string | undefined
      let entries: PlanEntry[] | undefined

      if (kind === 'plan') {
        planId = asString(payload.planId)
        entries = readPlanEntries(payload.entries)
      } else {
        const plan = asRecord(payload.plan)
        if (plan === undefined) continue
        planId = asString(plan.planId)
        if (plan.type === 'items') {
          entries = readPlanEntries(plan.entries)
        } else if (plan.type === 'markdown') {
          const content = asString(plan.content)
          if (content !== undefined) notice('info', content, 'plan_markdown', seq)
          continue
        } else {
          const uri = asString(plan.uri)
          notice('info', uri ?? 'Plan file updated.', 'plan_file', seq)
          continue
        }
      }

      if (entries === undefined) continue
      const id = `plan:${planId ?? 'default'}`
      put({
        kind: 'plan',
        id,
        ...(planId === undefined ? {} : { planId }),
        entries,
        seq,
      })
      continue
    }

    if (kind === 'plan_removed') {
      if (payload === undefined) continue
      const planId = asString(payload.planId)
      remove(`plan:${planId ?? 'default'}`)
      continue
    }

    if (kind === 'compaction_update') {
      notice('info', 'Context was compacted.', 'compaction', seq)
      continue
    }

    if (kind === 'compaction_summary_chunk') {
      if (payload === undefined) continue
      const { text } = readContent(payload.content)
      if (text !== undefined) notice('info', text, 'compaction_summary', seq)
      continue
    }

    if (
      kind === 'session_info_update' ||
      kind === 'usage_update' ||
      kind === 'available_commands_update' ||
      kind === 'current_mode_update' ||
      kind === 'config_option_update'
    ) {
      continue
    }

    put({
      kind: 'unknown',
      id: `unknown:${seq}`,
      sessionUpdate: kind,
      raw: update.payload,
      seq,
    })
  }

  return blocks
}
