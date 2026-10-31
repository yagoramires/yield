import type { Db } from './client'

async function schemaVersion(db: Db): Promise<number> {
  const hasMeta = (await db.select("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'")).length > 0
  const row = hasMeta ? (await db.select<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'"))[0] : undefined
  return row ? Number(row.value) : 0
}

/** Roda as migrações que faltam (cada arquivo grava a própria versão em `meta.schema_version`) e devolve a versão final. */
export async function migrate(db: Db, migrations: string[]): Promise<number> {
  // o plugin roda todos os comandos de um `execute` (sqlx prepara o resto do texto até acabar), então vai um arquivo por vez
  for (const sql of migrations.slice(await schemaVersion(db))) await db.execute(sql)
  return schemaVersion(db)
}

const running = new Map<string, Promise<number>>()

// Duas aberturas ao mesmo tempo (StrictMode roda o efeito duas vezes) leriam a versão 0 e criariam as tabelas duas vezes: a segunda espera a primeira.
export function migrateOnce(key: string, db: Db, migrations: string[]): Promise<number> {
  const cur = running.get(key)
  if (cur) return cur
  const p = migrate(db, migrations).finally(() => running.delete(key))
  running.set(key, p)
  return p
}
