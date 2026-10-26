import { renameSync, writeFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { exportBackup, validateBackup } from './backup'
import { loadAll, saveNote } from './repo'
import { createRawDb, createTestDb, tmpPath } from './testDb'

const nota = { number: '123', broker: 'CLEAR', tradeDate: '2024-01-05', settleDate: '2024-01-09', source: 'pdf' as const, sourceKey: null, label: null }
const trades = [
  { seq: 1, side: 'C' as const, assetType: 'Ação' as const, ticker: 'itsa4', qty: 100, priceCents: 1000, feesCents: 5, irrfCents: 0 },
]

describe('backup', () => {
  test('arquivo que não é do Yield é recusado', async () => {
    await expect(validateBackup(createRawDb())).rejects.toThrow('não é um backup do Yield')
  })
  test('versão de schema diferente é recusada', async () => {
    const db = createTestDb()
    await db.execute("UPDATE meta SET value = '99' WHERE key = 'schema_version'")
    await expect(validateBackup(db)).rejects.toThrow('não é um backup do Yield')
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
