import { Link, useLocation } from '@tanstack/react-router'
import { MessageSquare, Plus, Settings } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useBridgeStore } from '../../store/useBridgeStore'
import { Spinner } from '../ui/Spinner'

export function BottomNav() {
  const pathname = useLocation({ select: (location) => location.pathname })
  const creating = useBridgeStore((state) => state.creating)
  const createSession = useBridgeStore((state) => state.createSession)
  const sessionsActive = pathname === '/sessions'
  const settingsActive = pathname === '/settings'

  return (
    <nav
      aria-label="主导航"
      className="safe-bottom relative z-30 shrink-0 border-t border-line/70 nav-blur"
    >
      <div className="mx-auto grid h-[66px] w-full max-w-[560px] grid-cols-3 items-center px-4">
        <Link
          to="/sessions"
          aria-current={sessionsActive ? 'page' : undefined}
          className={cn(
            'tap flex h-14 flex-col items-center justify-center gap-1 rounded-2xl text-[10px] font-medium transition',
            sessionsActive ? 'text-signal' : 'text-mute hover:text-mist',
          )}
        >
          <MessageSquare className="size-[19px]" strokeWidth={sessionsActive ? 2.2 : 1.7} />
          <span>会话</span>
        </Link>

        <div className="flex justify-center">
          <button
            type="button"
            onClick={createSession}
            disabled={creating}
            aria-label="新建会话"
            className={cn(
              'group relative -mt-7 flex size-[54px] items-center justify-center rounded-full',
              'bg-signal text-[#0a1006] shadow-[0_18px_42px_-14px_rgba(201,247,90,0.75)]',
              'transition-transform duration-200 hover:scale-105 active:scale-95 disabled:opacity-60',
            )}
          >
            <span
              aria-hidden
              className="absolute inset-0 rounded-full border border-signal/50 blur-[1px]"
            />
            {creating ? <Spinner className="text-[#0a1006]" /> : <Plus className="size-6" />}
          </button>
        </div>

        <Link
          to="/settings"
          aria-current={settingsActive ? 'page' : undefined}
          className={cn(
            'tap flex h-14 flex-col items-center justify-center gap-1 rounded-2xl text-[10px] font-medium transition',
            settingsActive ? 'text-signal' : 'text-mute hover:text-mist',
          )}
        >
          <Settings className="size-[19px]" strokeWidth={settingsActive ? 2.2 : 1.7} />
          <span>设置</span>
        </Link>
      </div>
    </nav>
  )
}
