import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { type ReactNode, useEffect } from 'react'
import { Toaster } from 'sonner'
import { BottomNav } from '../components/layout/BottomNav'
import { useBridgeStore } from '../store/useBridgeStore'
import { ConnectingScreen, SplashScreen, WelcomeScreen } from './BootScreens'

export function AppShell() {
  const booted = useBridgeStore((state) => state.booted)
  const boot = useBridgeStore((state) => state.boot)
  const mode = useBridgeStore((state) => state.mode)
  const status = useBridgeStore((state) => state.status)
  const authToken = useBridgeStore((state) => state.authToken)
  const everConnected = useBridgeStore((state) => state.everConnected)
  const pendingNavigation = useBridgeStore((state) => state.pendingNavigation)
  const consumeNavigation = useBridgeStore((state) => state.consumeNavigation)

  const pathname = useLocation({ select: (location) => location.pathname })
  const navigate = useNavigate()

  useEffect(() => {
    boot()
  }, [boot])

  useEffect(() => {
    if (pendingNavigation === null) return
    const sessionId = pendingNavigation
    consumeNavigation()
    void navigate({ to: '/sessions/$sessionId', params: { sessionId } })
  }, [pendingNavigation, consumeNavigation, navigate])

  const showApp =
    mode === 'demo' || (everConnected && status !== 'unauthorized' && authToken.length > 0)
  const showWelcome = mode === 'live' && (status === 'unauthorized' || authToken.length === 0)
  const isChat = pathname.startsWith('/sessions/')

  let content: ReactNode
  if (!booted) content = <SplashScreen />
  else if (mode === 'demo' || showApp) content = <Outlet />
  else if (showWelcome) content = <WelcomeScreen />
  else content = <ConnectingScreen />

  return (
    <div className="relative h-dvh overflow-hidden bg-ink-950 text-bone">
      <div aria-hidden className="app-atmosphere" />
      <div className="relative z-10 flex h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-signal focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink-950"
        >
          跳到主要内容
        </a>
        <main id="main" className="relative min-h-0 flex-1">
          {content}
        </main>
        {booted && (mode === 'demo' || showApp) && !isChat ? <BottomNav /> : null}
      </div>
      <Toaster
        theme="dark"
        position="top-center"
        offset={14}
        gap={8}
        closeButton
        toastOptions={{
          style: {
            background: 'rgba(13, 18, 20, 0.96)',
            border: '1px solid #232c2e',
            color: '#f3f0e7',
            borderRadius: '16px',
            boxShadow: '0 24px 60px -30px rgba(0, 0, 0, 0.95)',
            fontFamily: 'Manrope, PingFang SC, Microsoft YaHei, sans-serif',
            fontSize: '13px',
          },
        }}
      />
    </div>
  )
}
