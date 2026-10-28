import { beforeEach, describe, expect, test } from 'vitest'
import { createRawDb, createTestDb, tmpPath, type Db } from './testDb'
import {
  deleteEvent, deleteManualAsset, deleteNote, deletePayment, deleteQuote, getAlias, loadAll, renormalizeBrokers, replaceNote,
  saveAlias, saveEvent, saveManualAsset, saveNote, saveOpeningLoss, savePayment, setBonificacaoCost, upsertDividends, upsertQuote,
} from './repo'

let db: Db
beforeEach(() => { db = createTestDb() })

const nota = { number: '123', broker: 'CLEAR', tradeDate: '2024-01-05', settleDate: '2024-01-09', source: 'pdf' as const, sourceKey: null, label: null }
const trades = [
  { seq: 1, side: 'C' as const, assetType: 'Ação' as const, ticker: 'itsa4', qty: 100, priceCents: 1000, feesCents: 5, irrfCents: 0 },
  { seq: 2, side: 'C' as const, assetType: 'FII' as const, ticker: 'HGLG11F', qty: 10, priceCents: 15000, feesCents: 3, irrfCents: 0 },
]

describe('notas', () => {
  test('salva nota com trades e recarrega', async () => {
    const r = await saveNote(db, nota, trades)
    expect(r).toHaveProperty('id')
    const d = await loadAll(db)
    expect(d.notes).toHaveLength(1)
    expect(d.notes[0]).toMatchObject({ number: '123', broker: 'CLEAR', tradeDate: '2024-01-05' })
    expect(d.trades).toHaveLength(2)
    expect(d.trades[0]).toMatchObject({ noteId: (r as { id: string }).id, broker: 'CLEAR', tradeDate: '2024-01-05', settleDate: '2024-01-09', seq: 1, side: 'C', qty: 100, priceCents: 1000, feesCents: 5, irrfCents: 0 })
    expect(d.trades.map(t => t.ticker)).toEqual(['ITSA4', 'HGLG11']) // normalizeTicker
  })
  test('excluir nota apaga os trades', async () => {
    const r = (await saveNote(db, nota, trades)) as { id: string }
    await deleteNote(db, r.id)
    const d = await loadAll(db)
    expect(d.notes).toHaveLength(0)
    expect(d.trades).toHaveLength(0)
  })
  test('nota com o mesmo sourceKey é ignorada', async () => {
    expect(await saveNote(db, { ...nota, sourceKey: 'pdf:CLEAR:123' }, trades)).toHaveProperty('id')
    expect(await saveNote(db, { ...nota, sourceKey: 'pdf:CLEAR:123' }, trades)).toEqual({ skipped: 'duplicada' })
  })
  test('a mesma nota vinda da planilha e depois do PDF é duplicada', async () => {
    await saveNote(db, { number: '123', broker: 'CLEAR CORRETORA - GRUPO XP', tradeDate: '2024-01-05', settleDate: '2024-01-09', source: 'planilha', sourceKey: 'planilha:x', label: null }, trades)
    expect(await saveNote(db, { number: '123', broker: 'CLEAR', tradeDate: '2024-01-05', settleDate: '2024-01-09', source: 'pdf', sourceKey: 'pdf:CLEAR:123', label: null }, trades)).toEqual({ skipped: 'duplicada' })
  })
  test('editar nota troca os trades e mantém a nota única', async () => {
    const r = (await saveNote(db, nota, trades)) as { id: string }
    const n = await replaceNote(db, r.id, { ...nota, number: '124' }, [trades[0]])
    const d = await loadAll(db)
    expect(d.notes).toHaveLength(1)
    expect(d.notes[0]).toMatchObject({ id: n.id, number: '124' })
    expect(d.trades).toHaveLength(1)
  })
  test('editar para uma nota que já existe regrava a original', async () => {
    const a = (await saveNote(db, nota, trades)) as { id: string }
    await saveNote(db, { ...nota, number: '999' }, trades)
    await expect(replaceNote(db, a.id, { ...nota, number: '999' }, [trades[0]])).rejects.toThrow()
    const d = await loadAll(db)
    expect(d.notes.map(n => n.number).sort()).toEqual(['123', '999'])
    expect(d.trades).toHaveLength(4)
  })
  test('falha ao inserir trades apaga a nota', async () => {
    await expect(saveNote(db, nota, [{ ...trades[0], side: 'X' as never }])).rejects.toThrow()
    expect((await loadAll(db)).notes).toHaveLength(0)
  })
})

describe('renormalizeBrokers', () => {
  test('chaves gravadas por extenso passam à chave curta; o cadastro do IR já existente com a curta fica', async () => {
    const raw = 'XP INVESTIMENTOS CCTVM S/A'
    await db.execute("INSERT INTO notes (id, number, broker, trade_date, settle_date, source, source_key) VALUES ('n1', 'B3 2024-01-05', ?, '2024-01-05', '2024-01-09', 'sem_nota', ?)", [raw, `b3neg:2024-01-05:${raw}`])
    await db.execute("INSERT INTO notes (id, number, broker, trade_date, settle_date, source) VALUES ('n2', '1', 'CLEAR', '2024-01-05', '2024-01-09', 'manual')")
    await db.execute("INSERT INTO dividends (id, ticker, kind, pay_date, amount_cents, broker, source) VALUES ('d1', 'AAAA3', 'Dividendo', '2024-02-01', 100, ?, 'b3')", [raw])
    await db.execute("INSERT INTO brokers (code, name, cnpj) VALUES (?, 'XP INVESTIMENTOS CCTVM S/A', '11.222.333/0001-81'), ('NU INVEST CORRETORA DE VALORES S.A.', 'Nu', ''), ('NU', 'Nu Invest', '11.444.777/0001-61')", [raw])
    await renormalizeBrokers(db)
    await renormalizeBrokers(db) // idempotente
    const d = await loadAll(db)
    expect(d.notes.map(n => [n.broker, n.sourceKey])).toEqual([['CLEAR', null], ['XP', 'b3neg:2024-01-05:XP']])
    expect(d.dividends[0].broker).toBe('XP')
    expect(await db.select('SELECT code, cnpj FROM brokers ORDER BY code')).toEqual([
      { code: 'NU', cnpj: '11.444.777/0001-61' }, { code: 'NU INVEST CORRETORA DE VALORES S.A.', cnpj: '' }, { code: 'XP', cnpj: '11.222.333/0001-81' },
    ])
  })
})

describe('proventos', () => {
  test('provento repetido é ignorado e o da B3 substitui o da planilha no mesmo mês', async () => {
    await upsertDividends(db, [{ ticker: 'HGLG11', kind: 'Rendimento', payDate: '2024-03-01', amountCents: 1000, broker: null, source: 'planilha', sourceKey: 'planilha:HGLG11:2024-03:Rendimento' }])
    const r = await upsertDividends(db, [
      { ticker: 'HGLG11', kind: 'Rendimento', payDate: '2024-03-14', amountCents: 1100, broker: 'CLEAR', source: 'b3', sourceKey: 'b3:x' },
      { ticker: 'HGLG11', kind: 'Rendimento', payDate: '2024-03-14', amountCents: 1100, broker: 'CLEAR', source: 'b3', sourceKey: 'b3:x' },
    ])
    expect(r).toEqual({ inserted: 1, skipped: 1, replaced: 1 })
    expect((await loadAll(db)).dividends.map(d => d.amountCents)).toEqual([1100])
    expect(await upsertDividends(db, [{ ticker: 'HGLG11', kind: 'Rendimento', payDate: '2024-03-01', amountCents: 1000, broker: null, source: 'planilha', sourceKey: 'planilha:HGLG11:2024-03:Rendimento' }])).toEqual({ inserted: 0, skipped: 1, replaced: 0 })
  })
})

describe('eventos, pagamentos, cotações, manuais, aliases', () => {
  test('eventos: grava, ignora sourceKey repetido, ajusta custo da bonificação e apaga', async () => {
    const r = (await saveEvent(db, { kind: 'bonificacao', ticker: 'itsa4', date: '2024-02-01', qtyDelta: 10, unitCostCents: null, sourceKey: 'k' })) as { id: string }
    expect(await saveEvent(db, { kind: 'bonificacao', ticker: 'ITSA4', date: '2024-02-01', qtyDelta: 10, unitCostCents: null, sourceKey: 'k' })).toEqual({ skipped: 'duplicada' })
    await saveEvent(db, { kind: 'mudanca_ticker', ticker: 'AAAA3', newTicker: 'bbbb3', date: '2024-03-01' })
    await setBonificacaoCost(db, r.id, 250)
    let ev = (await loadAll(db)).events
    expect(ev).toHaveLength(2)
    expect(ev.find(e => e.id === r.id)).toEqual({ id: r.id, kind: 'bonificacao', ticker: 'ITSA4', date: '2024-02-01', qtyDelta: 10, unitCostCents: 250 })
    expect(ev.find(e => e.kind === 'mudanca_ticker')).toMatchObject({ ticker: 'AAAA3', newTicker: 'BBBB3' })
    await deleteEvent(db, r.id)
    ev = (await loadAll(db)).events
    expect(ev).toHaveLength(1)
  })
  test('pagamentos de DARF: regrava o mês e apaga', async () => {
    await savePayment(db, { month: '2024-03', paidAt: '2024-04-30', principalCents: 100, totalPaidCents: 110 })
    await savePayment(db, { month: '2024-03', paidAt: '2024-05-02', principalCents: 100, totalPaidCents: 120 })
    expect((await loadAll(db)).payments).toEqual([{ month: '2024-03', paidAt: '2024-05-02', principalCents: 100, totalPaidCents: 120 }])
    await deletePayment(db, '2024-03')
    expect((await loadAll(db)).payments).toEqual([])
  })
  test('cotação manual prevalece sobre a do Yahoo', async () => {
    await upsertQuote(db, { symbol: 'ITSA4.SA', priceCents: 1000, fetchedAt: 't1', source: 'yahoo' })
    await upsertQuote(db, { symbol: 'ITSA4.SA', priceCents: 1100, fetchedAt: 't2', source: 'yahoo' })
    expect((await loadAll(db)).quotes[0].priceCents).toBe(1100)
    await upsertQuote(db, { symbol: 'ITSA4.SA', priceCents: 900, fetchedAt: 't3', source: 'manual' })
    await upsertQuote(db, { symbol: 'ITSA4.SA', priceCents: 1200, fetchedAt: 't4', source: 'yahoo' })
    expect((await loadAll(db)).quotes).toEqual([{ symbol: 'ITSA4.SA', priceCents: 900, fetchedAt: 't3', source: 'manual' }])
    await deleteQuote(db, 'ITSA4.SA')
    expect((await loadAll(db)).quotes).toEqual([])
  })
  test('ativos manuais: sourceKey repetido é ignorado; id existente atualiza', async () => {
    const base = { name: 'CDB', assetClass: 'renda_fixa' as const, currency: 'BRL' as const, costCents: null, quoteSymbol: null, quantity: null, valueCents: 5000, updatedAt: '2024-01-01', sourceKey: 'pl:cdb' }
    const id = await saveManualAsset(db, base)
    expect(typeof id).toBe('string')
    expect(await saveManualAsset(db, base)).toEqual({ skipped: 'duplicada' })
    await saveManualAsset(db, { ...base, id: id as string, valueCents: 6000 })
    const m = (await loadAll(db)).manualAssets
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ id, valueCents: 6000 })
    await deleteManualAsset(db, id as string)
    expect((await loadAll(db)).manualAssets).toEqual([])
  })
  test('aliases', async () => {
    expect(await getAlias(db, 'ITAUSA PN')).toBeNull()
    await saveAlias(db, 'ITAUSA PN', 'itsa4')
    expect(await getAlias(db, 'ITAUSA PN')).toBe('ITSA4')
  })
})

describe('prejuízo inicial', () => {
  test('salva, troca e apaga o prejuízo a compensar informado', async () => {
    expect((await loadAll(db)).openingLoss).toBeNull()
    await saveOpeningLoss(db, { month: '2019-01', comumCents: 120_000, fiiCents: 5_000 })
    await saveOpeningLoss(db, { month: '2019-02', comumCents: 100_000, fiiCents: 0 })
    expect((await loadAll(db)).openingLoss).toEqual({ month: '2019-02', comumCents: 100_000, fiiCents: 0 })
    await saveOpeningLoss(db, null)
    expect((await loadAll(db)).openingLoss).toBeNull()
  })
})

describe('arquivo', () => {
  test('createTestDb não reaplica a migração; createRawDb não tem tabelas', async () => {
    const p = tmpPath('t.db')
    await saveNote(createTestDb(p), nota, trades)
    expect((await loadAll(createTestDb(p))).notes).toHaveLength(1)
    await expect(createRawDb().select('SELECT * FROM meta')).rejects.toThrow()
  })
})
