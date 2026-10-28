import type { Seq, SessionId, SessionSummary, StoredUpdate } from '@dsh-mobile/protocol'
import type Database from 'better-sqlite3'
import type { SessionRepository } from '../ports.js'

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
}
