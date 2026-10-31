import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { expect, test } from 'vitest'
import { SCHEMA_VERSION, type Db } from './client'
import { migrate, migrateOnce } from './migrate'
import { MIGRATIONS } from './migrations'

// Como o plugin: `execute` sem parâmetros roda o arquivo inteiro, com vários comandos.
function execDb(file = ':memory:'): Db {
  const d = new DatabaseSync(file)
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

test('banco em dia abre sem rodar migração, com ou sem o histórico do plugin (`_sqlx_migrations`) das versões antigas', async () => {
  for (const comHistorico of [false, true]) {
    const db = execDb()
    await migrate(db, MIGRATIONS)
    if (comHistorico) await db.execute('CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY); INSERT INTO _sqlx_migrations VALUES (18);')
    let runs = 0
    const counted: Db = { ...db, execute: (sql, params) => { runs++; return db.execute(sql, params) } }
    expect(await migrate(counted, MIGRATIONS)).toBe(SCHEMA_VERSION)
    expect(runs).toBe(0)
    if (comHistorico) expect(await db.select('SELECT version FROM _sqlx_migrations')).toEqual([{ version: 18 }])
  }
})

test('arquivo que falha no meio é desfeito inteiro e o banco é fechado', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yield-migrate-'))
  try {
    const file = join(dir, 'perfil-abcd1234.db')
    const db = execDb(file)
    let closed = false
    const spied: Db = { ...db, close: () => { closed = true; return db.close() } }
    const quebrada = "CREATE TABLE nova (a INTEGER);\nINSERT INTO nova VALUES (1);\nINSERT INTO nao_existe VALUES (1);\nUPDATE meta SET value = '2' WHERE key = 'schema_version';"
    await expect(migrate(spied, [MIGRATIONS[0], quebrada])).rejects.toThrow(/nao_existe/)
    expect(closed).toBe(true)
    const reaberto = execDb(file)
    expect(await reaberto.select("SELECT value FROM meta WHERE key = 'schema_version'")).toEqual([{ value: '1' }])
    expect(await reaberto.select("SELECT 1 FROM sqlite_master WHERE name = 'nova'")).toEqual([])
    await reaberto.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
