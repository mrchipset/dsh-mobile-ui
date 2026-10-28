import { useNavigate } from '@tanstack/react-router'
import {
  Fingerprint,
  KeyRound,
  LogOut,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldAlert,
  Sparkles,
  Wifi,
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { StatusPill } from '../components/layout/StatusPill'
import { McpStatusList } from '../components/settings/McpStatusList'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { DEMO_PRIMARY_SESSION_ID } from '../lib/demo'
import { maskDevice } from '../lib/format'
import { useBridgeStore } from '../store/useBridgeStore'

function connectionTitle(status: string): string {
  switch (status) {
    case 'demo':
      return '演示模式'
    case 'ready':
      return 'Bridge 已连接'
    case 'connecting':
    case 'authenticating':
      return '正在连接 Bridge'
    case 'reconnecting':
      return '正在重新连接'
    case 'offline':
      return '设备离线'
    case 'unauthorized':
      return '尚未授权'
    default:
      return '等待连接'
  }
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="mono-label mb-2 px-1 text-mute">{children}</p>
}

export function SettingsScreen() {
  const mode = useBridgeStore((state) => state.mode)
  const status = useBridgeStore((state) => state.status)
  const statusDetail = useBridgeStore((state) => state.statusDetail)
  const deviceId = useBridgeStore((state) => state.deviceId)
  const authToken = useBridgeStore((state) => state.authToken)
  const reconnect = useBridgeStore((state) => state.reconnect)
  const signOut = useBridgeStore((state) => state.signOut)
  const enterDemo = useBridgeStore((state) => state.enterDemo)
  const exitDemo = useBridgeStore((state) => state.exitDemo)
  const resetDemo = useBridgeStore((state) => state.resetDemo)
  const triggerDemoPermission = useBridgeStore((state) => state.triggerDemoPermission)
  const mcp = useBridgeStore((state) => state.mcp)
  const mcpLoading = useBridgeStore((state) => state.mcpLoading)
  const refreshMcp = useBridgeStore((state) => state.refreshMcp)
  const pendingPermissions = useBridgeStore((state) => state.permissions)
  const [now, setNow] = useState(() => Date.now())
  const navigate = useNavigate()

  useEffect(() => {
    refreshMcp()
  }, [refreshMcp])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const host = typeof window === 'undefined' ? '' : window.location.host
  const waiting = Object.values(pendingPermissions).length
  const connected = mode === 'demo' || status === 'ready'

  function openDemoApproval() {
    triggerDemoPermission(DEMO_PRIMARY_SESSION_ID)
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId: DEMO_PRIMARY_SESSION_ID },
    })
  }

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
                  <p className="font-mono text-[9px] tracking-[0.18em] text-mute">CONTROL</p>
                  <p className="mt-1 font-mono text-[10px] tracking-[0.08em] text-bone">
                    设备控制台
                  </p>
                </div>
              </div>
              <StatusPill status={status} />
            </div>

            <div className="mt-7">
              <p className="mono-label text-signal/70">LOCAL CONSOLE</p>
              <h1 className="editorial-cn mt-2 text-[42px] leading-[0.95] text-bone">设置</h1>
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[560px] space-y-6 px-5 pb-8 pt-2">
          <section>
            <SectionLabel>BRIDGE</SectionLabel>
            <div className="card-sheen overflow-hidden rounded-[24px] border border-line bg-ink-850/75">
              <div className="flex items-start justify-between gap-3 px-4 pb-4 pt-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={
                      connected
                        ? 'flex size-10 shrink-0 items-center justify-center rounded-full border border-signal/25 bg-signal/10 text-signal'
                        : 'flex size-10 shrink-0 items-center justify-center rounded-full border border-amber/25 bg-amber/10 text-amber'
                    }
                  >
                    <Wifi className="size-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-bone">{connectionTitle(status)}</p>
                    <p className="mt-1 truncate font-mono text-[10px] text-mute">
                      {mode === 'demo' ? '本地模拟 · 不连接服务端' : `${host}/ws`}
                    </p>
                  </div>
                </div>
                {waiting > 0 ? (
                  <Badge tone="coral" dot>
                    {waiting} 待审批
                  </Badge>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-px border-y border-line/60 bg-line/50">
                <div className="min-w-0 bg-ink-900/80 px-4 py-3">
                  <p className="mono-label text-mute">DEVICE</p>
                  <p className="mt-1.5 truncate font-mono text-[10px] text-mist">
                    {maskDevice(deviceId)}
                  </p>
                </div>
                <div className="min-w-0 bg-ink-900/80 px-4 py-3">
                  <p className="mono-label text-mute">TOKEN</p>
                  <p className="mt-1.5 truncate font-mono text-[10px] text-mist">
                    {mode === 'demo'
                      ? '演示无需令牌'
                      : authToken.length > 0
                        ? '已保存于本机'
                        : '未保存'}
                  </p>
                </div>
              </div>

              <div className="space-y-2.5 px-4 pb-4 pt-3.5">
                {statusDetail !== null && status !== 'ready' ? (
                  <p className="text-[11px] leading-5 text-mist">{statusDetail}</p>
                ) : null}

                {mode === 'demo' ? (
                  <div className="grid grid-cols-2 gap-2.5">
                    <Button
                      variant="primary"
                      onClick={exitDemo}
                      leading={<Wifi className="size-4" />}
                    >
                      连接真实 Bridge
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={resetDemo}
                      leading={<RotateCcw className="size-4" />}
                    >
                      重置演示
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5">
                    <Button
                      variant="secondary"
                      onClick={reconnect}
                      leading={<RefreshCw className="size-4" />}
                    >
                      重新连接
                    </Button>
                    <Button
                      variant="danger"
                      onClick={signOut}
                      leading={<LogOut className="size-4" />}
                    >
                      断开并清除
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section>
            <SectionLabel>WRITE LEASE</SectionLabel>
            <div className="flex items-start gap-3 rounded-[20px] border border-line bg-ink-850/60 px-4 py-3.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] border border-line bg-ink-900">
                <Fingerprint className="size-4 text-mist" />
              </span>
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium text-bone">写权只属于一台设备</p>
                <p className="mt-1 text-[11px] leading-5 text-mist">
                  输入和审批跟随写权。其他设备保持只读，仍能收到同一条流式时间线。
                </p>
              </div>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="mono-label text-mute">MCP SERVERS</p>
              <button
                type="button"
                onClick={refreshMcp}
                aria-label="刷新 MCP 状态"
                className="tap -mr-2 flex items-center justify-center rounded-full text-mute transition hover:text-bone"
              >
                {mcpLoading ? <Spinner /> : <RefreshCw className="size-4" />}
              </button>
            </div>

            <div className="overflow-hidden rounded-[24px] border border-line bg-ink-850/70">
              {mcp.length > 0 ? (
                <McpStatusList servers={mcp} now={now} />
              ) : mcpLoading ? (
                <div className="space-y-3 p-4">
                  <div className="skeleton h-12 w-full rounded-xl" />
                  <div className="skeleton h-12 w-full rounded-xl" />
                </div>
              ) : (
                <div className="px-4 py-7 text-center">
                  <div className="mx-auto flex size-10 items-center justify-center rounded-xl border border-line bg-ink-900">
                    <Server className="size-4 text-mute" />
                  </div>
                  <p className="mt-3 text-[12.5px] font-medium text-bone">还没有 MCP 状态</p>
                  <p className="mx-auto mt-1.5 max-w-[16rem] text-[11px] leading-5 text-mist">
                    Bridge 未报告任何服务器，或还没有收到状态推送。移动端只能查看，不能修改配置。
                  </p>
                </div>
              )}
            </div>
            <p className="mt-2 px-1 text-[9px] leading-4 text-mute/70">
              状态来自进程事件、Bridge 探测与最近调用推断；移动端只读。
            </p>
          </section>

          {mode === 'demo' ? (
            <section>
              <SectionLabel>DEMO TOOLS</SectionLabel>
              <div className="rounded-[22px] border border-ice/15 bg-ice/[0.04] p-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] border border-ice/20 bg-ice/10">
                    <Sparkles className="size-4 text-ice" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-medium text-bone">检查审批与写权</p>
                    <p className="mt-1 text-[11px] leading-5 text-mist">
                      触发一个模拟审批，跳到示例会话查看底部面板、倒计时与接管流程。
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  <Button
                    variant="secondary"
                    onClick={openDemoApproval}
                    leading={<ShieldAlert className="size-4 text-amber" />}
                  >
                    触发审批
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={resetDemo}
                    leading={<RotateCcw className="size-4" />}
                  >
                    重置数据
                  </Button>
                </div>
              </div>
            </section>
          ) : (
            <section>
              <SectionLabel>PREVIEW</SectionLabel>
              <div className="rounded-[22px] border border-line bg-ink-850/65 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] border border-ice/20 bg-ice/10">
                    <Sparkles className="size-4 text-ice" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium text-bone">先试试演示模式</p>
                    <p className="mt-1 text-[11px] leading-5 text-mist">
                      不连接真实 Bridge，用一段完整会话检查流式、工具、计划和审批。
                    </p>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  className="mt-3 w-full"
                  onClick={enterDemo}
                  leading={<Sparkles className="size-4 text-ice" />}
                >
                  进入演示模式
                </Button>
              </div>
            </section>
          )}

          <section>
            <SectionLabel>ABOUT</SectionLabel>
            <div className="rounded-[22px] border border-line bg-ink-850/55 px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <KeyRound className="size-4 text-mute" />
                  <span className="text-[12px] text-mist">DSH Mobile UI</span>
                </div>
                <span className="font-mono text-[10px] text-mute">v0.0.0</span>
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-line/60 pt-2.5">
                <span className="text-[11px] text-mute">共享协议</span>
                <span className="font-mono text-[10px] text-mist">@dsh-mobile/protocol</span>
              </div>
              <p className="mt-3 text-[9px] leading-4 text-mute/70">
                会话历史只包含 Bridge 接入后的记录。更早的桌面端消息不会出现在这里。
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
