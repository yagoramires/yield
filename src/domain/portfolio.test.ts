import { describe, expect, test } from 'vitest'
import type { ManualAsset, Quote } from '../db/repo'
import { buildPortfolio } from './portfolio'
import type { Dividend, Position } from './types'

const pos = (o: Partial<Position> & { ticker: string }): Position => ({ assetType: 'Ação', qty: 100, totalCostCents: 100000, ...o })
const q = (symbol: string, priceCents: number): Quote => ({ symbol, priceCents, fetchedAt: '2026-10-26T17:32:00.000Z', source: 'yahoo' })
const man = (o: Partial<ManualAsset>): ManualAsset => ({ id: 'm1', name: 'BTC', assetClass: 'cripto', quoteSymbol: null, quantity: null, valueCents: null, updatedAt: '2026-10-01', sourceKey: null, ...o })
const div = (payDate: string, amountCents = 100): Dividend => ({ id: payDate, ticker: 'ITSA4', kind: 'Dividendo', payDate, amountCents, broker: null, source: 'manual', sourceKey: null })
const TODAY = '2026-10-26'

describe('buildPortfolio', () => {
  test('posição com cotação: valor, variação e preço médio', () => {
    const p = buildPortfolio([pos({ ticker: 'ITSA4' })], [q('ITSA4.SA', 1200)], [], [], TODAY)
    expect(p.rows[0]).toMatchObject({ avgPriceCents: 1000, costCents: 100000, priceCents: 1200, valueCents: 120000, varCents: 20000, varPct: 0.2, quotedAt: '2026-10-26T17:32:00.000Z' })
    expect(p.totalValueCents).toBe(120000)
  })

  test('sem cotação: campos nulos, em missingQuotes e fora do total', () => {
    const p = buildPortfolio([pos({ ticker: 'ITSA4' }), pos({ ticker: 'HGLG11', assetType: 'FII' })], [q('ITSA4.SA', 1200)], [], [], TODAY)
    expect(p.rows.find(r => r.ticker === 'HGLG11')).toMatchObject({ priceCents: null, valueCents: null, varCents: null, varPct: null })
    expect(p.missingQuotes).toEqual(['HGLG11'])
    expect(p.totalValueCents).toBe(120000)
  })

  test('ativo manual: quantidade × cotação, senão valor informado', () => {
    const p = buildPortfolio([], [q('BTC-BRL', 50_000_000)], [man({ quoteSymbol: 'BTC-BRL', quantity: 0.01, valueCents: 1 }), man({ id: 'm2', name: 'Tesouro', assetClass: 'renda_fixa', valueCents: 2_230_000 })], [], TODAY)
    expect(p.manual.map(m => m.valueCents)).toEqual([500_000, 2_230_000])
    expect(p.totalValueCents).toBe(2_730_000)
    expect(p.byClass).toEqual([{ cls: 'cripto', costCents: null, valueCents: 500_000 }, { cls: 'renda_fixa', costCents: null, valueCents: 2_230_000 }])
  })

  test('byClass: cada classe com o próprio custo e valor', () => {
    const p = buildPortfolio(
      [pos({ ticker: 'ITSA4' }), pos({ ticker: 'AAPL34', assetType: 'BDR', totalCostCents: 50000 })],
      [q('ITSA4.SA', 1200), q('AAPL34.SA', 600)], [], [], TODAY)
    expect(p.byClass).toEqual([{ cls: 'Ação', costCents: 100000, valueCents: 120000 }, { cls: 'BDR', costCents: 50000, valueCents: 60000 }])
  })

  test('proventos 12 meses: 2025-10-27..2026-10-26', () => {
    const p = buildPortfolio([], [], [], [div('2025-10-26'), div('2025-10-27'), div('2026-10-26'), div('2026-10-27')], TODAY)
    expect(p.dividends12mCents).toBe(200)
  })

  test('posição com qty <= 0 é ignorada', () => {
    const p = buildPortfolio([pos({ ticker: 'ITSA4', qty: -5, totalCostCents: 0 })], [q('ITSA4.SA', 1200)], [], [], TODAY)
    expect(p.rows).toEqual([])
  })

  test('assetType indefinido: lista a linha, fora de byClass', () => {
    const p = buildPortfolio([pos({ ticker: 'XPTO3', assetType: undefined as never })], [q('XPTO3.SA', 1200)], [], [], TODAY)
    expect(p.rows).toHaveLength(1)
    expect(p.byClass).toEqual([])
  })
})
