import { z } from 'zod'

export const tokenSchema = z
  .string()
  .trim()
  .min(8, '访问令牌至少需要 8 个字符')
  .max(256, '访问令牌过长')

export const promptSchema = z
  .string()
  .trim()
  .min(1, '先写点什么再发送')
  .max(64_000, '内容超过 64,000 字符上限')

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? '输入不合法'
}
