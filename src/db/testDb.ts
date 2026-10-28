import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { Db } from './client'

export type { Db }

const MIGRATIONS = ['001_init.sql', '002_gastos.sql', '003_orcamento.sql', '004_fontes_renda.sql', '005_categoria_pluggy.sql', '006_categoria_visual.sql', '007_fonte_clt.sql', '008_cadastro_ir.sql', '009_renda_fixa_cripto.sql'].map(f => readFileSync(new URL(`../../src-tauri/migrations/${f}`, import.meta.url), 'utf8'))

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
  const hasMeta = d.prepare("SELECT 1 FROM sqlite_master WHERE name = 'meta'").get()
  const current = hasMeta ? Number((d.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }).value) : 0
  MIGRATIONS.slice(current).forEach(sql => d.exec(sql))
  return wrap(d)
}

export const tmpPath = (name: string): string => join(tmpdir(), `yield-${randomUUID()}-${name}`)
