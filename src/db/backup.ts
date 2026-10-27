import { SCHEMA_VERSION, type Db } from './client'

export class BackupError extends Error {}

export async function validateBackup(source: Db): Promise<void> {
  const erro = new BackupError('Este arquivo não é um backup do Yield.')
  let rows: { key: string; value: string }[]
  try { rows = await source.select('SELECT key, value FROM meta') } catch { throw erro }
  const meta = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  if (meta.app !== 'yield') throw erro
  if (meta.schema_version !== String(SCHEMA_VERSION)) throw new BackupError(`Este backup é de outra versão do Yield (esquema ${meta.schema_version}) e não pode ser importado nesta versão.`)
}

// tmpPath não pode existir (VACUUM INTO falha); dest pode, `move` sobrescreve.
export async function exportBackup(db: Db, tmpPath: string, dest: string, move: (from: string, to: string) => Promise<void>): Promise<void> {
  await db.execute('VACUUM INTO ?', [tmpPath])
  await move(tmpPath, dest)
}
