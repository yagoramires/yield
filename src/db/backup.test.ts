import { renameSync, writeFileSync } from 'node:fs'
import { invoke } from '@tauri-apps/api/core'
import { describe, expect, test, vi } from 'vitest'
import { BackupError, exportBackup, stageBackup, validateBackup } from './backup'
import { loadAll, saveNote } from './repo'
import { createRawDb, createTestDb, tmpPath } from './testDb'

const nota = { number: '123', broker: 'CLEAR', tradeDate: '2024-01-05', settleDate: '2024-01-09', source: 'pdf' as const, sourceKey: null, label: null }
const trades = [
  { seq: 1, side: 'C' as const, assetType: 'Ação' as const, ticker: 'itsa4', qty: 100, priceCents: 1000, feesCents: 5, irrfCents: 0 },
]

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('stageBackup', () => {
  // grava os comandos chamados; o `meta` lido do restore.db diz se o backup é do Yield
  function fake(app: string, openError?: string) {
    const calls: string[] = []
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      calls.push(cmd)
      if (cmd === 'backup_open' && openError) throw openError
      if (cmd === 'db_select') return [{ key: 'app', value: app }, { key: 'schema_version', value: '18' }]
    })
    return calls
  }
  test('backup válido fica no restore.db, com o banco fechado', async () => {
    const calls = fake('yield')
    await stageBackup('/x/b.yield', 'senha')
    expect(vi.mocked(invoke).mock.calls[0]).toEqual(['backup_open', { path: '/x/b.yield', password: 'senha' }])
    expect(calls).toEqual(['backup_open', 'db_load', 'db_select', 'db_close'])
  })
  test('backup inválido ou recusado pelo Rust apaga o restore.db', async () => {
    const calls = fake('outro')
    await expect(stageBackup('/x/b.db', null)).rejects.toThrow(new BackupError('Este arquivo não é um backup do Yield.'))
    expect(calls).toEqual(['backup_open', 'db_load', 'db_select', 'db_close', 'discard_restore'])
    const recusado = fake('yield', 'Este arquivo não é um backup do Yield.')
    await expect(stageBackup('/x/c.db', null)).rejects.toBeInstanceOf(BackupError)
    expect(recusado).toEqual(['backup_open', 'discard_restore'])
    const senha = fake('yield', 'Senha errada ou arquivo corrompido.')
    await expect(stageBackup('/x/b.yield', 'x')).rejects.toBe('Senha errada ou arquivo corrompido.')
    expect(senha).toEqual(['backup_open', 'discard_restore'])
  })
})

describe('backup', () => {
  test('arquivo que não é do Yield é recusado', async () => {
    await expect(validateBackup(createRawDb())).rejects.toThrow('não é um backup do Yield')
  })
  test('versão de schema diferente é recusada', async () => {
    const db = createTestDb()
    await db.execute("UPDATE meta SET value = '99' WHERE key = 'schema_version'")
    await expect(validateBackup(db)).rejects.toThrow('Este backup é de outra versão do Yield (esquema 99) e não pode ser importado nesta versão.')
  })
  test('exportar sobre arquivo existente funciona e o backup é válido', async () => {
    const db = createTestDb(); await saveNote(db, nota, trades)
    const dest = tmpPath('b.db'); writeFileSync(dest, 'lixo')
    await exportBackup(db, tmpPath('t.db'), dest, async (a, b) => renameSync(a, b))
    const back = createTestDb(dest)
    await validateBackup(back)
    expect((await loadAll(back)).notes).toHaveLength(1)
  })
})

describe('backup schema 11', () => {
  test('banco novo é schema 11 e válido', async () => {
    const db = createTestDb()
    expect((await db.select<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'"))[0].value).toBe('18')
    await validateBackup(db)
  })
  test('backup v7 é recusado', async () => {
    const db = createTestDb()
    await db.execute("UPDATE meta SET value = '7' WHERE key = 'schema_version'")
    await expect(validateBackup(db)).rejects.toThrow(new BackupError('Este backup é de outra versão do Yield (esquema 7) e não pode ser importado nesta versão.'))
  })
  test('backup schema 2 é recusado com a mensagem de versão', async () => {
    const db = createTestDb()
    await db.execute("UPDATE meta SET value = '2' WHERE key = 'schema_version'")
    await expect(validateBackup(db)).rejects.toThrow(new BackupError('Este backup é de outra versão do Yield (esquema 2) e não pode ser importado nesta versão.'))
  })
  test('backup schema 1 é recusado', async () => {
    const db = createTestDb()
    await db.execute("UPDATE meta SET value = '1' WHERE key = 'schema_version'")
    await expect(validateBackup(db)).rejects.toThrow(new BackupError('Este backup é de outra versão do Yield (esquema 1) e não pode ser importado nesta versão.'))
  })
})
