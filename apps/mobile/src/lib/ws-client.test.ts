import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BridgeClient, type BridgeStatus } from './ws-client'

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  sent: unknown[] = []
  closed = false

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as unknown)
  }

  close(): void {
    this.closed = true
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code: 1000 })
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  emit(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

describe('BridgeClient reconnect', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('window', {
      location: { protocol: 'http:', host: 'bridge.test' },
      addEventListener: vi.fn(),
    })
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      visibilityState: 'visible',
    })
    vi.stubGlobal('navigator', { onLine: true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('tears down a stale open socket and re-authenticates on explicit reconnect', () => {
    const statuses: BridgeStatus[] = []
    const client = new BridgeClient({
      onMessage: vi.fn(),
      onStatus: (status) => statuses.push(status),
    })

    client.connect('token-1234567890', 'device-1')
    const first = FakeWebSocket.instances[0]
    if (first === undefined) throw new Error('expected first WebSocket')
    first.readyState = FakeWebSocket.OPEN

    // Reproduces the stuck state: an OPEN socket that never reached `ready`.
    client.connect('token-1234567890', 'device-1')

    expect(first.closed).toBe(true)
    expect(FakeWebSocket.instances).toHaveLength(2)
    const second = FakeWebSocket.instances[1]
    if (second === undefined) throw new Error('expected second WebSocket')
    second.emitOpen()

    expect(second.sent[0]).toMatchObject({
      type: 'auth',
      token: 'token-1234567890',
      deviceId: 'device-1',
    })

    second.emit({ type: 'ready', deviceId: 'device-1' })
    expect(statuses).toContain('ready')
  })
})
