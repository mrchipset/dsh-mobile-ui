import { AcpSupervisor } from '../src/acp/supervisor.js'
import { loadConfig } from '../src/config.js'
import { loadEnvironment } from '../src/env.js'
import { createLogger } from '../src/logger.js'

loadEnvironment()

async function main(): Promise<number> {
  const config = loadConfig(process.env)
  if (!config.acpEnabled) {
    console.error('ACP_ENABLED is false; smoke test skipped')
    return 1
  }

  const log = createLogger(config.logLevel)
  const supervisor = new AcpSupervisor(
    {
      bin: config.dshBin,
      args: config.dshArgs,
      cwd: config.dshCwd,
      ...(config.dshHome === undefined ? {} : { dshHome: config.dshHome }),
    },
    log,
  )

  let code = 0
  try {
    await supervisor.start()

    const remote = await supervisor.listRemoteSessions()
    console.log(`remote sessions: ${remote.length}`)
    for (const session of remote) {
      console.log(`- ${session.sessionId.slice(0, 8)}`)
    }

    if (process.argv.includes('--new')) {
      const sessionId = await supervisor.newSession({ cwd: config.workspaceRoot })
      console.log(`created: ${sessionId.slice(0, 8)}`)
      await supervisor.closeSession(sessionId)
      console.log('closed created session')
    }
  } catch (error) {
    console.error(`smoke failed: ${error instanceof Error ? error.message : String(error)}`)
    code = 1
  } finally {
    try {
      await supervisor.stop()
    } catch (error) {
      console.error(`stop failed: ${error instanceof Error ? error.message : String(error)}`)
      code = 1
    }
  }
  return code
}

const code = await main()
process.exitCode = code
