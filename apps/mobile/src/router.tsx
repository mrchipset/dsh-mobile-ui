import { createRootRoute, createRoute, createRouter, Link, redirect } from '@tanstack/react-router'
import { AppShell } from './app/AppShell'
import { Button } from './components/ui/Button'
import { ChatScreen } from './screens/ChatScreen'
import { SessionsScreen } from './screens/SessionsScreen'
import { SettingsScreen } from './screens/SettingsScreen'

function NotFoundScreen() {
  return (
    <div className="mx-auto flex h-full w-full max-w-[420px] flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-[10px] tracking-[0.24em] text-mute">404 / OFF GRID</p>
      <h1 className="editorial-cn mt-3 text-[34px] text-bone">这里没有时间线</h1>
      <p className="mt-2 text-[12.5px] leading-6 text-mist">地址可能写错了，回会话目录看看。</p>
      <Link to="/sessions" className="mt-6">
        <Button variant="primary">回到会话</Button>
      </Link>
    </div>
  )
}

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFoundScreen,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/sessions' })
  },
})

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sessions',
  component: SessionsScreen,
})

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sessions/$sessionId',
  component: ChatRoute,
})

function ChatRoute() {
  const { sessionId } = chatRoute.useParams()
  return <ChatScreen key={sessionId} sessionId={sessionId} />
}

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsScreen,
})

const routeTree = rootRoute.addChildren([indexRoute, sessionsRoute, chatRoute, settingsRoute])

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
