import { Loader2 } from 'lucide-react'
import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'subtle'
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  leading?: ReactNode
  trailing?: ReactNode
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-signal text-[#0a1006] hover:bg-signal-strong active:bg-signal shadow-[0_12px_36px_-16px_rgba(201,247,90,0.65)]',
  secondary:
    'border border-line bg-ink-800 text-bone hover:border-ink-500 hover:bg-ink-700 active:bg-ink-800',
  ghost: 'text-mist hover:bg-white/[0.055] hover:text-bone active:bg-white/[0.08]',
  outline: 'border border-line text-bone hover:border-ink-500 hover:bg-white/[0.035]',
  danger:
    'border border-coral/25 bg-coral/10 text-coral hover:border-coral/45 hover:bg-coral/15 active:bg-coral/20',
  subtle: 'bg-white/[0.045] text-bone hover:bg-white/[0.075] active:bg-white/[0.09]',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-10 px-3.5 text-[13px]',
  md: 'h-12 px-5 text-sm',
  lg: 'h-14 px-6 text-[15px]',
  icon: 'h-11 w-11 p-0',
  'icon-sm': 'h-9 w-9 p-0',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'secondary',
    size = 'md',
    loading = false,
    leading,
    trailing,
    children,
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled === true || loading}
      className={cn(
        'tap inline-flex select-none items-center justify-center gap-2 rounded-full font-medium',
        'transition-[background-color,border-color,color,transform,box-shadow] duration-200',
        'active:scale-[0.975] disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : leading}
      {children}
      {trailing}
    </button>
  )
})
