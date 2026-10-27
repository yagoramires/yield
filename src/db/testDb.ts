import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { Db } from './client'

export type { Db }

const MIGRATION = readFileSync(new URL('../../src-tauri/migrations/001_init.sql', import.meta.url), 'utf8')

function wrap(d: DatabaseSync): Db {
  d.exec('PRAGMA foreign_keys = ON')
  const args = (p?: unknown[]) => (p ?? []) as SQLInputValue[]
  return {
    select: async <T>(sql: string, params?: unknown[]) => d.prepare(sql).all(...args(params)) as T[],
    execute: async (sql, params) => ({ rowsAffected: Number(d.prepare(sql).run(...args(params)).changes) }),
    close: async () => { d.close() },
  }
}

export const createRawDb = (path = ':memory:'): Db => wrap(new DatabaseSync(path))

export function createTestDb(path = ':memory:'): Db {
  const d = new DatabaseSync(path)
  if (!d.prepare("SELECT 1 FROM sqlite_master WHERE name = 'meta'").get()) d.exec(MIGRATION)
  return wrap(d)
}

export const tmpPath = (name: string): string => join(tmpdir(), `yield-${randomUUID()}-${name}`)
