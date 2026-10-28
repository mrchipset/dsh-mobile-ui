export interface SttReadinessOptions {
  baseUrl: string
  apiKey?: string
  timeoutMs?: number
  cacheTtlMs?: number
  fetchImpl?: typeof fetch
  now?: () => number
}

/** Minimal readiness view used by the health endpoint. */
export interface SttReadinessProbe {
  reachable(): Promise<boolean>
}

const DEFAULT_TIMEOUT_MS = 2_000
const DEFAULT_CACHE_TTL_MS = 30_000

/**
 * Cached OpenAI-compatible `/models` readiness probe. It never throws and is
 * bounded in time so STT downtime cannot fail or hang `/health`.
 */
export class SttReadiness implements SttReadinessProbe {
  private readonly url: string
  private readonly timeoutMs: number
  private readonly cacheTtlMs: number
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number

  private cached: { value: boolean; expiresAt: number } | undefined
  private inFlight: Promise<boolean> | undefined

  constructor(private readonly options: SttReadinessOptions) {
    this.url = `${options.baseUrl.replace(/\/$/, '')}/models`
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
  }

  async reachable(): Promise<boolean> {
    const current = this.now()
    if (this.cached !== undefined && current < this.cached.expiresAt) {
      return this.cached.value
    }
    if (this.inFlight !== undefined) return this.inFlight

    this.inFlight = this.probe()
      .catch(() => false)
      .then((value) => {
        this.cached = { value, expiresAt: this.now() + this.cacheTtlMs }
        return value
      })
      .finally(() => {
        this.inFlight = undefined
      })
    return this.inFlight
  }

  private async probe(): Promise<boolean> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    const apiKey = this.options.apiKey?.trim()
    if (apiKey !== undefined && apiKey.length > 0) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    const controller = new AbortController()
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        controller.abort()
        resolve(false)
      }, this.timeoutMs)
      timer.unref?.()
    })

    try {
      const request = this.fetchImpl(this.url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      })
        .then((response) => response.ok)
        .catch(() => false)
      return await Promise.race([request, timeout])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}
