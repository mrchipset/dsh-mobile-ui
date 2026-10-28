import {
  type ClientMessage,
  clientMessageSchema,
  fold,
  type PermissionOption,
  type PermissionRequest,
  type StoredUpdate,
} from '@dsh-mobile/protocol'
import type { FastifyInstance } from 'fastify'
import { BridgeError, mapAcpError } from '../acp/errors.js'
import type { AcpSupervisor, PermissionAnswer } from '../acp/supervisor.js'
import { verifyToken } from '../auth.js'
import type { Config } from '../config.js'
import { errorSummary, type Logger } from '../logger.js'
import type { LeaseManagerPort, SessionRepository } from '../ports.js'
import { type HubClient, WsHub } from './hub.js'

const AUTH_TIMEOUT_MS = 10_000

export interface WsRouteDeps {
  config: Config
  repo: SessionRepository
  lease: LeaseManagerPort
  supervisor?: AcpSupervisor
  logger: Logger
  permissionTtlMs?: number
}

interface RouteClient extends HubClient {
  authenticated: boolean
  authTimer?: NodeJS.Timeout
}

interface PendingPermission {
  requestId: string
  sessionId: string
  deviceId: string
  toolCall: { toolCallId: string; title?: string }
  options: PermissionOption[]
  timer: NodeJS.Timeout
  resolve: (answer: PermissionAnswer) => void
}

function rawToString(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8')
  if (Array.isArray(raw)) return Buffer.concat(raw as Buffer[]).toString('utf8')
  if (raw instanceof Uint8Array) return Buffer.from(raw).toString('utf8')
  return String(raw)
}

function updateKind(update: unknown): string {
  if (typeof update === 'object' && update !== null && 'sessionUpdate' in update) {
    const value = (update as { sessionUpdate?: unknown }).sessionUpdate
    if (typeof value === 'string') return value
  }
  return 'unknown'
}

function requestTypeOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('type' in value)) return undefined
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' ? type : undefined
}

/**
 * Registers `/ws` and the supervisor fan-out. Nothing here may throw out of a
 * socket handler; every failure becomes a protocol `error` message.
 */
export function registerWsRoutes(app: FastifyInstance, deps: WsRouteDeps): WsHub {
  const hub = new WsHub(deps.lease)
  hub.start()

  const promptInFlight = new Set<string>()
  const promptKeys = new Map<string, true>()
  const persistChains = new Map<string, Promise<void>>()
  const pendingPermissions = new Map<string, PendingPermission>()
  const disposers: Array<() => void> = []

  function sendError(
    client: RouteClient,
    code: string,
    message: string,
    retryable = false,
    requestType?: string,
  ): void {
    hub.send(client, {
      type: 'error',
      code,
      message,
      retryable,
      ...(requestType === undefined ? {} : { requestType }),
    })
  }

  function requireSupervisor(): AcpSupervisor {
    if (deps.supervisor === undefined) {
      throw new BridgeError('agent_unavailable', 'ACP is disabled on this Bridge', false)
    }
    if (!deps.supervisor.isReady()) {
      throw new BridgeError('agent_disconnected', 'ACP agent is not ready', true)
    }
    return deps.supervisor
  }

  function enqueuePersist(sessionId: string, task: () => Promise<void>): void {
    const previous = persistChains.get(sessionId) ?? Promise.resolve()
    const next = previous.then(task).catch((error: unknown) => {
      deps.logger.warn({ error: errorSummary(error) }, 'failed to persist ACP update')
    })
    persistChains.set(sessionId, next)
    void next.then(() => {
      if (persistChains.get(sessionId) === next) persistChains.delete(sessionId)
    })
  }

  async function liveSummary(sessionId: string): Promise<{
    lease: Awaited<ReturnType<LeaseManagerPort['snapshot']>>
    running: boolean
  }> {
    return {
      lease: await deps.lease.snapshot(sessionId),
      running: promptInFlight.has(sessionId),
    }
  }

  function pendingForSession(sessionId: string): PermissionRequest | undefined {
    for (const pending of pendingPermissions.values()) {
      if (pending.sessionId !== sessionId) continue
      return {
        requestId: pending.requestId,
        sessionId: pending.sessionId,
        toolCall: pending.toolCall,
        options: pending.options,
      }
    }
    return undefined
  }

  async function sendSnapshot(client: RouteClient, sessionId: string): Promise<void> {
    const summary = await deps.repo.get(sessionId)
    if (summary === undefined) {
      sendError(client, 'session_gone', 'Session not found', false, 'session.attach')
      return
    }

    const updates: StoredUpdate[] =
      summary.lastSeq === 0 ? [] : await deps.repo.range(sessionId, 1, summary.lastSeq)
    const first = updates[0]
    const historyTruncated = first !== undefined && first.seq > 1
    const historyStartsAt = first?.createdAt ?? summary.createdAt
    const blocks = fold(updates, { historyStartsAt, historyTruncated })
    const live = await liveSummary(sessionId)
    const pendingPermission = pendingForSession(sessionId)

    hub.send(client, {
      type: 'session.snapshot',
      session: { ...summary, lease: live.lease, running: live.running },
      seq: summary.lastSeq,
      blocks,
      updates,
      historyStartsAt,
      historyTruncated,
      ...(pendingPermission === undefined ? {} : { pendingPermission }),
    })
  }

  function authenticate(client: RouteClient, token: string, deviceId: string): void {
    if (deviceId.length === 0 || !verifyToken(token, deps.config.bridgeSecret)) {
      sendError(client, 'unauthorized', 'Invalid token or device id')
      client.socket.close(4401, 'unauthorized')
      return
    }
    if (client.authTimer !== undefined) {
      clearTimeout(client.authTimer)
      client.authTimer = undefined
    }

    const previous = hub.clientForDevice(deviceId)
    if (previous !== undefined && previous !== client) {
      hub.remove(previous)
      try {
        previous.socket.close(4000, 'replaced')
      } catch {
        // Already closed.
      }
    }

    client.deviceId = deviceId
    client.authenticated = true
    hub.add(client)
    hub.send(client, { type: 'ready', deviceId })
  }

  async function dispatch(client: RouteClient, message: ClientMessage): Promise<void> {
    switch (message.type) {
      case 'auth':
        hub.send(client, { type: 'ready', deviceId: client.deviceId })
        return

      case 'session.list': {
        const sessions = await deps.repo.list()
        const live = await Promise.all(
          sessions.map(async (summary) => ({
            ...summary,
            ...(await liveSummary(summary.id)),
          })),
        )
        hub.send(client, { type: 'session.list', sessions: live })
        return
      }

      case 'session.create': {
        const supervisor = requireSupervisor()
        const sessionId = await supervisor.newSession({ cwd: deps.config.workspaceRoot })
        const now = Date.now()
        await deps.repo.upsert({
          id: sessionId,
          title: null,
          cwd: deps.config.workspaceRoot,
          createdAt: now,
          lastActivityAt: now,
          lastSeq: 0,
          lease: { state: 'idle', holder: null },
          running: false,
        })
        await deps.lease.take(sessionId, client.deviceId)
        hub.subscribe(sessionId, client)
        await sendSnapshot(client, sessionId)
        return
      }

      case 'session.attach': {
        const summary = await deps.repo.get(message.sessionId)
        if (summary === undefined) {
          sendError(client, 'session_gone', 'Session not found', false, message.type)
          return
        }
        await deps.lease.attach(message.sessionId, client.deviceId)
        hub.subscribe(message.sessionId, client)
        await sendSnapshot(client, message.sessionId)
        return
      }

      case 'session.detach': {
        hub.unsubscribe(message.sessionId, client)
        await deps.lease.detach(message.sessionId, client.deviceId)
        return
      }

      case 'session.prompt': {
        const supervisor = requireSupervisor()
        if (promptInFlight.has(message.sessionId)) {
          throw new BridgeError('prompt_in_flight', 'A prompt is already in flight', false)
        }

        const dedupeKey = `${message.sessionId}:${message.clientMsgId}`
        if (promptKeys.has(dedupeKey)) return

        const summary = await deps.repo.get(message.sessionId)
        if (summary === undefined) {
          throw new BridgeError('session_gone', 'Session not found', false)
        }

        const holder = await deps.lease.holder(message.sessionId)
        if (holder === null) {
          await deps.lease.take(message.sessionId, client.deviceId)
        } else {
          await deps.lease.assertWriter(message.sessionId, client.deviceId)
        }

        promptKeys.set(dedupeKey, true)
        promptInFlight.add(message.sessionId)

        try {
          // Lazy activation: reads never resume an agent, but a write must.
          if (!supervisor.isActiveSession(message.sessionId)) {
            await supervisor.resumeSession({ sessionId: message.sessionId, cwd: summary.cwd })
          }

          const seq = await deps.repo.nextSeq(message.sessionId)
          const payload = {
            sessionUpdate: 'user_message_chunk',
            messageId: message.clientMsgId,
            content: { type: 'text', text: message.text },
          }
          await deps.repo.append(message.sessionId, seq, 'user_message_chunk', payload)
          hub.broadcast(message.sessionId, {
            type: 'session.update',
            sessionId: message.sessionId,
            seq,
            update: payload,
          })

          const stopReason = await supervisor.prompt(message.sessionId, message.text)
          promptInFlight.delete(message.sessionId)
          hub.broadcast(message.sessionId, {
            type: 'session.prompt.done',
            sessionId: message.sessionId,
            clientMsgId: message.clientMsgId,
            stopReason,
          })
        } catch (error) {
          promptInFlight.delete(message.sessionId)
          promptKeys.delete(dedupeKey)
          throw error
        }
        return
      }

      case 'session.cancel': {
        const supervisor = requireSupervisor()
        await supervisor.cancel(message.sessionId)
        return
      }

      case 'session.lease': {
        // The lease manager broadcasts the resulting snapshot to subscribers,
        // which also notifies a previous writer that it is now read-only.
        if (message.action === 'take') {
          await deps.lease.take(message.sessionId, client.deviceId)
        } else {
          await deps.lease.release(message.sessionId, client.deviceId)
        }
        return
      }

      case 'permission.answer': {
        const pending = pendingPermissions.get(message.requestId)
        if (pending === undefined) {
          sendError(client, 'permission_gone', 'Permission request is no longer pending', false)
          return
        }
        await deps.lease.assertWriter(pending.sessionId, client.deviceId)

        const option = pending.options.find((candidate) => candidate.optionId === message.optionId)
        if (option === undefined) {
          sendError(client, 'permission_gone', 'Unknown permission option', false)
          return
        }

        const outcome =
          option.kind === 'allow_once' || option.kind === 'allow_always' ? 'allowed' : 'rejected'
        clearTimeout(pending.timer)
        pendingPermissions.delete(message.requestId)
        pending.resolve({ outcome, optionId: option.optionId })
        hub.broadcast(pending.sessionId, {
          type: 'permission.resolved',
          requestId: pending.requestId,
          outcome,
        })
        return
      }

      case 'config.set': {
        const supervisor = requireSupervisor()
        await supervisor.setConfig(message.sessionId, message.configId, message.value)
        return
      }

      case 'mcp.subscribe': {
        hub.send(client, { type: 'mcp.status', servers: [] })
        return
      }
    }
  }

  async function handleMessage(client: RouteClient, raw: unknown): Promise<void> {
    try {
      const text = rawToString(raw)
      let value: unknown
      try {
        value = JSON.parse(text) as unknown
      } catch {
        sendError(client, 'invalid_message', 'Message must be valid JSON')
        return
      }

      const requestType = requestTypeOf(value)
      const parsed = clientMessageSchema.safeParse(value)
      if (!parsed.success) {
        sendError(
          client,
          'invalid_message',
          parsed.error.issues[0]?.message ?? 'Invalid message',
          false,
          requestType,
        )
        return
      }

      const message = parsed.data
      if (!client.authenticated) {
        if (message.type !== 'auth') {
          sendError(
            client,
            'unauthorized',
            'Authenticate before sending messages',
            false,
            message.type,
          )
          client.socket.close(4401, 'unauthorized')
          return
        }
        authenticate(client, message.token, message.deviceId)
        return
      }

      try {
        await dispatch(client, message)
      } catch (error) {
        const mapped = error instanceof BridgeError ? error : mapAcpError(error)
        sendError(client, mapped.code, mapped.message, mapped.retryable, message.type)
      }
    } catch (error) {
      const mapped = error instanceof BridgeError ? error : mapAcpError(error)
      sendError(client, mapped.code, mapped.message, mapped.retryable)
    }
  }

  async function handleDisconnect(client: RouteClient): Promise<void> {
    if (client.authTimer !== undefined) {
      clearTimeout(client.authTimer)
      client.authTimer = undefined
    }
    const subscriptions = [...client.subscriptions]
    hub.remove(client)

    if (client.deviceId.length === 0) return
    for (const sessionId of subscriptions) {
      try {
        await deps.lease.detach(sessionId, client.deviceId)
      } catch {
        // A detach failure must not keep the socket registry dirty.
      }
    }
  }

  app.get('/ws', { websocket: true }, (socket) => {
    const client: RouteClient = {
      deviceId: '',
      socket,
      subscriptions: new Set(),
      alive: true,
      authenticated: false,
    }

    client.authTimer = setTimeout(() => {
      if (!client.authenticated) {
        try {
          client.socket.close(4401, 'authentication timeout')
        } catch {
          // Already gone.
        }
      }
    }, AUTH_TIMEOUT_MS)
    client.authTimer.unref?.()

    socket.on('message', (raw) => {
      void handleMessage(client, raw)
    })
    socket.on('close', () => {
      void handleDisconnect(client)
    })
    socket.on('error', () => {
      try {
        socket.terminate()
      } catch {
        // Already gone.
      }
    })
  })

  if (deps.supervisor !== undefined) {
    const supervisor = deps.supervisor

    disposers.push(
      supervisor.onUpdate(({ sessionId, update }) => {
        enqueuePersist(sessionId, async () => {
          const seq = await deps.repo.nextSeq(sessionId)
          await deps.repo.append(sessionId, seq, updateKind(update), update)
          await deps.repo.prune(sessionId, deps.config.retentionUpdates)
          hub.broadcast(sessionId, {
            type: 'session.update',
            sessionId,
            seq,
            update,
          })
        })
      }),
    )

    disposers.push(
      supervisor.onTitle(({ sessionId, title }) => {
        void deps.repo.rename(sessionId, title).catch((error: unknown) => {
          deps.logger.debug({ error: errorSummary(error) }, 'failed to persist session title')
        })
      }),
    )

    disposers.push(
      supervisor.onPermission(
        (ask) =>
          new Promise<PermissionAnswer>((resolve) => {
            let settled = false
            const settle = (answer: PermissionAnswer): void => {
              if (settled) return
              settled = true
              resolve(answer)
            }

            void (async () => {
              const writer = await hub.writerFor(ask.sessionId)
              if (writer === undefined) {
                settle({ outcome: 'cancelled' })
                return
              }

              const timer = setTimeout(() => {
                const pending = pendingPermissions.get(ask.requestId)
                if (pending === undefined) return
                pendingPermissions.delete(ask.requestId)
                hub.broadcast(ask.sessionId, {
                  type: 'permission.resolved',
                  requestId: ask.requestId,
                  outcome: 'cancelled',
                })
                settle({ outcome: 'cancelled' })
              }, deps.permissionTtlMs ?? deps.config.permissionTtlMs)
              timer.unref?.()

              pendingPermissions.set(ask.requestId, {
                requestId: ask.requestId,
                sessionId: ask.sessionId,
                deviceId: writer.deviceId,
                toolCall: ask.toolCall,
                options: ask.options,
                timer,
                resolve: settle,
              })

              hub.send(writer, {
                type: 'permission.request',
                sessionId: ask.sessionId,
                requestId: ask.requestId,
                toolCall: ask.toolCall,
                options: ask.options,
              })
            })().catch(() => {
              settle({ outcome: 'cancelled' })
            })
          }),
      ),
    )

    disposers.push(supervisor.onStatus(() => {}))
  }

  disposers.push(
    deps.lease.onChange(({ sessionId, lease }) => {
      hub.broadcast(sessionId, { type: 'session.lease', sessionId, lease })
    }),
  )

  app.addHook('onClose', async () => {
    for (const pending of pendingPermissions.values()) {
      clearTimeout(pending.timer)
      pending.resolve({ outcome: 'cancelled' })
    }
    pendingPermissions.clear()
    for (const dispose of disposers) dispose()
    hub.stop()
  })

  return hub
}
