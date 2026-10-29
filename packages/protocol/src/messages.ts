import { z } from 'zod'
import { renderBlockSchema } from './blocks'
import {
  imageRefSchema,
  mcpServerStatusSchema,
  type SessionId,
  sessionSummarySchema,
  storedUpdateSchema,
} from './entities'

export const permissionOptionSchema = z.object({
  optionId: z.string(),
  name: z.string(),
  kind: z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always']).optional(),
})
export type PermissionOption = z.infer<typeof permissionOptionSchema>

export const permissionToolCallSchema = z.object({
  toolCallId: z.string(),
  title: z.string().optional(),
})

export const permissionRequestSchema = z.object({
  requestId: z.string(),
  sessionId: z.string(),
  toolCall: permissionToolCallSchema,
  options: z.array(permissionOptionSchema),
})
export type PermissionRequest = z.infer<typeof permissionRequestSchema>

const authMessage = z.object({
  type: z.literal('auth'),
  token: z.string().max(256),
  deviceId: z.string().max(64),
})

const sessionListMessage = z.object({
  type: z.literal('session.list'),
  cursor: z.string().max(64).optional(),
})

const sessionCreateMessage = z.object({
  type: z.literal('session.create'),
  /** Optional hint only. The Bridge always uses its configured WORKSPACE_ROOT. */
  cwd: z.string().optional(),
})

const sessionAttachMessage = z.object({
  type: z.literal('session.attach'),
  sessionId: z.string(),
  lastSeq: z.number().int().nonnegative().optional(),
})

const sessionDetachMessage = z.object({
  type: z.literal('session.detach'),
  sessionId: z.string(),
})

const sessionPromptMessage = z.object({
  type: z.literal('session.prompt'),
  sessionId: z.string(),
  clientMsgId: z.string().max(64),
  text: z.string().max(64_000),
  images: z.array(imageRefSchema).max(4).optional(),
  /** One previously uploaded voice attachment. */
  audioId: z.string().min(1).max(64).optional(),
})

const sessionCancelMessage = z.object({
  type: z.literal('session.cancel'),
  sessionId: z.string(),
})

const sessionLeaseMessage = z.object({
  type: z.literal('session.lease'),
  sessionId: z.string(),
  action: z.enum(['take', 'release']),
})

const permissionAnswerMessage = z.object({
  type: z.literal('permission.answer'),
  requestId: z.string(),
  optionId: z.string(),
})

const configSetMessage = z.object({
  type: z.literal('config.set'),
  sessionId: z.string(),
  configId: z.string().max(64),
  value: z.string().max(256),
})

const mcpSubscribeMessage = z.object({
  type: z.literal('mcp.subscribe'),
})

export const clientMessageSchema = z.discriminatedUnion('type', [
  authMessage,
  sessionListMessage,
  sessionCreateMessage,
  sessionAttachMessage,
  sessionDetachMessage,
  sessionPromptMessage,
  sessionCancelMessage,
  sessionLeaseMessage,
  permissionAnswerMessage,
  configSetMessage,
  mcpSubscribeMessage,
])
export type ClientMessage = z.infer<typeof clientMessageSchema>

export const readyMessageSchema = z.object({
  type: z.literal('ready'),
  deviceId: z.string(),
})

export const sessionListResponseSchema = z.object({
  type: z.literal('session.list'),
  sessions: z.array(sessionSummarySchema),
  nextCursor: z.string().optional(),
})

export const sessionSnapshotSchema = z.object({
  type: z.literal('session.snapshot'),
  session: sessionSummarySchema,
  seq: z.number().int().nonnegative(),
  blocks: z.array(renderBlockSchema),
  /** Raw updates backing `blocks`; lets clients fold incremental updates without a refetch. */
  updates: z.array(storedUpdateSchema).optional(),
  pendingPermission: permissionRequestSchema.optional(),
  historyStartsAt: z.number().int().nonnegative().optional(),
  historyTruncated: z.boolean().optional(),
})

export const sessionUpdateMessageSchema = z.object({
  type: z.literal('session.update'),
  sessionId: z.string(),
  seq: z.number().int().positive(),
  /** Unknown sessionUpdate variants must pass through verbatim. */
  update: z.unknown(),
})

export const sessionLeaseMessageSchema = z.object({
  type: z.literal('session.lease'),
  sessionId: z.string(),
  lease: z.object({
    state: z.enum(['idle', 'read', 'write', 'handoff']),
    holder: z.string().nullable(),
    deadline: z.number().int().nonnegative().optional(),
  }),
})

export const sessionPromptDoneMessageSchema = z.object({
  type: z.literal('session.prompt.done'),
  sessionId: z.string(),
  clientMsgId: z.string(),
  stopReason: z.string(),
})

export const permissionRequestMessageSchema = z.object({
  type: z.literal('permission.request'),
  sessionId: z.string(),
  requestId: z.string(),
  toolCall: permissionToolCallSchema,
  options: z.array(permissionOptionSchema),
})

export const permissionResolvedMessageSchema = z.object({
  type: z.literal('permission.resolved'),
  requestId: z.string(),
  outcome: z.enum(['allowed', 'rejected', 'cancelled']),
})

export const mcpStatusMessageSchema = z.object({
  type: z.literal('mcp.status'),
  servers: z.array(mcpServerStatusSchema),
})

export const errorMessageSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  requestType: z.string().optional(),
})

export const serverMessageSchema = z.discriminatedUnion('type', [
  readyMessageSchema,
  sessionListResponseSchema,
  sessionSnapshotSchema,
  sessionUpdateMessageSchema,
  sessionLeaseMessageSchema,
  sessionPromptDoneMessageSchema,
  permissionRequestMessageSchema,
  permissionResolvedMessageSchema,
  mcpStatusMessageSchema,
  errorMessageSchema,
])
export type ServerMessage = z.infer<typeof serverMessageSchema>

export interface PermissionAnswer {
  requestId: string
  optionId: string
}

export interface PromptInput {
  sessionId: SessionId
  clientMsgId: string
  text: string
  images?: Array<{ mimeType: string; data: string }>
  audioId?: string
}
