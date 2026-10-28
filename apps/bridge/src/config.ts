import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'

const portSchema = z.coerce.number().int().min(1).max(65535)
const nonNegativeIntSchema = z.coerce.number().int().nonnegative()
const positiveIntSchema = z.coerce.number().int().positive()
const booleanishSchema = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
  .transform((value) => value === 'true' || value === '1' || value === 'yes' || value === 'on')

const envSchema = z.object({
  DSH_BIN: z.string().min(1).optional(),
  DSH_ARGS: z.string().optional(),
  DSH_CWD: z.string().optional(),
  DSH_HOME: z.string().optional(),
  DSH_PROFILE: z.string().optional(),
  WORKSPACE_ROOT: z.string().optional(),
  BRIDGE_PORT: portSchema.default(8787),
  INTERNAL_PORT: portSchema.default(8788),
  BRIDGE_SECRET: z.string().min(8),
  DB_PATH: z.string().optional(),
  RETENTION_UPDATES: nonNegativeIntSchema.default(5000),
  LEASE_GRACE_MS: nonNegativeIntSchema.default(10000),
  PERMISSION_TTL_MS: nonNegativeIntSchema.default(180000),
  LOG_LEVEL: z.string().default('info'),
  ACP_ENABLED: booleanishSchema.default(true),
  STT_ENABLED: booleanishSchema.default(false),
  STT_PROVIDER: z.string().min(1).default('funasr'),
  STT_BASE_URL: z.string().min(1).default('http://127.0.0.1:8000/v1'),
  STT_MODEL: z.string().min(1).default('SenseVoiceSmall'),
  STT_LANGUAGE: z.string().min(1).default('zh'),
  STT_TIMEOUT_MS: positiveIntSchema.default(60000),
  STT_MAX_BYTES: positiveIntSchema.default(8388608),
  STT_MAX_DURATION_MS: positiveIntSchema.default(60000),
  STT_CONCURRENCY: positiveIntSchema.default(1),
  STT_API_KEY_ENV: z.string().min(1).optional(),
})

export interface Config {
  dshBin: string
  dshArgs: string[]
  dshCwd: string
  dshHome?: string
  dshProfile: string
  workspaceRoot: string
  bridgePort: number
  internalPort: number
  bridgeSecret: string
  dbPath: string
  retentionUpdates: number
  leaseGraceMs: number
  permissionTtlMs: number
  logLevel: string
  acpEnabled: boolean
  sttEnabled: boolean
  sttProvider: string
  sttBaseUrl: string
  sttModel: string
  sttLanguage: string
  sttTimeoutMs: number
  sttMaxBytes: number
  sttMaxDurationMs: number
  sttConcurrency: number
  sttApiKeyEnv?: string
}

/** Walk up until the workspace root so pnpm-filter cwd changes do not move data/. */
function findRepoRoot(start: string): string {
  let current = resolve(start)
  for (;;) {
    if (existsSync(resolve(current, 'pnpm-workspace.yaml'))) return current
    const parent = dirname(current)
    if (parent === current) return resolve(start)
    current = parent
  }
}

function parseDshArgs(raw: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('DSH_ARGS must be a valid JSON array of strings')
  }
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
    throw new Error('DSH_ARGS must be a JSON array containing only strings')
  }
  return parsed
}

/**
 * Parse and normalize Bridge configuration from an environment bag.
 * Kept pure so tests and the smoke script can supply their own env.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.parse(env)
  const baseDir = findRepoRoot(process.cwd())

  const dshProfile = parsed.DSH_PROFILE ?? 'acp'
  const dshArgs =
    parsed.DSH_ARGS === undefined ? ['--profile', dshProfile] : parseDshArgs(parsed.DSH_ARGS)
  const dbPath = parsed.DB_PATH === ':memory:' ? ':memory:' : (parsed.DB_PATH ?? './data/bridge.db')

  return {
    dshBin: parsed.DSH_BIN ?? 'dsh',
    dshArgs,
    dshCwd: resolve(baseDir, parsed.DSH_CWD ?? parsed.WORKSPACE_ROOT ?? '.'),
    ...(parsed.DSH_HOME === undefined ? {} : { dshHome: parsed.DSH_HOME }),
    dshProfile,
    workspaceRoot: resolve(baseDir, parsed.WORKSPACE_ROOT ?? '.'),
    bridgePort: parsed.BRIDGE_PORT,
    internalPort: parsed.INTERNAL_PORT,
    bridgeSecret: parsed.BRIDGE_SECRET,
    dbPath: dbPath === ':memory:' ? dbPath : resolve(baseDir, dbPath),
    retentionUpdates: parsed.RETENTION_UPDATES,
    leaseGraceMs: parsed.LEASE_GRACE_MS,
    permissionTtlMs: parsed.PERMISSION_TTL_MS,
    logLevel: parsed.LOG_LEVEL,
    acpEnabled: parsed.ACP_ENABLED,
    sttEnabled: parsed.STT_ENABLED,
    sttProvider: parsed.STT_PROVIDER,
    sttBaseUrl: parsed.STT_BASE_URL,
    sttModel: parsed.STT_MODEL,
    sttLanguage: parsed.STT_LANGUAGE,
    sttTimeoutMs: parsed.STT_TIMEOUT_MS,
    sttMaxBytes: parsed.STT_MAX_BYTES,
    sttMaxDurationMs: parsed.STT_MAX_DURATION_MS,
    sttConcurrency: parsed.STT_CONCURRENCY,
    ...(parsed.STT_API_KEY_ENV === undefined ? {} : { sttApiKeyEnv: parsed.STT_API_KEY_ENV }),
  }
}
