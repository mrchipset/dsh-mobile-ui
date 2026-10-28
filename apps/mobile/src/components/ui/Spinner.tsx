import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

export function Spinner({ className, label = '加载中' }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className={cn('inline-flex items-center', className)}>
      <Loader2 aria-hidden className="size-4 animate-spin" />
    </span>
  )
}
