import type { ServerMessage } from '@dsh-mobile/protocol'
import WebSocket from 'ws'
import type { LeaseManagerPort } from '../ports.js'

export interface HubClient {
  deviceId: string
  socket: WebSocket
  subscriptions: Set<string>
  alive: boolean
}

const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Tracks authenticated sockets, their session subscriptions, and heartbeats.
 * It is deliberately thin: message semantics belong to the route layer.
 */
export class WsHub {
  private readonly bySocket = new Map<WebSocket, HubClient>()
  private readonly byDevice = new Map<string, HubClient>()
  private heartbeat: NodeJS.Timeout | undefined

  constructor(private readonly lease: LeaseManagerPort) {}

  start(): void {
    if (this.heartbeat !== undefined) return
    this.heartbeat = setInterval(() => {
      for (const client of this.bySocket.values()) {
        if (!client.alive) {
          client.socket.terminate()
          continue
        }
        client.alive = false
        try {
          client.socket.ping()
        } catch {
          client.socket.terminate()
        }
      }
    }, HEARTBEAT_INTERVAL_MS)
    this.heartbeat.unref?.()
  }

  stop(): void {
    if (this.heartbeat !== undefined) {
      clearInterval(this.heartbeat)
      this.heartbeat = undefined
    }
    for (const client of this.bySocket.values()) {
      try {
        client.socket.terminate()
      } catch {
        // Already gone.
      }
    }
    this.bySocket.clear()
    this.byDevice.clear()
  }

  add(client: HubClient): void {
    client.alive = true
    client.socket.on('pong', () => {
      client.alive = true
    })
    this.bySocket.set(client.socket, client)
    this.byDevice.set(client.deviceId, client)
  }

  remove(client: HubClient): void {
    this.bySocket.delete(client.socket)
    if (this.byDevice.get(client.deviceId) === client) {
      this.byDevice.delete(client.deviceId)
    }
  }

  clientForDevice(deviceId: string): HubClient | undefined {
    return this.byDevice.get(deviceId)
  }

  async writerFor(sessionId: string): Promise<HubClient | undefined> {
    const holder = await this.lease.holder(sessionId)
    if (holder === null) return undefined
    return this.byDevice.get(holder)
  }

  send(client: HubClient, message: ServerMessage): void {
    if (client.socket.readyState !== WebSocket.OPEN) return
    try {
      client.socket.send(JSON.stringify(message))
    } catch {
      // A failed send turns into a closed socket / heartbeat failure.
    }
  }

  broadcast(sessionId: string, message: ServerMessage): void {
    for (const client of this.bySocket.values()) {
      if (client.subscriptions.has(sessionId)) this.send(client, message)
    }
  }

  subscribe(sessionId: string, client: HubClient): void {
    client.subscriptions.add(sessionId)
  }

  unsubscribe(sessionId: string, client: HubClient): void {
    client.subscriptions.delete(sessionId)
  }
}
