import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import type { SessionSummary } from '@dsh-mobile/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { AcpSupervisor } from '../src/acp/supervisor.js'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { type OpenDatabaseResult, openDatabase } from '../src/db/index.js'
import { LeaseManager } from '../src/lease/manager.js'
import { createLogger } from '../src/logger.js'

const secret = 'correct-horse-battery'

let active:
  | { app: ReturnType<typeof buildApp>; opened: OpenDatabaseResult; lease: LeaseManager }
  | undefined

afterEach(async () => {
  if (active !== undefined) {
    await active.app.close()
    active.lease.dispose()
    active.opened.close()
    active = undefined
  }
})

function summary(id: string): SessionSummary {
  return {
    id,
    title: null,
    cwd: 'C:/workspace',
    createdAt: 1000,
    lastActivityAt: 1000,
    lastSeq: 0,
    lease: { state: 'idle', holder: null },
    running: false,
  }
}

function fakeSupervisor(onPrompt?: () => void): AcpSupervisor {
  return {
    status: 'ready',
    isReady: () => true,
    isActiveSession: () => true,
    resumeSession: async () => {},
    prompt: async () => {
      onPrompt?.()
      return 'end_turn'
    },
    onUpdate: () => () => {},
    onTitle: () => () => {},
    onPermission: () => () => {},
    onStatus: () => () => {},
  } as unknown as AcpSupervisor
}

class MessageQueue {
  private readonly queue: Record<string, unknown>[] = []
  private readonly waiters: Array<(message: Record<string, unknown>) => void> = []

  constructor(socket: WebSocket) {
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>
      const waiter = this.waiters.shift()
      if (waiter === undefined) this.queue.push(message)
      else waiter(message)
    })
  }

  next(): Promise<Record<string, unknown>> {
    const queued = this.queue.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for message')), 3000)
      this.waiters.push((message) => {
        clearTimeout(timer)
        resolve(message)
      })
    })
  }

  async nextType(type: string): Promise<Record<string, unknown>> {
    for (;;) {
      const message = await this.next()
      if (message.type === type) return message
    }
  }
}

async function audio(
  repo: OpenDatabaseResult['repo'],
  id: string,
  sessionId: string,
): Promise<void> {
  await repo.insertAudio({
    id,
    sessionId,
    mimeType: 'audio/webm',
    playbackMimeType: 'audio/mp4',
    durationMs: 1000,
    sizeBytes: 3,
    original: Buffer.from('orig'),
    playback: Buffer.from('play'),
    createdAt: Date.now(),
  })
}

describe('session.prompt audio attachment', () => {
  it('persists audio metadata and rejects unknown or cross-session audio', async () => {
    const config = loadConfig({
      BRIDGE_SECRET: secret,
      ACP_ENABLED: 'false',
    } as NodeJS.ProcessEnv)
    const opened = openDatabase({ ...config, dbPath: ':memory:' })
    const lease = new LeaseManager({ graceMs: config.leaseGraceMs })
    let promptCalls = 0
    const app = buildApp({
      config,
      repo: opened.repo,
      lease,
      supervisor: fakeSupervisor(() => {
        promptCalls += 1
      }),
      logger: createLogger('silent'),
    })
    active = { app, opened, lease }

    await opened.repo.upsert(summary('s1'))
    await opened.repo.upsert(summary('s2'))
    await audio(opened.repo, 'a1', 's1')
    await audio(opened.repo, 'a2', 's2')

    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address() as AddressInfo
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`)
    await once(socket, 'open')
    const messages = new MessageQueue(socket)

    socket.send(JSON.stringify({ type: 'auth', token: secret, deviceId: 'device-a' }))
    expect(await messages.nextType('ready')).toEqual({ type: 'ready', deviceId: 'device-a' })

    socket.send(JSON.stringify({ type: 'session.attach', sessionId: 's1' }))
    await messages.nextType('session.snapshot')

    socket.send(
      JSON.stringify({
        type: 'session.prompt',
        sessionId: 's1',
        clientMsgId: 'c1',
        text: 'voice text',
        audioId: 'a1',
      }),
    )

    const update = await messages.nextType('session.update')
    const payload = update.update as {
      audio?: { id: string; playbackMimeType: string; durationMs: number }
    }
    expect(payload.audio).toMatchObject({
      id: 'a1',
      mimeType: 'audio/webm',
      playbackMimeType: 'audio/mp4',
      durationMs: 1000,
      sizeBytes: 3,
    })
    await messages.nextType('session.prompt.done')

    expect(promptCalls).toBe(1)
    expect((await opened.repo.getAudio('a1'))?.clientMsgId).toBe('c1')
    const updates = await opened.repo.range('s1', 1)
    expect(updates[0]?.payload).toMatchObject({ audio: { id: 'a1' } })

    socket.send(
      JSON.stringify({
        type: 'session.prompt',
        sessionId: 's1',
        clientMsgId: 'c1b',
        text: 'reuse audio',
        audioId: 'a1',
      }),
    )
    expect(await messages.nextType('error')).toMatchObject({
      type: 'error',
      code: 'audio_already_attached',
    })
    expect(promptCalls).toBe(1)

    socket.send(
      JSON.stringify({
        type: 'session.prompt',
        sessionId: 's1',
        clientMsgId: 'c2',
        text: 'cross session',
        audioId: 'a2',
      }),
    )
    expect(await messages.nextType('error')).toMatchObject({
      type: 'error',
      code: 'audio_session_mismatch',
    })

    socket.send(
      JSON.stringify({
        type: 'session.prompt',
        sessionId: 's1',
        clientMsgId: 'c3',
        text: 'missing audio',
        audioId: 'missing',
      }),
    )
    expect(await messages.nextType('error')).toMatchObject({
      type: 'error',
      code: 'audio_not_found',
    })
    expect(promptCalls).toBe(1)

    socket.send(
      JSON.stringify({
        type: 'session.prompt',
        sessionId: 's1',
        clientMsgId: 'c4',
        text: 'plain text',
      }),
    )
    const plainUpdate = await messages.nextType('session.update')
    expect((plainUpdate.update as { audio?: unknown }).audio).toBeUndefined()
    await messages.nextType('session.prompt.done')
    expect(promptCalls).toBe(2)

    socket.close()
  })

  it('does not attach audio when a non-writer sends the prompt', async () => {
    const config = loadConfig({
      BRIDGE_SECRET: secret,
      ACP_ENABLED: 'false',
    } as NodeJS.ProcessEnv)
    const opened = openDatabase({ ...config, dbPath: ':memory:' })
    const lease = new LeaseManager({ graceMs: config.leaseGraceMs })
    let promptCalls = 0
    const app = buildApp({
      config,
      repo: opened.repo,
      lease,
      supervisor: fakeSupervisor(() => {
        promptCalls += 1
      }),
      logger: createLogger('silent'),
    })
    active = { app, opened, lease }

    await opened.repo.upsert(summary('s1'))
    await audio(opened.repo, 'a1', 's1')

    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address() as AddressInfo
    const writer = new WebSocket(`ws://127.0.0.1:${address.port}/ws`)
    await once(writer, 'open')
    const writerMessages = new MessageQueue(writer)
    writer.send(JSON.stringify({ type: 'auth', token: secret, deviceId: 'writer' }))
    await writerMessages.nextType('ready')
    writer.send(JSON.stringify({ type: 'session.attach', sessionId: 's1' }))
    await writerMessages.nextType('session.snapshot')
    writer.send(JSON.stringify({ type: 'session.lease', sessionId: 's1', action: 'take' }))
    await writerMessages.nextType('session.lease')

    const other = new WebSocket(`ws://127.0.0.1:${address.port}/ws`)
    await once(other, 'open')
    const otherMessages = new MessageQueue(other)
    other.send(JSON.stringify({ type: 'auth', token: secret, deviceId: 'other' }))
    await otherMessages.nextType('ready')
    other.send(
      JSON.stringify({
        type: 'session.prompt',
        sessionId: 's1',
        clientMsgId: 'c-other',
        text: 'should not attach',
        audioId: 'a1',
      }),
    )

    expect(await otherMessages.nextType('error')).toMatchObject({
      type: 'error',
      code: 'lease_held',
    })
    expect(promptCalls).toBe(0)
    expect((await opened.repo.getAudioAttachment('a1'))?.clientMsgId).toBeNull()

    writer.close()
    other.close()
  })
})
