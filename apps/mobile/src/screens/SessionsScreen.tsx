import { Plus, Radio, RefreshCw, Sparkles } from 'lucide-react'
import { type CSSProperties, useEffect, useState } from 'react'
import { StatusPill } from '../components/layout/StatusPill'
import { SessionRow } from '../components/sessions/SessionRow'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { ThemeQuickToggle } from '../components/ui/ThemeToggle'
import { formatShortDate } from '../lib/format'
import { useBridgeStore } from '../store/useBridgeStore'

function SessionSkeleton({ index }: { index: number }) {
  return (
    <div
      className="reveal rounded-[24px] border border-line/70 bg-ink-850/55 p-4"
      style={{ '--reveal-delay': `${index * 60}ms` } as CSSProperties}
    >
      <div className="flex items-center justify-between">
        <div className="skeleton h-4 w-16 rounded-full" />
        <div className="skeleton h-3 w-12 rounded-full" />
      </div>
      <div className="skeleton mt-4 h-5 w-3/5 rounded-lg" />
      <div className="skeleton mt-3 h-3 w-11/12 rounded-full" />
      <div className="skeleton mt-2 h-3 w-4/5 rounded-full" />
      <div className="mt-4 flex items-center justify-between border-t border-line/60 pt-3">
        <div className="skeleton h-3 w-24 rounded-full" />
        <div className="skeleton h-5 w-12 rounded-full" />
      </div>
    </div>
  )
}

export function SessionsScreen() {
  const mode = useBridgeStore((state) => state.mode)
  const status = useBridgeStore((state) => state.status)
  const deviceId = useBridgeStore((state) => state.deviceId)
  const sessions = useBridgeStore((state) => state.sessions)
  const order = useBridgeStore((state) => state.order)
  const data = useBridgeStore((state) => state.data)
  const permissions = useBridgeStore((state) => state.permissions)
  const listLoading = useBridgeStore((state) => state.listLoading)
  const refreshSessions = useBridgeStore((state) => state.refreshSessions)
  const createSession = useBridgeStore((state) => state.createSession)
  const exitDemo = useBridgeStore((state) => state.exitDemo)
  const creating = useBridgeStore((state) => state.creating)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    refreshSessions()
  }, [refreshSessions])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const visible = order.flatMap((id) => {
    const session = sessions[id]
    return session === undefined ? [] : [session]
  })
  const running = visible.filter((session) => session.running).length
  const waiting = Object.values(permissions)

  return (
    <div className="relative flex h-full flex-col">
      <div className="screen-scroll flex-1 overflow-y-auto">
        <header className="safe-top header-blur sticky top-0 z-20">
          <div className="mx-auto w-full max-w-[560px] px-5 pb-3 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-[10px] border border-line bg-ink-850 font-mono text-[10px] font-semibold tracking-[-0.04em] text-signal">
                  DSH
                </span>
                <div className="leading-none">
                  <p className="font-mono text-[9px] tracking-[0.18em] text-mute">REMOTE DESK</p>
                  <p className="mt-1 font-mono text-[10px] tracking-[0.08em] text-bone">
                    {mode === 'demo' ? '演示会话目录' : '会话目录'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <StatusPill status={status} />
                <ThemeQuickToggle className="hidden min-[360px]:flex" />
                <button
                  type="button"
                  onClick={refreshSessions}
                  aria-label="刷新会话列表"
                  className="tap flex items-center justify-center rounded-full text-mute transition hover:bg-wash hover:text-bone"
                >
                  {listLoading ? (
                    <Spinner />
                  ) : (
                    <RefreshCw className="size-[17px]" strokeWidth={1.8} />
                  )}
                </button>
              </div>
            </div>

            <div className="mt-7 flex items-end justify-between gap-4">
              <div>
                <p className="mono-label text-signal/70">SESSION LOG</p>
                <h1 className="editorial-cn mt-2 text-[42px] leading-[0.95] tracking-[-0.01em] text-bone">
                  会话
                </h1>
              </div>
              <div className="pb-1 text-right">
                <p className="font-mono text-[10px] tracking-[0.08em] text-mute">
                  {formatShortDate(now)}
                </p>
                <p className="mt-1.5 font-mono text-[10px] tracking-[0.06em] text-bone">
                  {running > 0 ? `${running} 个运行中` : `${visible.length} 个会话`}
                </p>
              </div>
            </div>

            <div className="no-scrollbar mt-5 flex items-center gap-2 overflow-x-auto pb-1">
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-ink-850/70 px-3 py-1.5 font-mono text-[10px] text-mist">
                <Radio aria-hidden className="size-3 text-signal" />
                {visible.length} 条时间线
              </span>
              {waiting.length > 0 ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-coral/25 bg-coral/10 px-3 py-1.5 font-mono text-[10px] text-coral">
                  {waiting.length} 个待审批
                </span>
              ) : null}
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-ink-850/70 px-3 py-1.5 font-mono text-[10px] text-mist">
                单写权 · 多设备
              </span>
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[560px] px-5 pb-7 pt-2">
          {mode === 'demo' ? (
            <div className="reveal mb-4 flex items-center gap-3 rounded-[18px] border border-ice/20 bg-ice/[0.055] px-4 py-3">
              <Sparkles aria-hidden className="size-4 shrink-0 text-ice" />
              <p className="min-w-0 flex-1 text-[11.5px] leading-5 text-mist">
                演示模式，不会连接真实 Bridge。可随时发送消息体验流式与审批。
              </p>
              <button
                type="button"
                onClick={exitDemo}
                className="tap shrink-0 rounded-full px-2.5 font-mono text-[10px] tracking-[0.06em] text-ice transition hover:bg-ice/10"
              >
                退出
              </button>
            </div>
          ) : null}

          <div className="space-y-3">
            {listLoading && visible.length === 0
              ? [0, 1, 2].map((index) => <SessionSkeleton key={index} index={index} />)
              : visible.map((session, index) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    index={index}
                    deviceId={deviceId}
                    blocks={data[session.id]?.blocks}
                    hasPermission={Object.values(permissions).some(
                      (request) => request.sessionId === session.id,
                    )}
                    now={now}
                  />
                ))}
          </div>

          {!listLoading && visible.length === 0 ? (
            <div className="reveal mt-2 overflow-hidden rounded-[28px] border border-line bg-ink-850/60 px-5 py-10 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-line bg-ink-900">
                <Radio aria-hidden className="size-5 text-signal" />
              </div>
              <h2 className="editorial-cn mt-5 text-[24px] text-bone">还没有会话</h2>
              <p className="mx-auto mt-2 max-w-[15rem] text-[12.5px] leading-6 text-mist">
                新建一个会话，让 DSH 在 Bridge 的工作目录里开始第一条时间线。
              </p>
              <Button
                variant="primary"
                size="md"
                className="mt-5"
                loading={creating}
                onClick={createSession}
                leading={<Plus className="size-4" />}
              >
                新建会话
              </Button>
            </div>
          ) : null}

          {visible.length > 0 ? (
            <p className="mt-5 px-1 font-mono text-[9px] leading-5 tracking-[0.05em] text-mute/70">
              列表只显示 Bridge 接入后的会话；桌面端更早的记录不会在此出现。
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
