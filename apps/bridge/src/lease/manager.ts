import type { DeviceId, LeaseSnapshot, LeaseState, SessionId } from '@dsh-mobile/protocol'
import { BridgeError } from '../acp/errors.js'
import type { LeaseChange, LeaseManagerPort } from '../ports.js'

interface LeaseRecord {
  state: LeaseState
  holder: DeviceId | null
  deadline?: number
  timer?: NodeJS.Timeout
  attached: Set<DeviceId>
  lastWriter: DeviceId | null
}

export interface LeaseManagerOptions {
  graceMs: number
}

/**
 * In-memory lease state machine (design §6.2).
 *
 * idle --attach--> read
 * read --take/prompt--> write
 * write --detach--> handoff (grace) --timeout--> read
 * handoff --same device reattach--> write
 */
export class LeaseManager implements LeaseManagerPort {
  private readonly records = new Map<SessionId, LeaseRecord>()
  private readonly handlers = new Set<(change: LeaseChange) => void>()

  constructor(private readonly options: LeaseManagerOptions) {}

  async attach(sessionId: SessionId, deviceId: DeviceId): Promise<LeaseSnapshot> {
    const record = this.getOrCreate(sessionId)
    record.attached.add(deviceId)

    if (record.state === 'handoff') {
      if (record.lastWriter === deviceId) {
        this.clearTimer(record)
        record.state = 'write'
        record.holder = deviceId
        record.deadline = undefined
        this.emit(sessionId, record)
      } else {
        // Another device joined while the previous writer was in grace.
        this.clearTimer(record)
        record.state = 'read'
        record.holder = null
        record.deadline = undefined
        this.emit(sessionId, record)
      }
      return this.snapshotOf(record)
    }

    if (record.state === 'write') return this.snapshotOf(record)

    if (record.state === 'read' && record.lastWriter === deviceId && record.holder === null) {
      record.state = 'write'
      record.holder = deviceId
      this.emit(sessionId, record)
      return this.snapshotOf(record)
    }

    if (record.state === 'idle') {
      record.state = 'read'
      this.emit(sessionId, record)
    }

    return this.snapshotOf(record)
  }

  async detach(sessionId: SessionId, deviceId: DeviceId): Promise<LeaseSnapshot> {
    const record = this.getOrCreate(sessionId)
    record.attached.delete(deviceId)

    if (record.state === 'write' && record.holder === deviceId) {
      const deadline = Date.now() + this.options.graceMs
      record.state = 'handoff'
      record.deadline = deadline
      this.clearTimer(record)
      record.timer = setTimeout(() => {
        this.expireHandoff(sessionId)
      }, this.options.graceMs)
      record.timer.unref?.()
      this.emit(sessionId, record)
      return this.snapshotOf(record)
    }

    if (record.state === 'handoff' && record.lastWriter === deviceId) {
      // The writer detached again (or abandoned) before a reconnect.
      record.attached.delete(deviceId)
    }

    if (record.state === 'read' && record.attached.size === 0) {
      record.state = 'idle'
      this.emit(sessionId, record)
    }

    return this.snapshotOf(record)
  }

  async take(sessionId: SessionId, deviceId: DeviceId): Promise<LeaseSnapshot> {
    const record = this.getOrCreate(sessionId)
    this.clearTimer(record)
    record.attached.add(deviceId)
    record.state = 'write'
    record.holder = deviceId
    record.lastWriter = deviceId
    record.deadline = undefined
    this.emit(sessionId, record)
    return this.snapshotOf(record)
  }

  async release(sessionId: SessionId, deviceId: DeviceId): Promise<LeaseSnapshot> {
    const record = this.getOrCreate(sessionId)
    if (record.holder === deviceId) {
      this.clearTimer(record)
      record.state = record.attached.size === 0 ? 'idle' : 'read'
      record.holder = null
      record.deadline = undefined
      this.emit(sessionId, record)
    }
    return this.snapshotOf(record)
  }

  async assertWriter(sessionId: SessionId, deviceId: DeviceId): Promise<void> {
    const record = this.getOrCreate(sessionId)
    if (record.state !== 'write' || record.holder !== deviceId) {
      throw new BridgeError('lease_held', 'Write lease is held by another device', false)
    }
  }

  async holder(sessionId: SessionId): Promise<DeviceId | null> {
    return this.getOrCreate(sessionId).holder
  }

  async snapshot(sessionId: SessionId): Promise<LeaseSnapshot> {
    return this.snapshotOf(this.getOrCreate(sessionId))
  }

  onChange(handler: (change: LeaseChange) => void): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  dispose(): void {
    for (const record of this.records.values()) this.clearTimer(record)
    this.records.clear()
    this.handlers.clear()
  }

  private getOrCreate(sessionId: SessionId): LeaseRecord {
    const existing = this.records.get(sessionId)
    if (existing !== undefined) return existing

    const created: LeaseRecord = {
      state: 'idle',
      holder: null,
      attached: new Set(),
      lastWriter: null,
    }
    this.records.set(sessionId, created)
    return created
  }

  private expireHandoff(sessionId: SessionId): void {
    const record = this.records.get(sessionId)
    if (record === undefined || record.state !== 'handoff') return
    record.state = 'read'
    record.holder = null
    record.deadline = undefined
    record.timer = undefined
    this.emit(sessionId, record)
  }

  private clearTimer(record: LeaseRecord): void {
    if (record.timer !== undefined) {
      clearTimeout(record.timer)
      record.timer = undefined
    }
  }

  private snapshotOf(record: LeaseRecord): LeaseSnapshot {
    return {
      state: record.state,
      holder: record.state === 'read' || record.state === 'idle' ? null : record.holder,
      ...(record.state === 'handoff' && record.deadline !== undefined
        ? { deadline: record.deadline }
        : {}),
    }
  }

  private emit(sessionId: SessionId, record: LeaseRecord): void {
    const change: LeaseChange = { sessionId, lease: this.snapshotOf(record) }
    for (const handler of this.handlers) {
      try {
        handler(change)
      } catch {
        // A subscriber must never break the lease state machine.
      }
    }
  }
}
