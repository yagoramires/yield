import { describe, expect, it } from 'vitest'
import type { Portfolio } from '../../domain/portfolio'
import type { Dividend, Trade } from '../../domain/types'
import { dividendsByMonth, investedByMonth, topPositions } from './build'

const trade = (o: Partial<Trade>): Trade => ({
  id: 't', noteId: 'n', seq: 1, broker: 'X', tradeDate: '2026-01-10', settleDate: '2026-01-12', side: 'C', assetType: 'Ação',
  ticker: 'AAAA3', qty: 10, priceCents: 1000, feesCents: 0, irrfCents: 0, ...o,
})

describe('investedByMonth', () => {
  it('custo da posição aberta no fim de cada mês; venda reduz pelo preço médio', () => {
    const trades = [
      trade({ id: 'a', noteId: 'n1', tradeDate: '2026-01-10', qty: 10, priceCents: 1000 }),
      trade({ id: 'b', noteId: 'n2', tradeDate: '2026-03-05', side: 'V', qty: 4, priceCents: 1500 }),
    ]
    expect(investedByMonth(trades, [], '2026-04', 4)).toEqual([
      { month: '2026-01', cents: 10_000 }, { month: '2026-02', cents: 10_000 },
      { month: '2026-03', cents: 6_000 }, { month: '2026-04', cents: 6_000 },
    ])
  })
  it('meses antes da primeira compra valem zero', () => {
    expect(investedByMonth([trade({})], [], '2026-02', 3).map(m => m.cents)).toEqual([0, 10_000, 10_000])
  })
})

describe('dividendsByMonth', () => {
  const div = (o: Partial<Dividend>): Dividend => ({ id: 'd', ticker: 'AAAA3', kind: 'Dividendo', payDate: '2026-02-10', amountCents: 100, broker: null, source: 'manual', sourceKey: null, ...o })
  it('separa por tipo e zera meses vazios', () => {
    const r = dividendsByMonth([div({ amountCents: 100 }), div({ kind: 'JCP', amountCents: 50 }), div({ kind: 'Rendimento', payDate: '2026-04-01', amountCents: 70 }), div({ payDate: '2025-12-01' })], '2026-04', 3)
    expect(r).toEqual([
      { month: '2026-02', byKind: { Rendimento: 0, Dividendo: 100, JCP: 50 } },
      { month: '2026-03', byKind: { Rendimento: 0, Dividendo: 0, JCP: 0 } },
      { month: '2026-04', byKind: { Rendimento: 70, Dividendo: 0, JCP: 0 } },
    ])
  })
})

describe('topPositions', () => {
  it('mistura ações e manuais por valor, com % do patrimônio', () => {
    const p = {
      rows: [
        { ticker: 'AAAA3', assetType: 'Ação', valueCents: 30_000, varPct: 0.1 },
        { ticker: 'SEMCOT', assetType: 'FII', valueCents: null, varPct: null },
      ],
      manual: [
        { id: 'm1', name: 'CDB Teste', assetClass: 'renda_fixa', valueCents: 70_000 },
        { id: 'm2', name: 'Sem valor', assetClass: 'outro', valueCents: null },
      ],
      totalValueCents: 100_000,
    } as unknown as Portfolio
    expect(topPositions(p, 5)).toEqual([
      { name: 'CDB Teste', cls: 'Renda fixa', valueCents: 70_000, pct: 0.7, varPct: null, manual: true },
      { name: 'AAAA3', cls: 'Ação', valueCents: 30_000, pct: 0.3, varPct: 0.1, manual: false },
    ])
    expect(topPositions(p, 1)).toHaveLength(1)
  })
})
