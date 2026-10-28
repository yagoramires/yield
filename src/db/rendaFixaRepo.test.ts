import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, test } from 'vitest'
import { loadAll, saveManualAsset } from './repo'
import { saveCryptoBalances, setCryptoCost, upsertRfMoves, upsertRfPositions, type RfMove, type RfPosition } from './rendaFixaRepo'
import { createTestDb, tmpPath } from './testDb'

const move = (over: Partial<Omit<RfMove, 'id'>> = {}): Omit<RfMove, 'id'> => ({
  key: 'td:tesouro prefixado 2099', product: 'Tesouro Prefixado 2099', date: '2026-01-10', kind: 'aplicacao', qty: 1, valueCents: 100000, sourceKey: 'b3rf:a', ...over,
})
const pos = (over: Partial<RfPosition> = {}): RfPosition => ({
  key: 'rf:CDB0000AA00', family: 'rf', product: 'CDB - BANCO LARANJA S/A', issuer: 'BANCO LARANJA S/A', indexer: 'CDI', maturity: '2099-01-01', qty: 1, appliedCents: null, valueCents: 100000, asOf: '2026-10-20', ...over,
})

describe('renda fixa e cripto no banco', () => {
  test('reimportar as mesmas movimentações não duplica', async () => {
    const db = createTestDb()
    const list = [move(), move({ kind: 'juros', valueCents: 3000, sourceKey: 'b3rf:b' })]
    expect(await upsertRfMoves(db, list)).toEqual({ inserted: 2, skipped: 0 })
    expect(await upsertRfMoves(db, list)).toEqual({ inserted: 0, skipped: 2 })
    expect((await loadAll(db)).rfMoves).toHaveLength(2)
  })

  test('valor da B3 desconhecido volta como null', async () => {
    const db = createTestDb()
    await upsertRfMoves(db, [move({ kind: 'saida', valueCents: null })])
    expect((await loadAll(db)).rfMoves[0]).toMatchObject({ kind: 'saida', valueCents: null, qty: 1 })
  })

  test('posição mais antiga não sobrescreve a guardada', async () => {
    const db = createTestDb()
    expect(await upsertRfPositions(db, [pos()])).toEqual({ updated: 1, older: 0 })
    expect(await upsertRfPositions(db, [pos({ asOf: '2026-10-10', valueCents: 90000 })])).toEqual({ updated: 0, older: 1 })
    expect((await loadAll(db)).rfPositions[0].valueCents).toBe(100000)
    expect(await upsertRfPositions(db, [pos({ asOf: '2026-10-27', valueCents: 110000 })])).toEqual({ updated: 1, older: 0 })
    expect((await loadAll(db)).rfPositions[0]).toMatchObject({ valueCents: 110000, asOf: '2026-10-27', issuer: 'BANCO LARANJA S/A', appliedCents: null })
  })

  test('novo saldo da Binance mantém o aportado e zera moeda que sumiu', async () => {
    const db = createTestDb()
    await saveCryptoBalances(db, [{ asset: 'BTC', qty: 0.5 }, { asset: 'ETH', qty: 2 }], '2026-10-27T10:00:00Z')
    await setCryptoCost(db, 'BTC', 10000)
    await saveCryptoBalances(db, [{ asset: 'BTC', qty: 0.6 }], '2026-10-27T11:00:00Z')
    const byAsset = new Map((await loadAll(db)).cryptoBalances.map(c => [c.asset, c]))
    expect(byAsset.get('BTC')).toMatchObject({ qty: 0.6, costCents: 10000, fetchedAt: '2026-10-27T11:00:00Z' })
    expect(byAsset.get('ETH')?.qty).toBe(0)
  })

  test('ativo manual do exterior guarda a moeda; os antigos são em real', async () => {
    const db = createTestDb()
    await saveManualAsset(db, { name: 'ZZZZ', assetClass: 'exterior', currency: 'USD', costCents: 9000, quoteSymbol: 'ZZZZ', quantity: 2, valueCents: null, updatedAt: '2026-10-27', sourceKey: null })
    await db.execute("INSERT INTO manual_assets (id, name, asset_class, updated_at) VALUES ('velho', 'Tesouro à mão', 'renda_fixa', '2026-01-01')")
    const list = (await loadAll(db)).manualAssets
    expect(list.find(a => a.name === 'ZZZZ')).toMatchObject({ assetClass: 'exterior', currency: 'USD', quantity: 2, costCents: 9000 })
    expect(list.find(a => a.id === 'velho')?.currency).toBe('BRL')
  })
})

describe('migração 009', () => {
  test('banco v8 mantém os ativos manuais e ganha a moeda', async () => {
    const path = tmpPath('v8.db')
    const d = new DatabaseSync(path)
    for (const f of ['001_init', '002_gastos', '003_orcamento', '004_fontes_renda', '005_categoria_pluggy', '006_categoria_visual', '007_fonte_clt', '008_cadastro_ir']) d.exec(readFileSync(new URL(`../../src-tauri/migrations/${f}.sql`, import.meta.url), 'utf8'))
    d.exec("INSERT INTO manual_assets (id, name, asset_class, quote_symbol, quantity, updated_at, source_key) VALUES ('m1', 'BTC à mão', 'cripto', 'BTC-BRL', 0.1, '2026-01-01', 'k1')")
    d.close()
    const migrado = createTestDb(path)
    expect((await loadAll(migrado)).manualAssets).toEqual([{ id: 'm1', name: 'BTC à mão', assetClass: 'cripto', currency: 'BRL', costCents: null, quoteSymbol: 'BTC-BRL', quantity: 0.1, valueCents: null, updatedAt: '2026-01-01', sourceKey: 'k1' }])
  })
})
