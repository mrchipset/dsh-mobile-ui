import pino, { type Logger } from 'pino'

export type { Logger }

/**
 * Create the Bridge logger. Callers must only log sessionId prefixes, tool
 * names, and state transitions; never prompts, absolute paths, env, or tokens.
 */
export function createLogger(level: string): Logger {
  return pino({
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  })
}

/** Safe short identifier for logs (session/device ids are opaque). */
export function shortId(id: string | null | undefined): string | null {
  if (id === null || id === undefined) return null
  return id.slice(0, 8)
}

/**
 * Structured, path-free error summary for logs. Raw error messages can embed
 * absolute paths, commands, or environment values, so only name/code survive.
 */
export function errorSummary(error: unknown): { name: string; code?: string } {
  const base = { name: error instanceof Error ? error.name : 'Error' }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return { ...base, code }
  }
  return base
}

/** Default logger for modules that cannot receive an injected logger. */
export const logger: Logger = createLogger(process.env.LOG_LEVEL ?? 'info')
