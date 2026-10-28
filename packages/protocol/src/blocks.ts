import { z } from 'zod'
import { imageRefSchema } from './entities'

export const toolCallStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed'])
export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>

export const messageBlockSchema = z.object({
  kind: z.literal('message'),
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  images: z.array(imageRefSchema).optional(),
  messageId: z.string().optional(),
  streaming: z.boolean().optional(),
  seq: z.number().int().nonnegative().optional(),
})
export type MessageBlock = z.infer<typeof messageBlockSchema>

export const thoughtBlockSchema = z.object({
  kind: z.literal('thought'),
  id: z.string(),
  text: z.string(),
  messageId: z.string().optional(),
  streaming: z.boolean().optional(),
  seq: z.number().int().nonnegative().optional(),
})
export type ThoughtBlock = z.infer<typeof thoughtBlockSchema>

export const toolCallBlockSchema = z.object({
  kind: z.literal('tool_call'),
  id: z.string(),
  toolCallId: z.string(),
  title: z.string(),
  toolKind: z.string().optional(),
  status: toolCallStatusSchema,
  content: z.array(z.unknown()).optional(),
  locations: z.array(z.unknown()).optional(),
  rawInput: z.unknown().optional(),
  rawOutput: z.unknown().optional(),
  seq: z.number().int().nonnegative().optional(),
})
export type ToolCallBlock = z.infer<typeof toolCallBlockSchema>

export const planEntrySchema = z.object({
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']),
  priority: z.enum(['high', 'medium', 'low']),
})
export type PlanEntry = z.infer<typeof planEntrySchema>

export const planBlockSchema = z.object({
  kind: z.literal('plan'),
  id: z.string(),
  planId: z.string().optional(),
  entries: z.array(planEntrySchema),
  seq: z.number().int().nonnegative().optional(),
})
export type PlanBlock = z.infer<typeof planBlockSchema>

export const noticeBlockSchema = z.object({
  kind: z.literal('notice'),
  id: z.string(),
  level: z.enum(['info', 'warning', 'error']),
  text: z.string(),
  code: z.string().optional(),
  seq: z.number().int().nonnegative().optional(),
})
export type NoticeBlock = z.infer<typeof noticeBlockSchema>

export const unknownBlockSchema = z.object({
  kind: z.literal('unknown'),
  id: z.string(),
  sessionUpdate: z.string(),
  raw: z.unknown(),
  seq: z.number().int().nonnegative().optional(),
})
export type UnknownBlock = z.infer<typeof unknownBlockSchema>

export const renderBlockSchema = z.discriminatedUnion('kind', [
  messageBlockSchema,
  thoughtBlockSchema,
  toolCallBlockSchema,
  planBlockSchema,
  noticeBlockSchema,
  unknownBlockSchema,
])
export type RenderBlock = z.infer<typeof renderBlockSchema>
