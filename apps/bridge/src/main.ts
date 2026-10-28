import { AcpSupervisor } from './acp/supervisor.js'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { openDatabase } from './db/index.js'
import { loadEnvironment } from './env.js'
import { LeaseManager } from './lease/manager.js'
import { createLogger, errorSummary } from './logger.js'
import { OpenAICompatibleStt } from './stt/index.js'

loadEnvironment()

async function importRemoteSessions(
  supervisor: AcpSupervisor,
  repo: ReturnType<typeof openDatabase>['repo'],
  log: ReturnType<typeof createLogger>,
): Promise<void> {
  try {
    const remote = await supervisor.listRemoteSessions()
    for (const session of remote) {
      const existing = await repo.get(session.sessionId)
      if (existing !== undefined) continue
      const now = Date.now()
      await repo.upsert({
        id: session.sessionId,
        title: session.title ?? null,
        cwd: session.cwd,
        createdAt: now,
        lastActivityAt: now,
        lastSeq: 0,
        lease: { state: 'idle', holder: null },
        running: false,
      })
    }
    log.info({ count: remote.length }, 'imported remote sessions')
  } catch (error) {
    log.warn({ error: errorSummary(error) }, 'remote session import failed')
  }
}

async function main(): Promise<void> {
  const config = loadConfig(process.env)
  const log = createLogger(config.logLevel)
  const database = openDatabase(config)
  const lease = new LeaseManager({ graceMs: config.leaseGraceMs })

  const sttApiKey = config.sttApiKeyEnv === undefined ? undefined : process.env[config.sttApiKeyEnv]
  const stt = config.sttEnabled
    ? new OpenAICompatibleStt({
        baseUrl: config.sttBaseUrl,
        provider: config.sttProvider,
        model: config.sttModel,
        defaultLanguage: config.sttLanguage,
        timeoutMs: config.sttTimeoutMs,
        ...(sttApiKey === undefined || sttApiKey.length === 0 ? {} : { apiKey: sttApiKey }),
      })
    : undefined

  let supervisor: AcpSupervisor | undefined
  if (config.acpEnabled) {
    supervisor = new AcpSupervisor(
      {
        bin: config.dshBin,
        args: config.dshArgs,
        cwd: config.dshCwd,
        ...(config.dshHome === undefined ? {} : { dshHome: config.dshHome }),
      },
      log,
    )
    try {
      await supervisor.start()
      log.info('ACP supervisor ready')
      await importRemoteSessions(supervisor, database.repo, log)
    } catch (error) {
      log.warn(
        { error: errorSummary(error) },
        'ACP unavailable at startup; Bridge will keep serving',
      )
    }
  }

  const app = buildApp({
    config,
    repo: database.repo,
    lease,
    ...(supervisor === undefined ? {} : { supervisor }),
    ...(stt === undefined ? {} : { stt }),
    logger: log,
  })

  await app.listen({ port: config.bridgePort, host: '0.0.0.0' })
  log.info(
    { url: `http://0.0.0.0:${config.bridgePort}`, acpEnabled: config.acpEnabled },
    'bridge listening',
  )

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    log.info({ signal }, 'shutting down')
    try {
      await supervisor?.stop()
    } catch (error) {
      log.warn({ error: errorSummary(error) }, 'failed to stop ACP supervisor')
    }
    try {
      await app.close()
    } catch (error) {
      log.warn({ error: errorSummary(error) }, 'failed to close HTTP server')
    } finally {
      lease.dispose()
      database.close()
    }
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
}

main().catch((error: unknown) => {
  // Startup failures can contain paths; log only the error identity.
  console.error(`bridge failed to start: ${JSON.stringify(errorSummary(error))}`)
  process.exitCode = 1
})
