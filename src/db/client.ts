import { invoke } from '@tauri-apps/api/core'

export interface Db {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>
  close(): Promise<void>
}

export const SCHEMA_VERSION = 18

// O backup em importação: o único arquivo fora do perfil aberto que o Rust deixa abrir.
export const RESTORE_FILE = 'restore.db'

// Só abre o arquivo (na pasta do app): quem abre o banco de um perfil roda o `migrateOnce`; um backup é aberto sem migrar.
// O Rust guarda o pool pelo nome do arquivo, então este `Db` segue valendo se o mesmo arquivo for fechado e reaberto.
export async function openDb(file: string): Promise<Db> {
  await invoke('db_load', { file })
  return {
    select: (sql, params) => invoke('db_select', { file, sql, params: params ?? [] }),
    execute: async (sql, params) => ({ rowsAffected: (await invoke<{ rowsAffected: number }>('db_execute', { file, sql, params: params ?? [] })).rowsAffected }),
    close: () => invoke('db_close', { file }),
  }
}
