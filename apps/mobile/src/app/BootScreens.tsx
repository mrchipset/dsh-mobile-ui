import { ArrowRight, Eye, EyeOff, KeyRound, RefreshCw, Sparkles } from 'lucide-react'
import { type CSSProperties, type FormEvent, useState } from 'react'
import { Button } from '../components/ui/Button'
import { ThemeQuickToggle } from '../components/ui/ThemeToggle'
import { firstIssue, tokenSchema } from '../lib/validation'
import { useBridgeStore } from '../store/useBridgeStore'

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex size-10 items-center justify-center overflow-hidden rounded-[13px] border border-line bg-ink-850">
        <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-signal/12 to-transparent" />
        <span className="relative font-mono text-[13px] font-semibold tracking-[-0.04em] text-signal">
          DSH
        </span>
      </div>
      <div className="min-w-0 leading-tight">
        <p className="whitespace-nowrap font-mono text-[11px] font-medium tracking-[0.2em] text-bone">
          DSH MOBILE
        </p>
        <p className="mt-0.5 whitespace-nowrap font-mono text-[9px] tracking-[0.14em] text-mute">
          DEEPSEEK HARNESS<span className="hidden min-[360px]:inline"> · ACP</span>
        </p>
      </div>
    </div>
  )
}

function Orbit({ compact = false }: { compact?: boolean }) {
  return (
    <div aria-hidden className={compact ? 'welcome-orbit scale-[0.82]' : 'welcome-orbit'}>
      <div className="welcome-orbit__spinner" />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-[9px] tracking-[0.32em] text-mute">REMOTE</span>
        <span className="editorial mt-1 text-[44px] leading-none text-bone">DSH</span>
        <span className="mt-2 flex items-center gap-1.5 font-mono text-[8px] tracking-[0.2em] text-signal">
          <span className="beacon relative size-1.5 rounded-full bg-signal" />
          STANDBY
        </span>
      </div>
    </div>
  )
}

export function WelcomeScreen() {
  const connect = useBridgeStore((state) => state.connect)
  const enterDemo = useBridgeStore((state) => state.enterDemo)
  const statusDetail = useBridgeStore((state) => state.statusDetail)
  const [token, setToken] = useState('')
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const visibleError =
    error ??
    (statusDetail !== null && statusDetail !== '输入访问令牌以连接 Bridge' ? statusDetail : null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = tokenSchema.safeParse(token)
    if (!parsed.success) {
      setError(firstIssue(parsed.error))
      return
    }
    setError(null)
    const accepted = connect(parsed.data)
    if (!accepted) setError('无法使用这个令牌，请检查后重试')
  }

  const sectionStyle = { '--reveal-delay': '60ms' } as CSSProperties
  const formStyle = { '--reveal-delay': '150ms' } as CSSProperties

  return (
    <div className="screen-scroll safe-top safe-bottom relative z-10 h-full overflow-y-auto">
      <div aria-hidden className="welcome-grid pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative mx-auto flex min-h-full w-full max-w-[520px] flex-col px-5 pb-7">
        <header className="flex items-center justify-between gap-3 pt-5">
          <BrandMark />
          <div className="flex items-center gap-2">
            <span className="hidden font-mono text-[9px] tracking-[0.18em] text-mute min-[360px]:inline">
              v0.0.0
            </span>
            <ThemeQuickToggle />
          </div>
        </header>

        <section
          className="reveal relative flex flex-1 flex-col justify-center py-8"
          style={sectionStyle}
        >
          <div className="pointer-events-none absolute -right-24 top-12 opacity-[0.16] sm:opacity-20">
            <Orbit compact />
          </div>
          <p className="mono-label text-signal/80">REMOTE CONTROL FOR YOUR AGENT</p>
          <h1 className="editorial-cn mt-4 text-[43px] leading-[1.08] text-bone">
            把 harness
            <br />
            放进口袋。
          </h1>
          <p className="mt-4 max-w-[30rem] text-[14px] leading-7 text-mist">
            接上家里那台 Bridge，继续同一个会话。流式输出、工具调用、审批和写权，都不必回到桌前。
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2 font-mono text-[9px] tracking-[0.12em] text-mute">
            <span className="rounded-full border border-line px-2.5 py-1">WSS</span>
            <span className="rounded-full border border-line px-2.5 py-1">ACP 1.4</span>
            <span className="rounded-full border border-line px-2.5 py-1">单写权 · 多设备</span>
          </div>
        </section>

        <form
          onSubmit={handleSubmit}
          className="reveal card-sheen rounded-[26px] border border-line bg-ink-850/85 p-4 shadow-float backdrop-blur"
          style={formStyle}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <label
              htmlFor="bridge-token"
              className="flex items-center gap-2 text-[12px] font-medium text-bone"
            >
              <KeyRound aria-hidden className="size-3.5 text-signal" />
              访问令牌
            </label>
            <span className="font-mono text-[9px] tracking-[0.08em] text-mute">仅存于本机</span>
          </div>

          <div className="input-shell flex h-[52px] items-center gap-2 rounded-2xl border border-line bg-ink-950/70 px-3.5">
            <input
              id="bridge-token"
              name="token"
              type={visible ? 'text' : 'password'}
              value={token}
              onChange={(event) => {
                setToken(event.target.value)
                if (error !== null) setError(null)
              }}
              placeholder="输入 BRIDGE_SECRET"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-[14px] text-bone outline-none placeholder:text-mute/70"
            />
            <button
              type="button"
              onClick={() => setVisible((current) => !current)}
              aria-label={visible ? '隐藏令牌' : '显示令牌'}
              className="tap -mr-2 flex items-center justify-center rounded-full px-2 text-mute transition hover:text-bone"
            >
              {visible ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
            </button>
          </div>

          {visibleError !== null ? (
            <p role="alert" className="mt-2.5 text-[12px] leading-5 text-coral">
              {visibleError}
            </p>
          ) : (
            <p className="mt-2.5 text-[11px] leading-5 text-mute">
              令牌会发给当前域名下的 Bridge，不会写入日志。
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="mt-4 w-full justify-between pl-5 pr-4"
            trailing={<ArrowRight className="size-[18px]" />}
          >
            连接 Bridge
          </Button>

          <button
            type="button"
            onClick={enterDemo}
            className="tap mt-2.5 flex w-full items-center justify-center gap-2 rounded-full py-3 text-[13px] font-medium text-mist transition hover:bg-wash-soft hover:text-bone"
          >
            <Sparkles aria-hidden className="size-4 text-ice" />
            先看看演示模式
          </button>
        </form>

        <p className="mt-5 text-center font-mono text-[9px] leading-5 tracking-[0.08em] text-mute/80">
          一个 Bridge · 一条 ACP 连接 · 多台设备共享同一条时间线
        </p>
      </div>
    </div>
  )
}

const CONNECTING_COPY: Record<string, { title: string; detail: string }> = {
  connecting: { title: '正在连接 Bridge', detail: '建立 WebSocket 通道…' },
  authenticating: { title: '正在校验设备', detail: '令牌已发送，等待 Bridge 确认…' },
  reconnecting: { title: '正在重新连接', detail: '网络或 Bridge 暂时不可用，会自动重试。' },
  offline: { title: '设备已离线', detail: '恢复网络后会自动继续。' },
  idle: { title: '准备连接', detail: '等待 Bridge 响应…' },
}

const CONNECTING_FALLBACK = { title: '正在连接 Bridge', detail: '等待 Bridge 响应…' }

export function ConnectingScreen() {
  const status = useBridgeStore((state) => state.status)
  const statusDetail = useBridgeStore((state) => state.statusDetail)
  const reconnect = useBridgeStore((state) => state.reconnect)
  const signOut = useBridgeStore((state) => state.signOut)
  const enterDemo = useBridgeStore((state) => state.enterDemo)
  const copy = CONNECTING_COPY[status] ?? CONNECTING_FALLBACK
  const host = typeof window === 'undefined' ? '' : window.location.host

  return (
    <div className="screen-scroll safe-top safe-bottom relative z-10 h-full overflow-y-auto">
      <div aria-hidden className="welcome-grid pointer-events-none absolute inset-0 opacity-60" />
      <div className="relative mx-auto flex min-h-full w-full max-w-[520px] flex-col px-5 pb-8">
        <header className="flex items-center justify-between gap-3 pt-5">
          <BrandMark />
          <ThemeQuickToggle />
        </header>

        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <div className="relative mb-9 flex size-[178px] items-center justify-center">
            <div aria-hidden className="absolute inset-0 rounded-full border border-signal/20" />
            <div
              aria-hidden
              className="absolute inset-4 animate-[spin-slow_7s_linear_infinite] rounded-full border border-dashed border-line"
            />
            <div aria-hidden className="absolute inset-0 animate-[spin-slow_3.4s_linear_infinite]">
              <span className="absolute left-1/2 top-0 size-2 -translate-x-1/2 rounded-full bg-signal shadow-glow" />
            </div>
            <div className="flex size-[88px] flex-col items-center justify-center rounded-full border border-line bg-ink-850/90">
              <span className="editorial text-[30px] leading-none text-bone">DSH</span>
              <span className="mt-1 font-mono text-[8px] tracking-[0.2em] text-mute">LINK</span>
            </div>
          </div>

          <p className="mono-label text-signal/70">SECURE CHANNEL</p>
          <h1 className="editorial-cn mt-3 text-[30px] leading-tight text-bone">{copy.title}</h1>
          <p className="mt-2.5 max-w-[17rem] text-[13px] leading-6 text-mist">
            {statusDetail ?? copy.detail}
          </p>
          <p className="mt-4 rounded-full border border-line bg-ink-850/60 px-3 py-1.5 font-mono text-[10px] tracking-[0.04em] text-mute">
            {host}/ws
          </p>
        </div>

        <div className="reveal space-y-2.5">
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={reconnect}
            leading={<RefreshCw className="size-[17px]" />}
          >
            立即重试
          </Button>
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="secondary" onClick={signOut}>
              更换令牌
            </Button>
            <Button variant="ghost" onClick={enterDemo}>
              演示模式
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function SplashScreen() {
  return (
    <div className="safe-top relative z-10 flex h-full flex-col items-center justify-center gap-5">
      <div className="flex size-16 items-center justify-center rounded-[20px] border border-line bg-ink-850">
        <span className="font-mono text-[17px] font-semibold tracking-[-0.05em] text-signal">
          DSH
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 animate-pulse rounded-full bg-signal" />
        <span className="font-mono text-[9px] tracking-[0.24em] text-mute">STARTING</span>
      </div>
    </div>
  )
}
