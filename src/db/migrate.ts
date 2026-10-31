import type { Db } from './client'

async function schemaVersion(db: Db): Promise<number> {
  const hasMeta = (await db.select("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'")).length > 0
  const row = hasMeta ? (await db.select<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'"))[0] : undefined
  return row ? Number(row.value) : 0
}

/** Roda as migrações que faltam (cada arquivo grava a própria versão em `meta.schema_version`) e devolve a versão final. */
export async function migrate(db: Db, migrations: string[]): Promise<number> {
  // o plugin roda todos os comandos de um `execute` (sqlx prepara o resto do texto até acabar), então vai um arquivo por vez,
  // numa transação: um arquivo que falha (ou o app fechado no meio) não deixa o banco pela metade
  for (const sql of migrations.slice(await schemaVersion(db))) {
    try { await db.execute(`BEGIN;\n${sql}\nCOMMIT;`) } catch (e) {
      // a transação aberta ficaria numa conexão do pool; fechar o banco faz o SQLite desfazê-la
      await db.close().catch(() => {})
      throw e
    }
  }
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
