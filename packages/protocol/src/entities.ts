import { z } from 'zod'

export type SessionId = string
export type DeviceId = string
/** Bridge-assigned monotonic sequence per session, starting at 1. */
export type Seq = number

export const leaseStateSchema = z.enum(['idle', 'read', 'write', 'handoff'])
export type LeaseState = z.infer<typeof leaseStateSchema>

export const leaseSnapshotSchema = z.object({
  state: leaseStateSchema,
  /** Current writer; null for idle/read. */
  holder: z.string().nullable(),
  /** Handoff grace deadline in epoch milliseconds. */
  deadline: z.number().int().nonnegative().optional(),
})
export type LeaseSnapshot = z.infer<typeof leaseSnapshotSchema>

export const sessionSummarySchema = z.object({
  id: z.string(),
  /** Durable title projected from DSH; null when unavailable. */
  title: z.string().nullable(),
  cwd: z.string(),
  createdAt: z.number().int().nonnegative(),
  lastActivityAt: z.number().int().nonnegative(),
  lastSeq: z.number().int().nonnegative(),
  lease: leaseSnapshotSchema,
  /** Whether a prompt is currently in flight. */
  running: z.boolean(),
})
export type SessionSummary = z.infer<typeof sessionSummarySchema>

export const mcpStateSchema = z.enum([
  'connected',
  'connecting',
  'reconnecting',
  'down',
  'unknown',
  'disabled',
])
export type McpState = z.infer<typeof mcpStateSchema>

export const mcpServerStatusSchema = z.object({
  server: z.string(),
  transport: z.enum(['stdio', 'http']),
  state: mcpStateSchema,
  since: z.number().int().nonnegative(),
  lastError: z.string().optional(),
  lastCallAt: z.number().int().nonnegative().optional(),
  lastCallOk: z.boolean().optional(),
  source: z.enum(['process', 'probe', 'inferred']),
})
export type McpServerStatus = z.infer<typeof mcpServerStatusSchema>

export const imageRefSchema = z.object({
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  /** Base64 payload. The Bridge enforces the byte budget before forwarding. */
  data: z.string().max(8 * 1024 * 1024),
})
export type ImageRef = z.infer<typeof imageRefSchema>

export const audioAttachmentSchema = z.object({
  id: z.string().min(1).max(64),
  mimeType: z.string().min(1).max(64),
  playbackMimeType: z.string().min(1).max(64),
  durationMs: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
})
export type AudioAttachment = z.infer<typeof audioAttachmentSchema>

export const storedUpdateSchema = z.object({
  seq: z.number().int().positive(),
  kind: z.string(),
  payload: z.unknown(),
  createdAt: z.number().int().nonnegative().optional(),
})
export type StoredUpdate = z.infer<typeof storedUpdateSchema>

export interface PromptReceipt {
  clientMsgId: string
  sessionId: SessionId
  deviceId: DeviceId
  state: 'accepted' | 'in_flight' | 'done' | 'failed'
  createdAt: number
}
