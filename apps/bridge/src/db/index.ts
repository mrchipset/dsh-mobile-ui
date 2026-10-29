import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type { Config } from '../config.js'
import { migrate } from './migrate.js'
import { SqliteSessionRepository } from './repository.js'

export interface OpenDatabaseResult {
  db: Database.Database
  repo: SqliteSessionRepository
  close: () => void
}

export function openDatabase(config: Config): OpenDatabaseResult {
  if (config.dbPath !== ':memory:') {
    mkdirSync(dirname(config.dbPath), { recursive: true })
  }

  const db = new Database(config.dbPath)
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
  migrate(db)

  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    db.close()
  }

  return { db, repo: new SqliteSessionRepository(db), close }
}

export { SqliteSessionRepository }
