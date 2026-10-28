import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type BadgeTone = 'signal' | 'coral' | 'amber' | 'ice' | 'muted' | 'ink'

const TONES: Record<BadgeTone, string> = {
  signal: 'border-signal/25 bg-signal/10 text-signal',
  coral: 'border-coral/25 bg-coral/10 text-coral',
  amber: 'border-amber/25 bg-amber/10 text-amber',
  ice: 'border-ice/25 bg-ice/10 text-ice',
  muted: 'border-line bg-wash-soft text-mist',
  ink: 'border-transparent bg-ink-800 text-mist',
}

interface BadgeProps {
  tone?: BadgeTone
  dot?: boolean
  children: ReactNode
  className?: string
  pulse?: boolean
}

export function Badge({ tone = 'muted', dot = false, children, className, pulse }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1',
        'font-mono text-[10px] font-medium leading-none tracking-[0.08em] whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden
          className={cn('relative size-1.5 rounded-full bg-current', pulse && 'beacon')}
        />
      ) : null}
      {children}
    </span>
  )
}
