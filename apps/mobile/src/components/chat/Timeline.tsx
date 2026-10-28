import type { PermissionRequest, RenderBlock } from '@dsh-mobile/protocol'
import { ChevronRight, Send, ShieldAlert, Terminal } from 'lucide-react'
import { truncate } from '../../lib/format'
import { BlockRenderer } from './blocks'

interface TimelineProps {
  blocks: readonly RenderBlock[]
  live: boolean
  pendingPromptText: string | null
  permission: PermissionRequest | null
  onOpenPermission: () => void
}

export function Timeline({
  blocks,
  live,
  pendingPromptText,
  permission,
  onOpenPermission,
}: TimelineProps) {
  const empty = blocks.length === 0 && pendingPromptText === null && permission === null

  return (
    <div className="mx-auto w-full max-w-[560px] px-4 pb-6 pt-4">
      <div className="mb-4 flex items-center gap-2.5 px-1">
        <span className="mono-label text-mute">TIMELINE</span>
        <span aria-hidden className="h-px flex-1 bg-line/70" />
        <span className="font-mono text-[9px] tracking-[0.06em] text-mute/70">
          {blocks.length} 个块
        </span>
      </div>

      {empty ? (
        <div className="rounded-[24px] border border-line/70 bg-ink-850/50 px-5 py-9 text-center">
          <div className="mx-auto flex size-11 items-center justify-center rounded-2xl border border-line bg-ink-900">
            <Terminal aria-hidden className="size-5 text-signal" />
          </div>
          <h2 className="editorial-cn mt-4 text-[22px] text-bone">时间线从这里开始</h2>
          <p className="mx-auto mt-2 max-w-[16rem] text-[12px] leading-5 text-mist">
            发送第一句话。DSH 的流式回复、工具调用和计划会依次出现在这里。
          </p>
        </div>
      ) : null}

      <div className="space-y-5">
        {blocks.map((block, index) => (
          <BlockRenderer
            key={block.id}
            block={block}
            live={live}
            isLast={index === blocks.length - 1}
          />
        ))}

        {pendingPromptText !== null ? (
          <article className="flex justify-end">
            <div className="max-w-[86%] rounded-[21px] rounded-br-[7px] bg-bubble/80 px-4 py-3 text-[14px] leading-[1.65] text-bubble-ink shadow-bubble">
              <p className="whitespace-pre-wrap break-words">{pendingPromptText}</p>
              <p className="mt-1.5 flex items-center justify-end gap-1.5 font-mono text-[9px] tracking-[0.06em] text-bubble-ink/70">
                <Send aria-hidden className="size-2.5" />
                发送中
              </p>
            </div>
          </article>
        ) : null}

        {permission !== null ? (
          <button
            type="button"
            onClick={onOpenPermission}
            className="group flex w-full items-center gap-3 rounded-[18px] border border-coral/25 bg-coral/[0.07] px-3.5 py-3 text-left transition hover:border-coral/40 hover:bg-coral/[0.1]"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-coral/25 bg-coral/10">
              <ShieldAlert aria-hidden className="size-4 text-coral" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-[9px] tracking-[0.12em] text-coral">
                PERMISSION WAITING
              </span>
              <span className="mt-0.5 block truncate text-[12.5px] text-bone">
                {truncate(permission.toolCall.title ?? '工具调用等待确认', 42)}
              </span>
            </span>
            <span className="shrink-0 text-[11px] font-medium text-coral">处理</span>
            <ChevronRight className="size-3.5 shrink-0 text-coral/70 transition-transform group-hover:translate-x-0.5" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
