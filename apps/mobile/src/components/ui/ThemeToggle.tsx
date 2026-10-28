import { Moon, Sun } from 'lucide-react'
import { cn } from '../../lib/utils'
import { type Theme, useTheme } from '../../theme/ThemeProvider'

const MODES: Array<{
  value: Theme
  label: string
  detail: string
  icon: typeof Sun
}> = [
  { value: 'light', label: '浅色', detail: '暖纸 · 深墨', icon: Sun },
  { value: 'dark', label: '深色', detail: '深夜 · 信号', icon: Moon },
]

export function ThemeQuickToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme()
  const Icon = theme === 'dark' ? Moon : Sun
  const label = theme === 'dark' ? '深色主题' : '浅色主题'

  return (
    <button
      type="button"
      role="switch"
      aria-checked={theme === 'dark'}
      aria-label={`切换主题（当前${label}）`}
      onClick={toggleTheme}
      className={cn(
        'tap flex shrink-0 items-center justify-center rounded-full text-mute transition-[background-color,color]',
        'hover:bg-wash hover:text-bone active:bg-wash-strong',
        className,
      )}
    >
      <Icon aria-hidden className="size-[17px]" strokeWidth={1.8} />
    </button>
  )
}

export function ThemeModePicker() {
  const { theme, setTheme } = useTheme()

  return (
    <fieldset aria-label="配色主题" className="m-0 grid grid-cols-2 gap-2.5 border-0 p-0">
      {MODES.map((mode) => {
        const Icon = mode.icon
        const active = theme === mode.value
        return (
          <button
            key={mode.value}
            type="button"
            aria-pressed={active}
            onClick={() => setTheme(mode.value)}
            className={cn(
              'tap flex min-h-[58px] items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-[background-color,border-color,color]',
              active
                ? 'border-signal/35 bg-signal/[0.075] text-bone ring-1 ring-inset ring-signal/10'
                : 'border-line bg-ink-900/45 text-mist hover:border-ink-500 hover:bg-ink-800/50',
            )}
          >
            <span
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-xl border',
                active
                  ? 'border-signal/25 bg-signal/10 text-signal'
                  : 'border-line bg-ink-900 text-mute',
              )}
            >
              <Icon aria-hidden className="size-[17px]" strokeWidth={1.8} />
            </span>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-semibold">{mode.label}</span>
              <span className="mt-0.5 hidden truncate font-mono text-[8.5px] tracking-[0.05em] text-mute min-[360px]:block">
                {mode.detail}
              </span>
            </span>
          </button>
        )
      })}
    </fieldset>
  )
}
