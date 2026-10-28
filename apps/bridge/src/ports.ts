import type {
  DeviceId,
  LeaseSnapshot,
  PromptReceipt,
  Seq,
  SessionId,
  SessionSummary,
  StoredUpdate,
} from '@dsh-mobile/protocol'

export interface SessionRepository {
  list(): Promise<SessionSummary[]>
  get(id: SessionId): Promise<SessionSummary | undefined>
  upsert(summary: SessionSummary): Promise<void>
  nextSeq(id: SessionId): Promise<Seq>
  append(id: SessionId, seq: Seq, kind: string, payload: unknown): Promise<void>
  range(id: SessionId, from: Seq, to?: Seq): Promise<StoredUpdate[]>
  lastSeq(id: SessionId): Promise<Seq>
  prune(id: SessionId, keep: number): Promise<void>
  rename(id: SessionId, title: string): Promise<void>
}

export interface LeaseChange {
  sessionId: SessionId
  lease: LeaseSnapshot
}

export interface LeaseManagerPort {
  attach(sessionId: SessionId, deviceId: DeviceId): Promise<LeaseSnapshot>
  detach(sessionId: SessionId, deviceId: DeviceId): Promise<LeaseSnapshot>
  take(sessionId: SessionId, deviceId: DeviceId): Promise<LeaseSnapshot>
  release(sessionId: SessionId, deviceId: DeviceId): Promise<LeaseSnapshot>
  assertWriter(sessionId: SessionId, deviceId: DeviceId): Promise<void>
  holder(sessionId: SessionId): Promise<DeviceId | null>
  snapshot(sessionId: SessionId): Promise<LeaseSnapshot>
  onChange(handler: (change: LeaseChange) => void): () => void
  dispose(): void
}

export interface PromptReceiptStore {
  get(clientMsgId: string): Promise<PromptReceipt | undefined>
  put(receipt: PromptReceipt): Promise<void>
}
