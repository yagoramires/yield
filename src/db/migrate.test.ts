import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { expect, test } from 'vitest'
import { SCHEMA_VERSION, type Db } from './client'
import { migrate, migrateOnce } from './migrate'
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

test('duas aberturas ao mesmo tempo no mesmo banco migram uma vez só', async () => {
  const db = execDb()
  let runs = 0
  const counted: Db = { ...db, execute: (sql, params) => { if (!params) runs++; return db.execute(sql, params) } }
  expect(await Promise.all([migrateOnce('perfil-a.db', counted, MIGRATIONS), migrateOnce('perfil-a.db', counted, MIGRATIONS)])).toEqual([MIGRATIONS.length, MIGRATIONS.length])
  expect(runs).toBe(MIGRATIONS.length)
  expect(await migrateOnce('perfil-a.db', counted, MIGRATIONS)).toBe(MIGRATIONS.length) // terminada, a próxima abertura relê a versão
  expect(runs).toBe(MIGRATIONS.length)
})
