import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import {
  type PermissionOption as AcpPermissionOption,
  type ClientConnection,
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionId,
  type SessionUpdate,
  type StopReason,
} from '@agentclientprotocol/sdk'
import type { PermissionOption } from '@dsh-mobile/protocol'
import { errorSummary, type Logger } from '../logger.js'
import { BridgeError, mapAcpError } from './errors.js'

export type AgentStatus = 'starting' | 'ready' | 'restarting' | 'disconnected' | 'stopped'

export interface AcpSupervisorOptions {
  bin: string
  args: string[]
  cwd: string
  dshHome?: string
}

export interface PermissionAsk {
  sessionId: SessionId
  requestId: string
  toolCall: { toolCallId: string; title?: string }
  options: PermissionOption[]
}

export type PermissionOutcome = 'allowed' | 'rejected' | 'cancelled'

export interface PermissionAnswer {
  outcome: PermissionOutcome
  optionId?: string
}

export interface TitleEvent {
  sessionId: SessionId
  title: string
}

export interface RemoteSession {
  sessionId: SessionId
  cwd: string
  title?: string | null
}

type UpdateHandler = (event: { sessionId: SessionId; update: SessionUpdate }) => void
type PermissionHandler = (ask: PermissionAsk) => Promise<PermissionAnswer>
type TitleHandler = (event: TitleEvent) => void
type StatusHandler = (status: AgentStatus) => void

const MAX_RESTART_ATTEMPTS = 10
const BASE_RESTART_DELAY_MS = 500
const MAX_RESTART_DELAY_MS = 30_000
const MAX_STDERR_CHARS = 8192

/**
 * Owns the single `dsh --profile acp` child process, its stdio JSON-RPC
 * connection, restart backoff, and the set of active sessions.
 */
export class AcpSupervisor {
  private child: ChildProcessWithoutNullStreams | undefined
  private connection: ClientConnection | undefined
  private currentStatus: AgentStatus = 'stopped'
  private intentionalStop = false
  private disconnectHandled = false
  private restartAttempts = 0
  private restartTimer: NodeJS.Timeout | undefined
  private stderrBuffer = ''

  private readonly activeSessions = new Set<SessionId>()
  private readonly updateHandlers = new Set<UpdateHandler>()
  private readonly permissionHandlers = new Set<PermissionHandler>()
  private readonly titleHandlers = new Set<TitleHandler>()
  private readonly statusHandlers = new Set<StatusHandler>()

  constructor(
    private readonly options: AcpSupervisorOptions,
    private readonly logger: Logger,
  ) {}

  get status(): AgentStatus {
    return this.currentStatus
  }

  isReady(): boolean {
    return (
      this.currentStatus === 'ready' &&
      this.connection !== undefined &&
      this.child !== undefined &&
      this.child.exitCode === null
    )
  }

  isActiveSession(sessionId: SessionId): boolean {
    return this.activeSessions.has(sessionId)
  }

  async start(): Promise<void> {
    if (this.isReady()) return
    this.intentionalStop = false
    this.disconnectHandled = false
    this.restartAttempts = 0
    await this.connect()
  }

  async stop(): Promise<void> {
    if (this.currentStatus === 'stopped' && this.child === undefined) return
    this.intentionalStop = true
    if (this.restartTimer !== undefined) {
      clearTimeout(this.restartTimer)
      this.restartTimer = undefined
    }

    const child = this.child
    try {
      this.connection?.close()
    } catch {
      // Already closed.
    }
    this.connection = undefined
    this.activeSessions.clear()
    await this.killChild(child)
    this.child = undefined
    this.disconnectHandled = true
    this.setStatus('stopped')
  }

  async newSession(input: { cwd: string }): Promise<SessionId> {
    const connection = this.requireConnection()
    return this.call(async () => {
      const response = await connection.agent.request(methods.agent.session.new, {
        cwd: input.cwd,
        mcpServers: [],
      })
      this.activeSessions.add(response.sessionId)
      return response.sessionId
    })
  }

  async resumeSession(input: { sessionId: SessionId; cwd: string }): Promise<void> {
    const connection = this.requireConnection()
    await this.call(async () => {
      await connection.agent.request(methods.agent.session.resume, {
        sessionId: input.sessionId,
        cwd: input.cwd,
        mcpServers: [],
      })
      this.activeSessions.add(input.sessionId)
    })
  }

  async prompt(sessionId: SessionId, text: string): Promise<StopReason> {
    const connection = this.requireConnection()
    return this.call(async () => {
      const response = await connection.agent.request(methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: 'text', text }],
      })
      return response.stopReason
    })
  }

  async cancel(sessionId: SessionId): Promise<void> {
    const connection = this.requireConnection()
    await this.call(() => connection.agent.notify(methods.agent.session.cancel, { sessionId }))
  }

  async setConfig(sessionId: SessionId, configId: string, value: string): Promise<void> {
    const connection = this.requireConnection()
    await this.call(async () => {
      await connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId,
        configId,
        value,
      })
    })
  }

  async closeSession(sessionId: SessionId): Promise<void> {
    const connection = this.requireConnection()
    await this.call(async () => {
      await connection.agent.request(methods.agent.session.close, { sessionId })
      this.activeSessions.delete(sessionId)
    })
  }

  async listRemoteSessions(): Promise<RemoteSession[]> {
    const connection = this.requireConnection()
    return this.call(async () => {
      const response = await connection.agent.request(methods.agent.session.list, {})
      return response.sessions.map((session) => ({
        sessionId: session.sessionId,
        cwd: session.cwd,
        ...(session.title === undefined ? {} : { title: session.title }),
      }))
    })
  }

  onUpdate(handler: UpdateHandler): () => void {
    this.updateHandlers.add(handler)
    return () => {
      this.updateHandlers.delete(handler)
    }
  }

  onPermission(handler: PermissionHandler): () => void {
    this.permissionHandlers.add(handler)
    return () => {
      this.permissionHandlers.delete(handler)
    }
  }

  onTitle(handler: TitleHandler): () => void {
    this.titleHandlers.add(handler)
    return () => {
      this.titleHandlers.delete(handler)
    }
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler)
    return () => {
      this.statusHandlers.delete(handler)
    }
  }

  private async connect(): Promise<void> {
    this.disconnectHandled = false
    this.setStatus('starting')

    let child: ChildProcessWithoutNullStreams
    try {
      child = this.spawnChild()
    } catch (error) {
      this.logger.warn({ error: errorSummary(error) }, 'failed to spawn ACP child')
      this.handleDisconnect('spawn failed')
      throw mapAcpError(error)
    }
    this.child = child

    child.stderr.on('data', (chunk: Buffer) => {
      this.appendStderr(chunk.toString('utf8'))
      this.logger.debug({ bytes: chunk.byteLength }, 'acp stderr chunk')
    })
    child.once('error', (error) => {
      this.logger.warn({ error: errorSummary(error) }, 'acp child process error')
      this.handleDisconnect('child error')
    })
    child.once('exit', (code, signal) => {
      this.logger.debug({ code, signal }, 'acp child exited')
      this.handleDisconnect('child exited')
    })

    const app = client({ name: 'dsh-mobile-bridge' })
      .onNotification(methods.client.session.update, ({ params }) => {
        this.emitUpdate(params.sessionId, params.update)
      })
      .onRequest(methods.client.session.requestPermission, ({ params }) =>
        this.handlePermissionRequest(params),
      )

    let connection: ClientConnection
    try {
      const stream = ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      )
      connection = app.connect(stream)
    } catch (error) {
      this.handleDisconnect('connect failed')
      throw mapAcpError(error)
    }
    this.connection = connection

    void connection.closed
      .catch((error: unknown) => {
        this.logger.debug({ error: errorSummary(error) }, 'acp connection closed with error')
      })
      .then(() => {
        this.handleDisconnect('connection closed')
      })

    try {
      await connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: 'dsh-mobile-bridge', version: '0.0.0' },
      })
      this.restartAttempts = 0
      this.setStatus('ready')
    } catch (error) {
      this.handleDisconnect('initialize failed')
      throw mapAcpError(error)
    }
  }

  private spawnChild(): ChildProcessWithoutNullStreams {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(this.options.dshHome === undefined ? {} : { DSH_HOME: this.options.dshHome }),
    }
    const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(this.options.bin)

    const child = spawn(this.options.bin, this.options.args, {
      cwd: this.options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(useShell ? { shell: true } : {}),
    })
    return child as ChildProcessWithoutNullStreams
  }

  private killChild(child: ChildProcessWithoutNullStreams | undefined): Promise<void> {
    if (child === undefined || child.exitCode !== null) return Promise.resolve()

    return new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      child.once('exit', finish)

      if (process.platform === 'win32' && child.pid !== undefined) {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
        })
        killer.once('error', () => {
          try {
            child.kill()
          } catch {
            finish()
          }
        })
      } else {
        try {
          child.kill('SIGTERM')
        } catch {
          finish()
        }
        const killTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            finish()
          }
        }, 5000)
        killTimer.unref?.()
      }

      const guard = setTimeout(finish, 6000)
      guard.unref?.()
    })
  }

  private handleDisconnect(reason: string): void {
    if (this.intentionalStop) {
      this.setStatus('stopped')
      return
    }
    if (this.disconnectHandled) return
    this.disconnectHandled = true

    this.logger.debug({ reason, sessions: this.activeSessions.size }, 'acp disconnected')
    this.connection = undefined
    this.child = undefined
    // After a crash/restart remote sessions must be resumed before use.
    this.activeSessions.clear()
    this.setStatus('disconnected')
    this.scheduleRestart()
  }

  private scheduleRestart(): void {
    if (this.intentionalStop || this.restartTimer !== undefined) return
    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      this.logger.warn({ attempts: this.restartAttempts }, 'acp restart attempts exhausted')
      return
    }

    const delay = Math.min(BASE_RESTART_DELAY_MS * 2 ** this.restartAttempts, MAX_RESTART_DELAY_MS)
    this.restartAttempts += 1
    this.setStatus('restarting')
    this.logger.info({ attempt: this.restartAttempts, delay }, 'scheduling acp restart')

    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      if (this.intentionalStop) return
      void this.connect().catch((error: unknown) => {
        this.logger.warn({ error: errorSummary(error) }, 'acp restart attempt failed')
      })
    }, delay)
    this.restartTimer.unref?.()
  }

  private requireConnection(): ClientConnection {
    if (!this.isReady() || this.connection === undefined) {
      throw new BridgeError('agent_disconnected', 'ACP agent is not ready', true)
    }
    return this.connection
  }

  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      throw mapAcpError(error)
    }
  }

  private emitUpdate(sessionId: SessionId, update: SessionUpdate): void {
    if (update.sessionUpdate === 'session_info_update' && typeof update.title === 'string') {
      for (const handler of this.titleHandlers) {
        try {
          handler({ sessionId, title: update.title })
        } catch {
          // Never let a consumer break the ACP notification pipeline.
        }
      }
    }

    for (const handler of this.updateHandlers) {
      try {
        handler({ sessionId, update })
      } catch {
        // Never let a consumer break the ACP notification pipeline.
      }
    }
  }

  private async handlePermissionRequest(
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    const ask: PermissionAsk = {
      sessionId: params.sessionId,
      requestId: randomUUID(),
      toolCall: {
        toolCallId: params.toolCall.toolCallId,
        ...(typeof params.toolCall.title === 'string' ? { title: params.toolCall.title } : {}),
      },
      options: params.options.map((option: AcpPermissionOption) => ({
        optionId: option.optionId,
        name: option.name,
        kind: option.kind,
      })),
    }

    for (const handler of this.permissionHandlers) {
      try {
        const answer = await handler(ask)
        if (answer.outcome === 'cancelled' || answer.optionId === undefined) {
          return { outcome: { outcome: 'cancelled' } }
        }
        return { outcome: { outcome: 'selected', optionId: answer.optionId } }
      } catch (error) {
        this.logger.debug({ error: errorSummary(error) }, 'permission handler failed')
      }
    }

    return { outcome: { outcome: 'cancelled' } }
  }

  private appendStderr(chunk: string): void {
    this.stderrBuffer += chunk
    if (this.stderrBuffer.length > MAX_STDERR_CHARS) {
      this.stderrBuffer = this.stderrBuffer.slice(-MAX_STDERR_CHARS)
    }
  }

  private setStatus(status: AgentStatus): void {
    if (this.currentStatus === status) return
    this.currentStatus = status
    this.logger.debug({ status }, 'acp status changed')
    for (const handler of this.statusHandlers) {
      try {
        handler(status)
      } catch {
        // Status listeners are best-effort.
      }
    }
  }
}
