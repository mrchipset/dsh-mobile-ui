import type { Seq, SessionId, SessionSummary, StoredUpdate } from '@dsh-mobile/protocol'
import type Database from 'better-sqlite3'
import type {
  AttachAudioResult,
  AudioAttachmentInfo,
  AudioRecord,
  InsertAudioInput,
  SessionRepository,
} from '../ports.js'

interface SessionRow {
  id: string
  title: string | null
  cwd: string
  created_at: number
  last_activity_at: number
  last_seq: number
}

interface UpdateRow {
  seq: number
  kind: string
  payload: string
  created_at: number
}

interface AudioMetaRow {
  id: string
  session_id: string
  client_msg_id: string | null
  mime_type: string
  playback_mime_type: string
  duration_ms: number
  size_bytes: number
}

interface AudioRow extends AudioMetaRow {
  original: Buffer
  playback: Buffer
  created_at: number
}

const SESSION_SELECT = `
  SELECT
    s.id,
    s.title,
    s.cwd,
    s.created_at,
    s.last_activity_at,
    COALESCE((SELECT MAX(u.seq) FROM updates u WHERE u.session_id = s.id), 0) AS last_seq
  FROM sessions s
`

function parsePayload(payload: string): unknown {
  try {
    return JSON.parse(payload) as unknown
  } catch {
    return payload
  }
}

function toAttachment(row: AudioMetaRow): AudioAttachmentInfo {
  return {
    id: row.id,
    sessionId: row.session_id,
    clientMsgId: row.client_msg_id,
    mimeType: row.mime_type,
    playbackMimeType: row.playback_mime_type,
    durationMs: row.duration_ms,
    sizeBytes: row.size_bytes,
  }
}

function toAudioRecord(row: AudioRow): AudioRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    clientMsgId: row.client_msg_id,
    mimeType: row.mime_type,
    playbackMimeType: row.playback_mime_type,
    durationMs: row.duration_ms,
    sizeBytes: row.size_bytes,
    original: Buffer.from(row.original),
    playback: Buffer.from(row.playback),
    createdAt: row.created_at,
  }
}

function toSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    title: row.title,
    cwd: row.cwd,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    lastSeq: row.last_seq,
    // Live lease/running state is overlaid by the Bridge; the row is the cold view.
    lease: { state: 'idle', holder: null },
    running: false,
  }
}

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: Database.Database) {}

  async list(): Promise<SessionSummary[]> {
    const rows = this.db
      .prepare(`${SESSION_SELECT} WHERE s.archived = 0 ORDER BY s.last_activity_at DESC, s.id ASC`)
      .all() as SessionRow[]
    return rows.map(toSummary)
  }

  async get(id: SessionId): Promise<SessionSummary | undefined> {
    const row = this.db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(id) as
      | SessionRow
      | undefined
    return row === undefined ? undefined : toSummary(row)
  }

  async upsert(summary: SessionSummary): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO sessions (id, title, cwd, created_at, last_activity_at, next_seq, archived)
         VALUES (?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           cwd = excluded.cwd,
           last_activity_at = excluded.last_activity_at`,
      )
      .run(
        summary.id,
        summary.title,
        summary.cwd,
        summary.createdAt,
        summary.lastActivityAt,
        Math.max(1, summary.lastSeq + 1),
      )
  }

  async nextSeq(id: SessionId): Promise<Seq> {
    const row = this.db
      .prepare(
        'UPDATE sessions SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq - 1 AS seq',
      )
      .get(id) as { seq: number } | undefined
    if (row === undefined) throw new Error('Session not found while allocating sequence')
    return row.seq
  }

  async append(id: SessionId, seq: Seq, kind: string, payload: unknown): Promise<void> {
    const now = Date.now()
    const insert = this.db.prepare(
      `INSERT INTO updates (session_id, seq, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    const touch = this.db.prepare('UPDATE sessions SET last_activity_at = ? WHERE id = ?')

    this.db.transaction(() => {
      insert.run(id, seq, kind, JSON.stringify(payload), now)
      touch.run(now, id)
    })()
  }

  async range(id: SessionId, from: Seq, to?: Seq): Promise<StoredUpdate[]> {
    const rows =
      to === undefined
        ? (this.db
            .prepare(
              `SELECT seq, kind, payload, created_at FROM updates
               WHERE session_id = ? AND seq >= ? ORDER BY seq ASC`,
            )
            .all(id, from) as UpdateRow[])
        : (this.db
            .prepare(
              `SELECT seq, kind, payload, created_at FROM updates
               WHERE session_id = ? AND seq >= ? AND seq <= ? ORDER BY seq ASC`,
            )
            .all(id, from, to) as UpdateRow[])

    return rows.map((row) => ({
      seq: row.seq,
      kind: row.kind,
      payload: parsePayload(row.payload),
      createdAt: row.created_at,
    }))
  }

  async lastSeq(id: SessionId): Promise<Seq> {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM updates WHERE session_id = ?')
      .get(id) as { seq: number }
    return row.seq
  }

  async prune(id: SessionId, keep: number): Promise<void> {
    if (keep <= 0) {
      this.db.prepare('DELETE FROM updates WHERE session_id = ?').run(id)
      return
    }
    this.db
      .prepare(
        `DELETE FROM updates
         WHERE session_id = ?
           AND seq <= COALESCE(
             (SELECT seq FROM updates WHERE session_id = ? ORDER BY seq DESC LIMIT 1 OFFSET ?),
             0
           )`,
      )
      .run(id, id, keep)
  }

  async rename(id: SessionId, title: string): Promise<void> {
    this.db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, id)
  }

  async insertAudio(input: InsertAudioInput): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO audio_attachments
           (id, session_id, client_msg_id, mime_type, playback_mime_type, duration_ms,
            size_bytes, original, playback, created_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.sessionId,
        input.mimeType,
        input.playbackMimeType,
        input.durationMs,
        input.sizeBytes,
        input.original,
        input.playback,
        input.createdAt,
      )
  }

  async getAudio(id: string): Promise<AudioRecord | undefined> {
    const row = this.db.prepare('SELECT * FROM audio_attachments WHERE id = ?').get(id) as
      | AudioRow
      | undefined
    return row === undefined ? undefined : toAudioRecord(row)
  }

  async getAudioAttachment(id: string): Promise<AudioAttachmentInfo | undefined> {
    const row = this.db
      .prepare(
        `SELECT id, session_id, client_msg_id, mime_type, playback_mime_type, duration_ms, size_bytes
         FROM audio_attachments WHERE id = ?`,
      )
      .get(id) as AudioMetaRow | undefined
    return row === undefined ? undefined : toAttachment(row)
  }

  async attachAudioToPrompt(
    audioId: string,
    sessionId: SessionId,
    clientMsgId: string,
  ): Promise<AttachAudioResult> {
    const row = await this.getAudioAttachment(audioId)
    if (row === undefined) return { status: 'not_found' }
    if (row.sessionId !== sessionId) return { status: 'session_mismatch' }
    if (row.clientMsgId !== null && row.clientMsgId !== clientMsgId) {
      return { status: 'already_attached' }
    }

    const result = this.db
      .prepare(
        `UPDATE audio_attachments SET client_msg_id = ?
         WHERE id = ? AND (client_msg_id IS NULL OR client_msg_id = ?)`,
      )
      .run(clientMsgId, audioId, clientMsgId)
    if (result.changes === 0) return { status: 'already_attached' }

    return {
      status: 'ok',
      attachment: {
        id: row.id,
        mimeType: row.mimeType,
        playbackMimeType: row.playbackMimeType,
        durationMs: row.durationMs,
        sizeBytes: row.sizeBytes,
      },
    }
  }
}
