import Database from '@tauri-apps/plugin-sql'

export interface Db {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>
  close(): Promise<void>
}

export const SCHEMA_VERSION = 18

// Com `path` abre outro arquivo (backup), sem rodar a migração do app.
export async function openDb(path = 'sqlite:yield.db'): Promise<Db> {
  const d = await Database.load(path)
  await d.execute('PRAGMA foreign_keys = ON')
  return {
    select: (sql, params) => d.select(sql, params),
    execute: async (sql, params) => ({ rowsAffected: (await d.execute(sql, params)).rowsAffected }),
    // sem o nome, o plugin fecha TODOS os pools (fechar o backup derrubaria o banco do app)
    close: async () => { await d.close(d.path) },
  }
}
