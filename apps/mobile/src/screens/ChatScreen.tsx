import { useNavigate } from '@tanstack/react-router'
import { ArrowDown, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChatHeader } from '../components/chat/ChatHeader'
import { Composer } from '../components/chat/Composer'
import { LeaseSheet } from '../components/chat/LeaseSheet'
import { PermissionSheet } from '../components/chat/PermissionSheet'
import { Timeline } from '../components/chat/Timeline'
import { Button } from '../components/ui/Button'
import { sessionTitle } from '../lib/format'
import { useBridgeStore } from '../store/useBridgeStore'

function TimelineSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[560px] space-y-5 px-4 py-6">
      <div className="skeleton h-3 w-24 rounded-full" />
      <div className="flex justify-end">
        <div className="skeleton h-14 w-3/5 rounded-[21px]" />
      </div>
      <div className="flex gap-2.5">
        <div className="skeleton size-7 rounded-[9px]" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-3 w-11/12 rounded-full" />
          <div className="skeleton h-3 w-4/5 rounded-full" />
          <div className="skeleton h-3 w-2/3 rounded-full" />
        </div>
      </div>
      <div className="skeleton h-16 w-full rounded-[18px]" />
      <div className="flex justify-end">
        <div className="skeleton h-12 w-1/2 rounded-[21px]" />
      </div>
    </div>
  )
}

export function ChatScreen({ sessionId }: { sessionId: string }) {
  const mode = useBridgeStore((state) => state.mode)
  const status = useBridgeStore((state) => state.status)
  const deviceId = useBridgeStore((state) => state.deviceId)
  const session = useBridgeStore((state) => state.sessions[sessionId])
  const data = useBridgeStore((state) => state.data[sessionId])
  const pendingPrompt = useBridgeStore((state) => state.pendingPrompt[sessionId])
  const cancelling = useBridgeStore((state) => state.cancelling[sessionId] === true)
  const permissions = useBridgeStore((state) => state.permissions)
  const permissionReceivedAt = useBridgeStore((state) => state.permissionReceivedAt)
  const permissionBusy = useBridgeStore((state) => state.permissionBusy)
  const leaseBusy = useBridgeStore((state) => state.leaseBusy)
  const attachSession = useBridgeStore((state) => state.attachSession)
  const setActiveSession = useBridgeStore((state) => state.setActiveSession)
  const sendPrompt = useBridgeStore((state) => state.sendPrompt)
  const cancelPrompt = useBridgeStore((state) => state.cancelPrompt)
  const takeLease = useBridgeStore((state) => state.takeLease)
  const releaseLease = useBridgeStore((state) => state.releaseLease)
  const answerPermission = useBridgeStore((state) => state.answerPermission)

  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const [permissionOpen, setPermissionOpen] = useState(false)
  const [leaseOpen, setLeaseOpen] = useState(false)
  const [waited, setWaited] = useState(false)

  const permission =
    Object.values(permissions)
      .filter((request) => request.sessionId === sessionId)
      .sort(
        (left, right) =>
          (permissionReceivedAt[right.requestId] ?? 0) -
          (permissionReceivedAt[left.requestId] ?? 0),
      )[0] ?? null
  const permissionId = permission?.requestId ?? null

  useEffect(() => {
    attachSession(sessionId)
    return () => setActiveSession(null)
  }, [sessionId, attachSession, setActiveSession])

  useEffect(() => {
    setWaited(false)
    const timer = setTimeout(() => setWaited(true), 2600)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (permissionId !== null) setPermissionOpen(true)
    else setPermissionOpen(false)
  }, [permissionId])

  const scrollToBottom = useCallback((smooth: boolean) => {
    const element = scrollRef.current
    if (element === null) return
    element.scrollTo({
      top: element.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    })
  }, [])

  useEffect(() => {
    stickRef.current = true
    setAtBottom(true)
    const frame = requestAnimationFrame(() => scrollToBottom(false))
    return () => cancelAnimationFrame(frame)
  }, [scrollToBottom])

  const blockCount = data?.blocks.length ?? 0
  const updateCount = data?.updates.length ?? 0
  const pendingText = pendingPrompt?.text ?? null
  const scrollKey = `${String(blockCount)}:${String(updateCount)}:${permissionId ?? 'none'}:${String(pendingText?.length ?? 0)}`

  useEffect(() => {
    if (scrollKey.length === 0) return
    if (!stickRef.current) return
    const frame = requestAnimationFrame(() => scrollToBottom(false))
    return () => cancelAnimationFrame(frame)
  }, [scrollKey, scrollToBottom])

  useEffect(() => {
    const element = scrollRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (!stickRef.current) return
      requestAnimationFrame(() => scrollToBottom(false))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [scrollToBottom])

  const handleScroll = () => {
    const element = scrollRef.current
    if (element === null) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    const next = distance < 96
    stickRef.current = next
    setAtBottom(next)
  }

  const goBack = () => {
    void navigate({ to: '/sessions' })
  }

  const connected = mode === 'demo' || status === 'ready'
  const holder = session?.lease.holder ?? null
  const canPrompt = connected && (holder === null || holder === deviceId)
  const isWriter = holder === deviceId
  const title = session === undefined ? '会话' : sessionTitle(session)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ChatHeader
        session={session}
        sessionId={sessionId}
        deviceId={deviceId}
        running={session?.running === true}
        cancelling={cancelling}
        onBack={goBack}
        onOpenLease={() => setLeaseOpen(true)}
      />

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="screen-scroll h-full overflow-y-auto"
        >
          {data !== undefined ? (
            <Timeline
              blocks={data.blocks}
              live={session?.running === true}
              pendingPromptText={pendingText}
              permission={permission}
              onOpenPermission={() => setPermissionOpen(true)}
            />
          ) : session === undefined && waited ? (
            <div className="mx-auto mt-16 w-full max-w-[420px] px-5 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-line bg-ink-850">
                <ShieldAlert aria-hidden className="size-5 text-amber" />
              </div>
              <h2 className="editorial-cn mt-4 text-[23px] text-bone">打不开这个会话</h2>
              <p className="mt-2 text-[12px] leading-5 text-mist">
                它可能已被删除，或 Bridge 还没有这条记录。
              </p>
              <div className="mt-5 flex justify-center gap-2">
                <Button variant="secondary" onClick={goBack}>
                  返回列表
                </Button>
                <Button variant="primary" onClick={() => attachSession(sessionId)}>
                  重试
                </Button>
              </div>
            </div>
          ) : (
            <TimelineSkeleton />
          )}
        </div>

        {!atBottom ? (
          <button
            type="button"
            onClick={() => {
              stickRef.current = true
              setAtBottom(true)
              scrollToBottom(true)
            }}
            className="absolute bottom-4 right-4 z-20 flex h-10 items-center gap-1.5 rounded-full border border-line bg-ink-850/95 px-3 font-mono text-[10px] text-mist shadow-scroll backdrop-blur transition hover:border-signal/25 hover:text-bone"
          >
            <ArrowDown className="size-3.5" />
            回到底部
          </button>
        ) : null}
      </div>

      {session !== undefined ? (
        <Composer
          key={session.id}
          session={session}
          mode={mode}
          status={status}
          canPrompt={canPrompt}
          cancelling={cancelling}
          permissionPending={permission !== null}
          onSend={(text, audioId, clientMsgId) => sendPrompt(sessionId, text, audioId, clientMsgId)}
          onCancel={() => cancelPrompt(sessionId)}
          onOpenLease={() => setLeaseOpen(true)}
          onOpenPermission={() => setPermissionOpen(true)}
        />
      ) : null}

      {session !== undefined ? (
        <LeaseSheet
          open={leaseOpen}
          onOpenChange={setLeaseOpen}
          session={session}
          deviceId={deviceId}
          mode={mode}
          busy={leaseBusy}
          onTake={() => takeLease(sessionId)}
          onRelease={() => releaseLease(sessionId)}
        />
      ) : null}

      {permission !== null ? (
        <PermissionSheet
          key={permission.requestId}
          open={permissionOpen}
          onOpenChange={setPermissionOpen}
          request={permission}
          receivedAt={permissionReceivedAt[permission.requestId] ?? null}
          sessionTitle={title}
          mode={mode}
          isWriter={isWriter}
          busyOptionId={
            permissionBusy?.requestId === permission.requestId ? permissionBusy.optionId : null
          }
          onAnswer={answerPermission}
        />
      ) : null}
    </div>
  )
}
