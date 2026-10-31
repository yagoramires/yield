import type { Db } from './client'

/** Roda as migrações que faltam (cada arquivo grava a própria versão em `meta.schema_version`) e devolve a versão final. */
export async function migrate(db: Db, migrations: string[]): Promise<number> {
  const hasMeta = (await db.select("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'")).length > 0
  const row = hasMeta ? (await db.select<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'"))[0] : undefined
  const current = row ? Number(row.value) : 0
  // o plugin roda todos os comandos de um `execute` (sqlx prepara o resto do texto até acabar), então vai um arquivo por vez
  for (const sql of migrations.slice(current)) await db.execute(sql)
  return Math.max(current, migrations.length)
}
