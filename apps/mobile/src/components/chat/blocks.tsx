import type {
  MessageBlock,
  NoticeBlock,
  PlanBlock,
  RenderBlock,
  ThoughtBlock,
  ToolCallBlock,
  UnknownBlock,
} from '@dsh-mobile/protocol'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Circle,
  FileText,
  Globe,
  Info,
  Loader2,
  Pencil,
  Terminal,
  Wrench,
  X,
  XCircle,
} from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { contentTexts, safeJson, truncate } from '../../lib/format'
import { cn } from '../../lib/utils'
import { Badge, type BadgeTone } from '../ui/Badge'
import { MessageAudio } from './AudioAttachment'

const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

function UserMessage({ block }: { block: MessageBlock }) {
  return (
    <article className="flex justify-end">
      <div
        className={cn(
          'max-w-[86%] rounded-[21px] rounded-br-[7px] bg-bubble px-4 py-3 text-[14px] leading-[1.65] text-bubble-ink shadow-bubble',
          block.audio !== undefined && 'min-w-[15rem]',
        )}
      >
        {block.text.length > 0 ? (
          <p className="whitespace-pre-wrap break-words">{block.text}</p>
        ) : null}
        {block.audio !== undefined ? <MessageAudio attachment={block.audio} /> : null}
        {block.images !== undefined && block.images.length > 0 ? (
          <div className="mt-2.5 grid grid-cols-2 gap-1.5">
            {block.images.map((image, index) => (
              <img
                key={`${image.mimeType}-${String(image.data.length)}-${image.data.slice(0, 24)}`}
                src={`data:${image.mimeType};base64,${image.data}`}
                alt={`图片 ${index + 1}`}
                loading="lazy"
                className="max-h-48 w-full rounded-xl object-cover"
              />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  )
}

function AssistantMessage({
  block,
  live,
  isLast,
}: {
  block: MessageBlock
  live: boolean
  isLast: boolean
}) {
  const showCursor = block.streaming === true && live && isLast
  return (
    <article className="flex items-start gap-2.5">
      <div
        aria-hidden
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[9px] border border-signal/20 bg-signal/[0.07]"
      >
        <span className="font-mono text-[8px] font-semibold tracking-[-0.04em] text-signal">
          DSH
        </span>
      </div>
      <div className="min-w-0 flex-1 pt-1">
        {block.text.length === 0 && live ? (
          <div className="flex items-center gap-2 py-1 text-mist">
            <span className="equalizer text-signal" aria-hidden>
              <span />
              <span />
              <span />
              <span />
            </span>
            <span className="text-[12px]">正在组织语言…</span>
          </div>
        ) : (
          <Markdown text={block.text} />
        )}
        {showCursor ? <span className="streaming-cursor" aria-hidden /> : null}
      </div>
    </article>
  )
}

function ThoughtCard({ block }: { block: ThoughtBlock }) {
  return (
    <article>
      <details className="thought-details group rounded-[16px] border border-line/70 bg-ink-850/45">
        <summary className="flex items-start gap-2.5 px-3.5 py-2.5">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-ink-900">
            <Info className="size-3 text-ice" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="font-mono text-[9px] tracking-[0.12em] text-mute">THOUGHT</span>
              {block.streaming === true ? (
                <span className="size-1 animate-pulse rounded-full bg-signal" />
              ) : null}
            </span>
            <span className="thought-preview mt-0.5 block truncate text-[12px] leading-5 text-mist/80">
              {truncate(block.text, 68)}
            </span>
          </span>
          <ChevronRight className="chevron mt-1 size-3.5 shrink-0 text-mute" />
        </summary>
        <div className="border-t border-line/60 px-3.5 py-3">
          <p className="whitespace-pre-wrap break-words text-[12.5px] leading-6 text-mist">
            {block.text}
          </p>
        </div>
      </details>
    </article>
  )
}

function toolMeta(toolKind: string | undefined): { label: string; icon: typeof Wrench } {
  switch (toolKind) {
    case 'read':
      return { label: '读取', icon: FileText }
    case 'edit':
    case 'write':
      return { label: '写入', icon: Pencil }
    case 'execute':
    case 'terminal':
      return { label: '执行', icon: Terminal }
    case 'fetch':
    case 'http':
      return { label: '请求', icon: Globe }
    default:
      return { label: '工具', icon: Wrench }
  }
}

function toolStatus(status: ToolCallBlock['status']): {
  copy: string
  tone: BadgeTone
  icon: typeof Check
} {
  switch (status) {
    case 'completed':
      return { copy: '完成', tone: 'signal', icon: Check }
    case 'failed':
      return { copy: '失败', tone: 'coral', icon: X }
    case 'in_progress':
      return { copy: '运行中', tone: 'amber', icon: Loader2 }
    case 'pending':
      return { copy: '等待', tone: 'muted', icon: Circle }
  }
}

function ToolCard({ block }: { block: ToolCallBlock }) {
  const meta = toolMeta(block.toolKind)
  const status = toolStatus(block.status)
  const StatusIcon = status.icon
  const ToolIcon = meta.icon
  const texts = contentTexts(block.content)
  const input = block.rawInput === undefined ? '' : safeJson(block.rawInput)
  const output = block.rawOutput === undefined ? '' : safeJson(block.rawOutput)
  const hasDetail = texts.length > 0 || input.length > 0 || output.length > 0

  return (
    <article>
      <details className="tool-details rounded-[18px] border border-line bg-ink-850/60">
        <summary className="flex items-start gap-3 px-3.5 py-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-line bg-ink-900 text-mist">
            <ToolIcon className="size-4" strokeWidth={1.7} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-bone">
                {block.title}
              </span>
              <Badge tone={status.tone} className="mt-0.5">
                <StatusIcon
                  aria-hidden
                  className={cn('size-2.5', block.status === 'in_progress' && 'animate-spin')}
                />
                {status.copy}
              </Badge>
            </span>
            <span className="mt-1 flex items-center gap-1.5 font-mono text-[9px] tracking-[0.06em] text-mute">
              {meta.label}
              <span aria-hidden className="size-0.5 rounded-full bg-mute/70" />
              {block.toolCallId.slice(0, 18)}
            </span>
          </span>
          <ChevronRight className="chevron mt-2 size-3.5 shrink-0 text-mute" />
        </summary>

        {hasDetail ? (
          <div className="space-y-3 border-t border-line/60 px-3.5 py-3">
            {texts.length > 0 ? (
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-ink-950/70 p-3 font-mono text-[10.5px] leading-5 text-mist">
                {texts.join('\n\n')}
              </pre>
            ) : null}
            {input.length > 0 ? (
              <div>
                <p className="mono-label mb-1.5 text-mute">INPUT</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-ink-950/70 p-3 font-mono text-[10.5px] leading-5 text-mist/85">
                  {input}
                </pre>
              </div>
            ) : null}
            {output.length > 0 ? (
              <div>
                <p className="mono-label mb-1.5 text-mute">OUTPUT</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-ink-950/70 p-3 font-mono text-[10.5px] leading-5 text-mist/85">
                  {output}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </details>
    </article>
  )
}

function PlanCard({ block }: { block: PlanBlock }) {
  const done = block.entries.filter((entry) => entry.status === 'completed').length
  const total = block.entries.length
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)

  return (
    <article className="overflow-hidden rounded-[18px] border border-line bg-ink-850/60">
      <header className="flex items-center justify-between gap-3 px-3.5 pb-2.5 pt-3">
        <div className="flex items-center gap-2">
          <span className="mono-label text-mute">PLAN</span>
          <span className="font-mono text-[10px] text-mist">
            {done}/{total}
          </span>
        </div>
        <span className="font-mono text-[10px] tabular-nums text-signal">{percent}%</span>
      </header>
      <div className="mx-3.5 h-0.5 overflow-hidden rounded-full bg-track">
        <div
          className="h-full rounded-full bg-signal transition-[width] duration-500"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      <ul className="space-y-0.5 px-3.5 py-3">
        {block.entries.map((entry) => (
          <li
            key={`${entry.content}-${entry.status}-${entry.priority}`}
            className="flex items-start gap-2.5 py-1"
          >
            {entry.status === 'completed' ? (
              <Check className="mt-1 size-3.5 shrink-0 text-signal" />
            ) : entry.status === 'in_progress' ? (
              <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-amber" />
            ) : (
              <Circle className="mt-1 size-3.5 shrink-0 text-mute" />
            )}
            <span
              className={cn(
                'min-w-0 flex-1 text-[12.5px] leading-5',
                entry.status === 'completed' ? 'text-mist/60 line-through' : 'text-mist',
              )}
            >
              {entry.content}
            </span>
            {entry.priority === 'high' ? (
              <span className="mt-1 font-mono text-[8px] tracking-[0.08em] text-coral/80">
                HIGH
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </article>
  )
}

function noticeCopy(block: NoticeBlock): string {
  switch (block.code) {
    case 'history_starts_at':
      return '本设备只能看到 Bridge 接入后的记录，更早的消息不在时间线中。'
    case 'history_truncated':
      return '更早的记录已省略。'
    case 'compaction':
      return '上下文已压缩，后续回复会基于摘要继续。'
    case 'compaction_summary':
      return `上下文摘要：${block.text}`
    case 'plan_file':
      return '计划文件已更新。'
    case 'cancelled':
      return '已停止生成。'
    default:
      return block.text
  }
}

function NoticeCard({ block }: { block: NoticeBlock }) {
  const tone =
    block.level === 'error' ? 'text-coral' : block.level === 'warning' ? 'text-amber' : 'text-ice'
  const Icon = block.level === 'error' ? XCircle : block.level === 'warning' ? AlertTriangle : Info

  return (
    <article className="flex items-start gap-2.5 px-1 py-1">
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', tone)} />
      <p className="min-w-0 flex-1 text-[11.5px] leading-5 text-mist/85">{noticeCopy(block)}</p>
    </article>
  )
}

function UnknownCard({ block }: { block: UnknownBlock }) {
  const raw = safeJson(block.raw, 1200)
  return (
    <article>
      <details className="tool-details rounded-[16px] border border-dashed border-line/80 bg-ink-900/40">
        <summary className="flex items-center gap-2.5 px-3.5 py-2.5">
          <span className="flex size-6 items-center justify-center rounded-full border border-line font-mono text-[9px] text-mute">
            ?
          </span>
          <span className="min-w-0 flex-1">
            <span className="mono-label block text-mute">UNKNOWN UPDATE</span>
            <span className="mt-0.5 block truncate font-mono text-[10px] text-mist/80">
              {block.sessionUpdate}
            </span>
          </span>
          <span className="font-mono text-[8px] tracking-[0.08em] text-mute">原样保留</span>
          <ChevronRight className="chevron size-3.5 shrink-0 text-mute" />
        </summary>
        <div className="border-t border-line/60 px-3.5 py-3">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-ink-950/70 p-3 font-mono text-[10px] leading-5 text-mist/75">
            {raw.length > 0 ? raw : '无内容'}
          </pre>
        </div>
      </details>
    </article>
  )
}

export function BlockRenderer({
  block,
  live,
  isLast,
}: {
  block: RenderBlock
  live: boolean
  isLast: boolean
}) {
  switch (block.kind) {
    case 'message':
      return block.role === 'user' ? (
        <UserMessage block={block} />
      ) : (
        <AssistantMessage block={block} live={live} isLast={isLast} />
      )
    case 'thought':
      return <ThoughtCard block={block} />
    case 'tool_call':
      return <ToolCard block={block} />
    case 'plan':
      return <PlanCard block={block} />
    case 'notice':
      return <NoticeCard block={block} />
    case 'unknown':
      return <UnknownCard block={block} />
  }
}
