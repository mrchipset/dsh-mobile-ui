import { readFileSync } from 'node:fs'
import type Database from 'better-sqlite3'

interface Migration {
  version: number
  file: string
}

const MIGRATIONS: readonly Migration[] = [
  { version: 1, file: '0001_init.sql' },
  { version: 2, file: '0002_audio_attachments.sql' },
]

function migrationSql(file: string): string {
  return readFileSync(new URL(`./migrations/${file}`, import.meta.url), 'utf8')
}

/**
 * Run pending migrations tracked by `PRAGMA user_version`.
 * WAL is skipped for in-memory databases, where it has no meaning.
 */
export function migrate(db: Database.Database): void {
  let current = db.pragma('user_version', { simple: true }) as number

  for (const migration of MIGRATIONS) {
    if (current >= migration.version) continue
    const sql = migrationSql(migration.file)
    db.transaction(() => {
      db.exec(sql)
      db.pragma(`user_version = ${migration.version}`)
    })()
    current = migration.version
  }
}
