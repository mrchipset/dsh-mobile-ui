import { readFileSync } from 'node:fs'
import type Database from 'better-sqlite3'

const INITIAL_VERSION = 1

function initialSql(): string {
  return readFileSync(new URL('./migrations/0001_init.sql', import.meta.url), 'utf8')
}

/**
 * Run pending migrations tracked by `PRAGMA user_version`.
 * WAL is skipped for in-memory databases, where it has no meaning.
 */
export function migrate(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current >= INITIAL_VERSION) return

  let sql = initialSql()
  if (db.memory) {
    sql = sql.replace(/PRAGMA\s+journal_mode\s*=\s*WAL;?/i, '').trim()
  }

  db.exec(sql)
  db.pragma(`user_version = ${INITIAL_VERSION}`)
}
