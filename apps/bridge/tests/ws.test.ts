import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { type OpenDatabaseResult, openDatabase } from '../src/db/index.js'
import { LeaseManager } from '../src/lease/manager.js'
import { createLogger } from '../src/logger.js'

const secret = 'correct-horse-battery'

let opened: OpenDatabaseResult | undefined

afterEach(() => {
  opened?.close()
  opened = undefined
})

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for message')), 3000)
    socket.once('message', (data) => {
      clearTimeout(timer)
      resolve(JSON.parse(data.toString()) as Record<string, unknown>)
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

describe('ws routes', () => {
  it('authenticates, lists sessions, and keeps the socket open on invalid input', async () => {
    const config = loadConfig({
      BRIDGE_SECRET: secret,
      ACP_ENABLED: 'false',
    } as NodeJS.ProcessEnv)
    opened = openDatabase({ ...config, dbPath: ':memory:' })
    const lease = new LeaseManager({ graceMs: config.leaseGraceMs })
    const app = buildApp({
      config,
      repo: opened.repo,
      lease,
      logger: createLogger('silent'),
    })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address() as AddressInfo
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`)
    await once(socket, 'open')

    socket.send(JSON.stringify({ type: 'auth', token: secret, deviceId: 'device-a' }))
    expect(await nextMessage(socket)).toEqual({ type: 'ready', deviceId: 'device-a' })

    socket.send(JSON.stringify({ type: 'session.list' }))
    expect(await nextMessage(socket)).toEqual({ type: 'session.list', sessions: [] })

    socket.send(JSON.stringify({ type: 'made-up' }))
    expect(await nextMessage(socket)).toMatchObject({
      type: 'error',
      code: 'invalid_message',
      requestType: 'made-up',
    })
    expect(socket.readyState).toBe(WebSocket.OPEN)

    socket.send(JSON.stringify({ type: 'session.create', cwd: 'ignored' }))
    expect(await nextMessage(socket)).toMatchObject({
      type: 'error',
      code: 'agent_unavailable',
    })

    socket.close()
    await app.close()
    lease.dispose()
  })

  it('rejects a bad token', async () => {
    const config = loadConfig({
      BRIDGE_SECRET: secret,
      ACP_ENABLED: 'false',
    } as NodeJS.ProcessEnv)
    opened = openDatabase({ ...config, dbPath: ':memory:' })
    const lease = new LeaseManager({ graceMs: config.leaseGraceMs })
    const app = buildApp({
      config,
      repo: opened.repo,
      lease,
      logger: createLogger('silent'),
    })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address() as AddressInfo
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`)
    await once(socket, 'open')

    socket.send(JSON.stringify({ type: 'auth', token: 'wrong', deviceId: 'device-a' }))
    expect(await nextMessage(socket)).toMatchObject({
      type: 'error',
      code: 'unauthorized',
    })

    await once(socket, 'close')
    await app.close()
    lease.dispose()
  })
})
