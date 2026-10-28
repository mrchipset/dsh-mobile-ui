import {
  type ClientMessage,
  clientMessageSchema,
  type ServerMessage,
  serverMessageSchema,
} from '@dsh-mobile/protocol'

export type BridgeStatus =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'ready'
  | 'reconnecting'
  | 'unauthorized'
  | 'offline'

export interface BridgeClientHandlers {
  onMessage: (message: ServerMessage) => void
  onStatus: (status: BridgeStatus, detail?: string) => void
}

const MAX_BACKOFF_MS = 8000
const BASE_BACKOFF_MS = 800

function resolveSocketUrl(): string {
  const configured = import.meta.env.VITE_BRIDGE_WS_URL
  const fallbackProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const fallback = `${fallbackProtocol}//${window.location.host}/ws`

  if (configured === undefined || configured.trim().length === 0) return fallback

  const value = configured.trim()
  if (value.startsWith('ws://') || value.startsWith('wss://')) return value
  if (value.startsWith('http://')) return `ws://${value.slice('http://'.length)}`
  if (value.startsWith('https://')) return `wss://${value.slice('https://'.length)}`
  if (value.startsWith('/')) return `${fallbackProtocol}//${window.location.host}${value}`
  return value
}

/**
 * Thin browser WebSocket transport for the Bridge protocol.
 * It owns reconnection and wire validation; session semantics live in the store.
 */
export class BridgeClient {
  private socket: WebSocket | null = null
  private token = ''
  private deviceId = ''
  private attempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private generation = 0
  private wanted = false
  private ready = false

  constructor(private readonly handlers: BridgeClientHandlers) {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline)
      document.addEventListener('visibilitychange', this.handleVisibility)
    }
  }

  get url(): string {
    return resolveSocketUrl()
  }

  connect(token: string, deviceId: string): void {
    this.token = token
    this.deviceId = deviceId
    this.wanted = true
    this.attempts = 0
    this.openSocket()
  }

  disconnect(): void {
    this.wanted = false
    this.token = ''
    this.ready = false
    this.attempts = 0
    this.generation += 1
    this.clearReconnect()
    const socket = this.socket
    this.socket = null
    if (socket !== null) {
      socket.onopen = null
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
      try {
        socket.close(1000, 'client disconnect')
      } catch {
        // Already closed.
      }
    }
    this.handlers.onStatus('idle')
  }

  send(message: ClientMessage): boolean {
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN || !this.ready) {
      return false
    }
    const parsed = clientMessageSchema.safeParse(message)
    if (!parsed.success) return false
    try {
      this.socket.send(JSON.stringify(parsed.data))
      return true
    } catch {
      return false
    }
  }

  private openSocket(): void {
    if (!this.wanted || this.token.length === 0) return
    if (this.socket !== null && this.socket.readyState <= WebSocket.OPEN) return

    this.clearReconnect()
    this.generation += 1
    const generation = this.generation
    this.ready = false
    this.handlers.onStatus(this.attempts === 0 ? 'connecting' : 'reconnecting')

    let socket: WebSocket
    try {
      socket = new WebSocket(resolveSocketUrl())
    } catch {
      this.handlers.onStatus('offline', '无法创建 WebSocket 连接')
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.onopen = (): void => {
      if (generation !== this.generation) return
      this.handlers.onStatus('authenticating')
      if (!this.sendAuth(socket)) {
        this.ready = false
        this.handlers.onStatus('offline', '本地令牌格式不正确')
        socket.close(4001, 'invalid auth')
      }
    }

    socket.onmessage = (event: MessageEvent): void => {
      if (generation !== this.generation) return
      const data: unknown = event.data
      if (typeof data !== 'string') return

      let value: unknown
      try {
        value = JSON.parse(data) as unknown
      } catch {
        return
      }
      const parsed = serverMessageSchema.safeParse(value)
      if (!parsed.success) return

      const message = parsed.data
      if (message.type === 'ready') {
        this.ready = true
        this.attempts = 0
        this.handlers.onStatus('ready')
      }
      if (message.type === 'error' && message.code === 'unauthorized') {
        this.wanted = false
        this.ready = false
        this.handlers.onStatus('unauthorized')
      }
      this.handlers.onMessage(message)
    }

    socket.onclose = (event: CloseEvent): void => {
      if (generation !== this.generation) return
      this.socket = null
      this.ready = false
      if (!this.wanted) return
      if (event.code === 4401) {
        this.wanted = false
        this.handlers.onStatus('unauthorized')
        return
      }
      this.scheduleReconnect()
    }

    socket.onerror = (): void => {
      // `onclose` follows and owns the retry decision.
    }
  }

  private sendAuth(socket: WebSocket): boolean {
    const parsed = clientMessageSchema.safeParse({
      type: 'auth',
      token: this.token,
      deviceId: this.deviceId,
    })
    if (!parsed.success) return false
    try {
      socket.send(JSON.stringify(parsed.data))
      return true
    } catch {
      return false
    }
  }

  private scheduleReconnect(): void {
    if (!this.wanted) return
    if (this.reconnectTimer !== undefined) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.handlers.onStatus('offline', '设备已离线')
      return
    }

    this.attempts += 1
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** (this.attempts - 1), MAX_BACKOFF_MS)
    const jitter = Math.round(Math.random() * 250)
    this.handlers.onStatus('reconnecting', `第 ${this.attempts} 次重连`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.openSocket()
    }, delay + jitter)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer === undefined) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
  }

  private readonly handleOnline = (): void => {
    if (!this.wanted || this.token.length === 0) return
    if (this.socket !== null && this.socket.readyState <= WebSocket.OPEN) return
    this.attempts = 0
    this.openSocket()
  }

  private readonly handleVisibility = (): void => {
    if (document.visibilityState !== 'visible') return
    this.handleOnline()
  }
}
