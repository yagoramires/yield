import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { expect, test } from 'vitest'
import { SCHEMA_VERSION, type Db } from './client'
import { migrate } from './migrate'
import { MIGRATIONS } from './migrations'

// Como o plugin: `execute` sem parâmetros roda o arquivo inteiro, com vários comandos.
function execDb(): Db {
  const d = new DatabaseSync(':memory:')
  return {
    select: async <T>(sql: string, params?: unknown[]) => d.prepare(sql).all(...((params ?? []) as SQLInputValue[])) as T[],
    execute: async (sql, params) => {
      if (!params) { d.exec(sql); return { rowsAffected: 0 } }
      return { rowsAffected: Number(d.prepare(sql).run(...(params as SQLInputValue[])).changes) }
    },
    close: async () => { d.close() },
  }
}

test('há um arquivo de migração por versão do esquema', () => {
  expect(MIGRATIONS.length).toBe(SCHEMA_VERSION)
})

test('banco novo recebe todas as migrações; banco em dia não muda', async () => {
  const db = execDb()
  expect(await migrate(db, MIGRATIONS)).toBe(MIGRATIONS.length)
  expect((await db.select<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'"))[0].value).toBe(String(MIGRATIONS.length))
  expect(await migrate(db, MIGRATIONS)).toBe(MIGRATIONS.length)
})

test('banco na versão 16 recebe só as que faltam', async () => {
  const db = execDb()
  expect(await migrate(db, MIGRATIONS.slice(0, 16))).toBe(16)
  expect(await migrate(db, MIGRATIONS)).toBe(MIGRATIONS.length)
})
