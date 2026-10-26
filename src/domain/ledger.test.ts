import { describe, expect, test } from 'vitest'
import { normalizeTicker, replay } from './ledger'
import type { CorporateEvent, Trade } from './types'

const t = (o: Partial<Trade> & { id: string }): Trade => ({
  noteId: 'n1', seq: 1, broker: 'CLEAR', tradeDate: '2024-01-02', settleDate: o.tradeDate ?? '2024-01-02',
  side: 'C', assetType: 'Ação', ticker: 'ITSA4', qty: 10, priceCents: 1000, feesCents: 0, irrfCents: 0, ...o,
})

const three = () => [
  t({ id: '1', tradeDate: '2024-01-10', side: 'C', ticker: 'ITSA4', qty: 100, priceCents: 1000, feesCents: 120 }),
  t({ id: '2', tradeDate: '2024-02-10', side: 'C', ticker: 'ITSA4', qty: 100, priceCents: 1200 }),
  t({ id: '3', tradeDate: '2024-03-10', side: 'V', ticker: 'ITSA4', qty: 50, priceCents: 1500, feesCents: 50 }),
]

describe('replay', () => {
  test('preço médio com taxas e resultado da venda', () => {
    const r = replay(three(), [])
    expect(r.sales[0]).toMatchObject({ grossCents: 75000, netCents: 74950, costBasisCents: 55030, resultCents: 19920 })
    expect(r.positions).toEqual([{ ticker: 'ITSA4', assetType: 'Ação', qty: 150, totalCostCents: 165090 }])
  })
  test('ordem de entrada não importa', () => {
    const [a, b, c] = three()
    expect(replay([c, a, b], [])).toEqual(replay([a, b, c], []))
  })
  test('fracionário soma na posição do lote padrão', () => {
    expect(normalizeTicker(' itsa4f ')).toBe('ITSA4')
    expect(normalizeTicker('TAEE11F')).toBe('TAEE11')
    expect(normalizeTicker('HGLG11')).toBe('HGLG11')
    const r = replay([t({ id: '1', ticker: 'ITSA4F', qty: 10 }), t({ id: '2', seq: 2, ticker: 'ITSA4', qty: 100 })], [])
    expect(r.positions).toHaveLength(1)
    expect(r.positions[0]).toMatchObject({ ticker: 'ITSA4', qty: 110 })
  })
  test('venda maior que a posição avisa e não vende o excedente', () => {
    const r = replay([t({ id: '1', side: 'C', qty: 10, tradeDate: '2024-01-02' }), t({ id: '2', side: 'V', qty: 15, priceCents: 1000, feesCents: 30, tradeDate: '2024-01-05' })], [])
    expect(r.sales[0]).toMatchObject({ qty: 10, grossCents: 10000, netCents: 9980, alienationCents: 15000 })
    expect(r.warnings).toContainEqual(expect.objectContaining({ kind: 'venda_maior_que_posicao', date: '2024-01-05' }))
    expect(r.positions).toEqual([])
  })
  test('venda sem posição emite Sale com qty 0', () => {
    const r = replay([t({ id: '1', side: 'V', qty: 5, priceCents: 1000 })], [])
    expect(r.sales[0]).toMatchObject({ qty: 0, grossCents: 0, costBasisCents: 0, resultCents: 0, alienationCents: 5000 })
  })
  test('compra e venda no mesmo dia e corretora gera aviso de day trade (uma vez)', () => {
    const r = replay([t({ id: '1' }), t({ id: '2', seq: 2, side: 'V' }), t({ id: '3', seq: 3, side: 'V', qty: 0 })], [])
    expect(r.warnings.filter((w) => w.kind === 'day_trade')).toHaveLength(1)
  })
  test('desdobramento mantém custo total', () => {
    const ev: CorporateEvent = { id: 'e', kind: 'desdobramento', ticker: 'ITSA4', date: '2024-02-01', qtyDelta: 100 }
    const r = replay([t({ id: '1', qty: 100, priceCents: 1000 })], [ev])
    expect(r.positions[0]).toMatchObject({ qty: 200, totalCostCents: 100000 })
  })
  test('grupamento reduz a quantidade e mantém custo', () => {
    const ev: CorporateEvent = { id: 'e', kind: 'grupamento', ticker: 'ITSA4', date: '2024-02-01', qtyDelta: -90 }
    const r = replay([t({ id: '1', qty: 100, priceCents: 1000 })], [ev])
    expect(r.positions[0]).toMatchObject({ qty: 10, totalCostCents: 100000 })
  })
  test('bonificação soma custo atribuído; sem custo avisa', () => {
    const base = [t({ id: '1', qty: 100, priceCents: 1000 })]
    const a = replay(base, [{ id: 'e', kind: 'bonificacao', ticker: 'ITSA4', date: '2024-02-01', qtyDelta: 10, unitCostCents: 500 }])
    expect(a.positions[0]).toMatchObject({ qty: 110, totalCostCents: 105000 })
    const b = replay(base, [{ id: 'e', kind: 'bonificacao', ticker: 'ITSA4', date: '2024-02-01', qtyDelta: 10, unitCostCents: null }])
    expect(b.positions[0]).toMatchObject({ qty: 110, totalCostCents: 100000 })
    expect(b.warnings).toContainEqual(expect.objectContaining({ kind: 'bonificacao_sem_custo' }))
  })
  test('mudança de ticker move a posição e as compras seguintes somam no novo ticker', () => {
    const ev: CorporateEvent = { id: 'e', kind: 'mudanca_ticker', ticker: 'AAAA3', newTicker: 'BBBB3', date: '2024-02-01' }
    const r = replay([t({ id: '1', ticker: 'AAAA3', qty: 10 }), t({ id: '2', ticker: 'BBBB3', qty: 5, tradeDate: '2024-03-01' })], [ev])
    expect(r.positions).toEqual([{ ticker: 'BBBB3', assetType: 'Ação', qty: 15, totalCostCents: 15000 }])
  })
  test('evento do mesmo dia é aplicado antes da venda do dia', () => {
    const ev: CorporateEvent = { id: 'e', kind: 'desdobramento', ticker: 'ITSA4', date: '2024-02-01', qtyDelta: 10 }
    const r = replay([t({ id: '1', qty: 10 }), t({ id: '2', side: 'V', qty: 20, tradeDate: '2024-02-01' })], [ev])
    expect(r.sales[0].qty).toBe(20)
    expect(r.warnings).toEqual([])
  })
  test('no mesmo dia a compra vem antes da venda, mesmo em notas diferentes', () => {
    const r = replay([t({ id: 'v', noteId: 'a', side: 'V', qty: 10 }), t({ id: 'c', noteId: 'z', side: 'C', qty: 10 })], [])
    expect(r.warnings.filter((w) => w.kind === 'venda_maior_que_posicao')).toEqual([])
    expect(r.sales[0].qty).toBe(10)
  })
  test('tipo diferente para o mesmo ticker gera aviso', () => {
    const r = replay([t({ id: '1', ticker: 'HGLG11', assetType: 'FII' }), t({ id: '2', seq: 2, ticker: 'HGLG11', assetType: 'ETF' })], [])
    expect(r.positions[0].assetType).toBe('FII')
    expect(r.warnings.filter((w) => w.kind === 'tipo_inconsistente')).toHaveLength(1)
  })
})
