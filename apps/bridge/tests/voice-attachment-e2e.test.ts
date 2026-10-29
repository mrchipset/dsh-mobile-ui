import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  fold,
  type RenderBlock,
  type SessionSummary,
  type StoredUpdate,
} from '@dsh-mobile/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import {
  acquireRemoteAudioUrl,
  createDemoWavBlob,
  releaseRemoteAudioUrl,
  uploadAudio,
} from '../../mobile/src/lib/audio.js'
import type { AcpSupervisor } from '../src/acp/supervisor.js'
import { buildApp } from '../src/app.js'
import type { AudioTranscoder } from '../src/audio/transcoder.js'
import { loadConfig } from '../src/config.js'
import { type OpenDatabaseResult, openDatabase } from '../src/db/index.js'
import { LeaseManager } from '../src/lease/manager.js'
import { createLogger } from '../src/logger.js'
import { OpenAICompatibleStt } from '../src/stt/openai-compatible.js'

const secret = 'correct-horse-battery'
const transcriptText = '把支付回调改成异步处理'
const playbackBytes = Buffer.from('PLAYBACK-M4A-BYTES')
const clipDurationMs = 1200

interface SttUpstream {
  baseUrl: string
  bodies: string[]
  close: () => Promise<void>
}

interface Harness {
  app: ReturnType<typeof buildApp>
  opened: OpenDatabaseResult
  lease: LeaseManager
  baseUrl: string
  wsUrl: string
  upstream: SttUpstream
  prompts: string[]
  restoreFetch: () => void
}

let active: Harness | undefined

afterEach(async () => {
  if (active === undefined) return
  const harness = active
  active = undefined
  harness.restoreFetch()
  await harness.app.close()
  harness.lease.dispose()
  harness.opened.close()
  await harness.upstream.close()
})

function sessionSummary(): SessionSummary {
  return {
    id: 's1',
    title: null,
    cwd: 'C:/workspace',
    createdAt: 1000,
    lastActivityAt: 1000,
    lastSeq: 0,
    lease: { state: 'idle', holder: null },
    running: false,
  }
}

function fakeSupervisor(prompts: string[]): AcpSupervisor {
  return {
    status: 'ready',
    isReady: () => true,
    isActiveSession: () => true,
    resumeSession: async () => {},
    prompt: async (_sessionId: string, text: string) => {
      prompts.push(text)
      return 'end_turn'
    },
    onUpdate: () => () => {},
    onTitle: () => () => {},
    onPermission: () => () => {},
    onStatus: () => () => {},
  } as unknown as AcpSupervisor
}

const transcoder: AudioTranscoder = {
  async transcode() {
    return { data: playbackBytes, mimeType: 'audio/mp4', transcoded: true }
  },
  async isAvailable() {
    return true
  },
}

async function startSttUpstream(): Promise<SttUpstream> {
  const bodies: string[] = []
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/audio/transcriptions') {
      response.statusCode = 404
      response.end()
      return
    }
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      bodies.push(Buffer.concat(chunks).toString('utf8'))
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ text: transcriptText, language: 'zh' }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    bodies,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      }),
  }
}

async function startHarness(): Promise<Harness> {
  const upstream = await startSttUpstream()
  const config = loadConfig({
    BRIDGE_SECRET: secret,
    ACP_ENABLED: 'false',
    STT_ENABLED: 'true',
    STT_BASE_URL: upstream.baseUrl,
    STT_PROVIDER: 'funasr',
    STT_MODEL: 'paraformer',
    STT_LANGUAGE: 'zh',
    STT_MAX_DURATION_MS: '60000',
  } as NodeJS.ProcessEnv)
  const opened = openDatabase({ ...config, dbPath: ':memory:' })
  const lease = new LeaseManager({ graceMs: config.leaseGraceMs })
  const prompts: string[] = []
  const stt = new OpenAICompatibleStt({
    baseUrl: upstream.baseUrl,
    provider: config.sttProvider,
    model: config.sttModel,
    defaultLanguage: config.sttLanguage,
    timeoutMs: config.sttTimeoutMs,
  })
  const app = buildApp({
    config,
    repo: opened.repo,
    lease,
    supervisor: fakeSupervisor(prompts),
    stt,
    transcoder,
    logger: createLogger('silent'),
  })
  await opened.repo.upsert(sessionSummary())
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`

  // The mobile modules issue same-origin `/api` fetches; the test host is the Bridge.
  const nativeFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = ((input, init) => {
    const target =
      typeof input === 'string' && input.startsWith('/') ? new URL(input, baseUrl) : input
    return nativeFetch(target, init)
  }) as typeof globalThis.fetch

  active = {
    app,
    opened,
    lease,
    baseUrl,
    wsUrl: `ws://127.0.0.1:${address.port}/ws`,
    upstream,
    prompts,
    restoreFetch: () => {
      globalThis.fetch = nativeFetch
    },
  }
  return active
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

interface Attached {
  socket: WebSocket
  messages: MessageQueue
  snapshot: Record<string, unknown>
}

async function attach(harness: Harness, deviceId: string): Promise<Attached> {
  const socket = new WebSocket(harness.wsUrl)
  await once(socket, 'open')
  const messages = new MessageQueue(socket)
  socket.send(JSON.stringify({ type: 'auth', token: secret, deviceId }))
  await messages.nextType('ready')
  socket.send(JSON.stringify({ type: 'session.attach', sessionId: 's1' }))
  const snapshot = await messages.nextType('session.snapshot')
  return { socket, messages, snapshot }
}

async function close(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return
  const closed = once(socket, 'close')
  socket.close()
  await closed
}

describe('voice attachment end-to-end', () => {
  it('transcribes, uploads, prompts, reloads from the snapshot, and plays back over real HTTP/WS', async () => {
    const harness = await startHarness()
    const clip = createDemoWavBlob(clipDurationMs)
    const clipBytes = Buffer.from(await clip.arrayBuffer())

    const transcribeResponse = await fetch(`${harness.baseUrl}/api/transcribe`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'audio/wav',
        'x-audio-duration-ms': String(clipDurationMs),
        'x-audio-language': 'zh',
      },
      body: clip,
    })
    expect(transcribeResponse.status).toBe(200)
    const transcript = (await transcribeResponse.json()) as {
      text: string
      language: string
      provider: string
      model: string
    }
    expect(transcript).toMatchObject({
      text: transcriptText,
      language: 'zh',
      provider: 'funasr',
      model: 'paraformer',
    })
    expect(harness.upstream.bodies).toHaveLength(1)
    expect(harness.upstream.bodies[0]).toContain('name="model"')
    expect(harness.upstream.bodies[0]).toContain('paraformer')
    expect(harness.upstream.bodies[0]).toContain('name="language"')
    expect(harness.upstream.bodies[0]).toContain('zh')

    const uploaded = await uploadAudio({
      sessionId: 's1',
      blob: clip,
      durationMs: clipDurationMs,
      token: secret,
    })
    expect(uploaded).toMatchObject({
      mimeType: 'audio/wav',
      playbackMimeType: 'audio/mp4',
      durationMs: clipDurationMs,
      sizeBytes: clipBytes.byteLength,
      transcoded: true,
    })

    const first = await attach(harness, 'device-e2e')
    expect((first.snapshot.blocks as RenderBlock[]).some((block) => block.kind === 'message')).toBe(
      false,
    )
    first.socket.send(
      JSON.stringify({
        type: 'session.prompt',
        sessionId: 's1',
        clientMsgId: 'client-voice-1',
        text: transcript.text,
        audioId: uploaded.id,
      }),
    )

    const update = await first.messages.nextType('session.update')
    const payload = update.update as {
      sessionUpdate: string
      content: { type: string; text: string }
      audio?: { id: string; durationMs: number; playbackMimeType: string }
    }
    expect(payload.sessionUpdate).toBe('user_message_chunk')
    expect(payload.content).toEqual({ type: 'text', text: transcriptText })
    expect(payload.audio).toMatchObject({
      id: uploaded.id,
      mimeType: 'audio/wav',
      playbackMimeType: 'audio/mp4',
      durationMs: clipDurationMs,
      sizeBytes: clipBytes.byteLength,
    })
    await first.messages.nextType('session.prompt.done')
    expect(harness.prompts).toEqual([transcriptText])

    const playbackUrl = await acquireRemoteAudioUrl(uploaded.id, secret)
    const bridgePlayback = await fetch(`${harness.baseUrl}/api/audio/${uploaded.id}`, {
      headers: { authorization: `Bearer ${secret}` },
    })
    expect(bridgePlayback.status).toBe(200)
    expect(bridgePlayback.headers.get('content-type')).toBe('audio/mp4')
    expect(bridgePlayback.headers.get('content-length')).toBe(String(playbackBytes.byteLength))
    expect(bridgePlayback.headers.get('cache-control')).toBe('private, max-age=86400')
    expect(Buffer.from(await bridgePlayback.arrayBuffer())).toEqual(playbackBytes)

    const playbackResponse = await fetch(playbackUrl)
    expect(playbackResponse.status).toBe(200)
    expect(playbackResponse.headers.get('content-type')).toBe('audio/mp4')
    expect(Buffer.from(await playbackResponse.arrayBuffer())).toEqual(playbackBytes)
    releaseRemoteAudioUrl(uploaded.id)

    // Release must drop the cached object URL so the next play re-fetches with auth.
    const refetched = await acquireRemoteAudioUrl(uploaded.id, secret)
    expect(refetched).not.toBe(playbackUrl)
    releaseRemoteAudioUrl(uploaded.id)
    await expect(acquireRemoteAudioUrl(uploaded.id, 'wrong-token')).rejects.toMatchObject({
      code: 'unauthorized',
    })

    const stored = await harness.opened.repo.getAudio(uploaded.id)
    expect(stored?.original.equals(clipBytes)).toBe(true)
    expect(stored?.playback.equals(playbackBytes)).toBe(true)
    expect(stored?.mimeType).toBe('audio/wav')
    expect(stored?.playbackMimeType).toBe('audio/mp4')
    const attachment = await harness.opened.repo.getAudioAttachment(uploaded.id)
    expect(attachment?.clientMsgId).toBe('client-voice-1')

    await close(first.socket)

    // A fresh connection is the reload path: history must come back from SQLite.
    const reloaded = await attach(harness, 'device-reload')
    const blocks = reloaded.snapshot.blocks as RenderBlock[]
    const userMessage = blocks.find((block) => block.kind === 'message' && block.role === 'user')
    expect(userMessage).toMatchObject({
      kind: 'message',
      role: 'user',
      text: transcriptText,
      audio: {
        id: uploaded.id,
        mimeType: 'audio/wav',
        playbackMimeType: 'audio/mp4',
        durationMs: clipDurationMs,
      },
    })

    const updates = reloaded.snapshot.updates as StoredUpdate[]
    const folded = fold(updates)
    expect(folded.find((block) => block.kind === 'message' && block.role === 'user')).toMatchObject(
      {
        text: transcriptText,
        audio: { id: uploaded.id },
      },
    )

    const afterReload = await acquireRemoteAudioUrl(uploaded.id, secret)
    expect(afterReload.startsWith('blob:')).toBe(true)
    releaseRemoteAudioUrl(uploaded.id)
    await close(reloaded.socket)
  })
})
