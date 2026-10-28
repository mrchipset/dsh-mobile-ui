import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
  contentClassName?: string
}

/**
 * Bottom sheet built on Radix Dialog. Safe-area aware, capped to the viewport,
 * and always exposes a title for assistive technology.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  eyebrow,
  children,
  footer,
  className,
  contentClassName,
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay fixed inset-0 z-50 bg-scrim backdrop-blur-[3px]" />
        <Dialog.Content
          className={cn(
            'sheet-panel fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90dvh] w-full max-w-[560px] flex-col',
            'rounded-t-[30px] border-t border-line bg-ink-900/97 shadow-sheet',
            'outline-none',
            className,
          )}
        >
          <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-handle" />
          <header className="flex items-start justify-between gap-4 px-5 pb-4 pt-4">
            <div className="min-w-0">
              {eyebrow !== undefined ? (
                <p className="mono-label mb-2 text-mute">{eyebrow}</p>
              ) : null}
              <Dialog.Title className="text-[19px] font-semibold leading-tight text-bone">
                {title}
              </Dialog.Title>
              {description !== undefined ? (
                <Dialog.Description className="mt-1.5 text-[13px] leading-relaxed text-mist">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close
              aria-label="关闭"
              className="tap -mr-1 -mt-1 flex shrink-0 items-center justify-center rounded-full text-mute transition hover:bg-wash hover:text-bone"
            >
              <X className="size-5" />
            </Dialog.Close>
          </header>
          <div
            className={cn(
              'screen-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5',
              contentClassName,
            )}
          >
            {children}
          </div>
          {footer !== undefined ? (
            <div className="safe-bottom shrink-0 border-t border-line/70 bg-ink-900/80 px-5 pb-3 pt-4">
              {footer}
            </div>
          ) : (
            <div className="safe-bottom shrink-0 pb-1" />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
