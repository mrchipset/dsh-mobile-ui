import type { SessionSummary } from '@dsh-mobile/protocol'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { type OpenDatabaseResult, openDatabase } from '../src/db/index.js'
import { migrate } from '../src/db/migrate.js'

const secret = 'correct-horse-battery'

function memoryDb(): OpenDatabaseResult {
  const config = loadConfig({ BRIDGE_SECRET: secret } as NodeJS.ProcessEnv)
  return openDatabase({ ...config, dbPath: ':memory:' })
}

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    title: null,
    cwd: 'C:/workspace',
    createdAt: 1000,
    lastActivityAt: 1000,
    lastSeq: 0,
    lease: { state: 'idle', holder: null },
    running: false,
    ...overrides,
  }
}

let opened: OpenDatabaseResult | undefined

afterEach(() => {
  opened?.close()
  opened = undefined
})

describe('migrations and repository', () => {
  it('creates the schema and records user_version', () => {
    opened = memoryDb()
    const tables = opened.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>
    const names = tables.map((table) => table.name)

    expect(names).toEqual(
      expect.arrayContaining([
        'sessions',
        'updates',
        'devices',
        'prompt_receipts',
        'mcp_status',
        'audio_attachments',
      ]),
    )
    expect(opened.db.pragma('user_version', { simple: true })).toBe(2)
  })

  it('upgrades a v1 database to the audio attachment schema', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY); PRAGMA user_version = 1;')

    migrate(db)

    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string
      }>
    ).map((row) => row.name)
    expect(names).toContain('audio_attachments')
    expect(db.pragma('user_version', { simple: true })).toBe(2)
    db.close()
  })

  it('allocates sequences, appends, reads ranges, and prunes', async () => {
    opened = memoryDb()
    const repo = opened.repo
    await repo.upsert(summary('s1'))

    const first = await repo.nextSeq('s1')
    expect(first).toBe(1)
    await repo.append('s1', first, 'user_message_chunk', {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'hello' },
    })

    const second = await repo.nextSeq('s1')
    expect(second).toBe(2)
    await repo.append('s1', second, 'agent_message_chunk', {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hi' },
    })

    expect(await repo.lastSeq('s1')).toBe(2)
    const updates = await repo.range('s1', 1)
    expect(updates.map((update) => update.seq)).toEqual([1, 2])
    expect(updates[0]?.kind).toBe('user_message_chunk')

    const listed = await repo.list()
    expect(listed[0]?.lastSeq).toBe(2)
    expect(listed[0]?.lease).toEqual({ state: 'idle', holder: null })
    expect(listed[0]?.running).toBe(false)

    await repo.prune('s1', 1)
    expect(await repo.lastSeq('s1')).toBe(2)
    expect((await repo.range('s1', 1)).map((update) => update.seq)).toEqual([2])
  })

  it('preserves created_at when upserting an existing session', async () => {
    opened = memoryDb()
    const repo = opened.repo
    await repo.upsert(summary('s1', { createdAt: 111, lastActivityAt: 111 }))
    await repo.upsert(summary('s1', { title: 'Later', createdAt: 999, lastActivityAt: 999 }))

    const stored = await repo.get('s1')
    expect(stored?.createdAt).toBe(111)
    expect(stored?.lastActivityAt).toBe(999)
    expect(stored?.title).toBe('Later')
  })

  it('stores audio bytes and attaches them with session checks', async () => {
    opened = memoryDb()
    const repo = opened.repo
    await repo.upsert(summary('s1'))
    await repo.upsert(summary('s2'))

    await repo.insertAudio({
      id: 'a1',
      sessionId: 's1',
      mimeType: 'audio/webm',
      playbackMimeType: 'audio/mp4',
      durationMs: 1200,
      sizeBytes: 5,
      original: Buffer.from('ORIG'),
      playback: Buffer.from('M4A'),
      createdAt: 1000,
    })

    const stored = await repo.getAudio('a1')
    expect(stored?.original.equals(Buffer.from('ORIG'))).toBe(true)
    expect(stored?.playback.equals(Buffer.from('M4A'))).toBe(true)
    expect(stored?.clientMsgId).toBeNull()

    expect(await repo.attachAudioToPrompt('missing', 's1', 'c1')).toEqual({ status: 'not_found' })
    expect(await repo.attachAudioToPrompt('a1', 's2', 'c1')).toEqual({
      status: 'session_mismatch',
    })
    expect((await repo.getAudio('a1'))?.clientMsgId).toBeNull()

    const attached = await repo.attachAudioToPrompt('a1', 's1', 'c1')
    expect(attached).toEqual({
      status: 'ok',
      attachment: {
        id: 'a1',
        mimeType: 'audio/webm',
        playbackMimeType: 'audio/mp4',
        durationMs: 1200,
        sizeBytes: 5,
      },
    })
    expect((await repo.getAudio('a1'))?.clientMsgId).toBe('c1')

    opened.db.prepare('DELETE FROM sessions WHERE id = ?').run('s1')
    expect(await repo.getAudio('a1')).toBeUndefined()
  })

  it('returns sessions newest-activity first and supports rename', async () => {
    opened = memoryDb()
    const repo = opened.repo
    await repo.upsert(summary('old', { lastActivityAt: 100 }))
    await repo.upsert(summary('new', { lastActivityAt: 200 }))
    await repo.rename('old', 'Renamed')

    const listed = await repo.list()
    expect(listed.map((session) => session.id)).toEqual(['new', 'old'])
    expect(listed[1]?.title).toBe('Renamed')
  })
})
