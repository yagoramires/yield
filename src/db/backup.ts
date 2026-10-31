import { invoke } from '@tauri-apps/api/core'
import { openDb, RESTORE_FILE, SCHEMA_VERSION, type Db } from './client'

export class BackupError extends Error {}

const NAO_E_BACKUP = 'Este arquivo não é um backup do Yield.'

export async function validateBackup(source: Db): Promise<void> {
  const erro = new BackupError(NAO_E_BACKUP)
  let rows: { key: string; value: string }[]
  try { rows = await source.select('SELECT key, value FROM meta') } catch { throw erro }
  const meta = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  if (meta.app !== 'yield') throw erro
  if (meta.schema_version !== String(SCHEMA_VERSION)) throw new BackupError(`Este backup é de outra versão do Yield (esquema ${meta.schema_version}) e não pode ser importado nesta versão.`)
}

/** Põe o backup escolhido (`.yield` com a senha, ou `.db` antigo com `null`) no `restore.db` e o valida; falhando, o `restore.db` some. */
export async function stageBackup(path: string, password: string | null): Promise<void> {
  try {
    // o Rust recusa com o mesmo texto: vira BackupError para a tela mostrar sem prefixo, como antes
    await invoke('backup_open', { path, password }).catch((e: unknown) => { throw e === NAO_E_BACKUP ? new BackupError(NAO_E_BACKUP) : e })
    let source: Db
    try { source = await openDb(RESTORE_FILE) } catch { throw new BackupError(NAO_E_BACKUP) }
    try { await validateBackup(source) } finally { await source.close() }
  } catch (e) {
    // o restore.db é o backup aberto: não fica no disco se a importação parou aqui
    await invoke('discard_restore').catch(() => {})
    throw e
  }
}
