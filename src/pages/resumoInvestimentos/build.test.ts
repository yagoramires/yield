import { describe, expect, it } from 'vitest'
import type { Portfolio } from '../../domain/portfolio'
import type { Dividend, Trade } from '../../domain/types'
import { classLabel, dividendsByMonth, investedByMonth, moneyBuckets, passiveCoverage, topPositions } from './build'

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
      { name: 'CDB Teste', cls: 'Renda fixa', clsKey: 'renda_fixa', valueCents: 70_000, pct: 0.7, varPct: null, manual: true },
      { name: 'AAAA3', cls: 'Ação', clsKey: 'Ação', valueCents: 30_000, pct: 0.3, varPct: 0.1, manual: false },
    ])
    expect(topPositions(p, 1)).toHaveLength(1)
  })

  it('inclui títulos de renda fixa abertos e saldos de cripto', () => {
    const p = {
      rows: [], manual: [], totalValueCents: 100_000,
      rf: [
        { name: 'Tesouro Prefixado 2099', closed: false, valueCents: 60_000, gainPct: 0.05 },
        { name: 'CDB Encerrado', closed: true, valueCents: 0, gainPct: 0.1 },
      ],
      crypto: [{ asset: 'BTC', qty: 0.1, valueCents: 40_000, costCents: null }],
    } as unknown as Portfolio
    expect(topPositions(p, 5)).toEqual([
      { name: 'Tesouro Prefixado 2099', cls: 'Renda fixa', clsKey: 'renda_fixa', valueCents: 60_000, pct: 0.6, varPct: 0.05, manual: false },
      { name: 'BTC', cls: 'Cripto', clsKey: 'cripto', valueCents: 40_000, pct: 0.4, varPct: null, manual: false },
    ])
    expect(classLabel('exterior')).toBe('Exterior')
  })
})

describe('passiveCoverage', () => {
  it('média de proventos por mês sobre o gasto médio dos meses que têm gasto', () => {
    expect(passiveCoverage(78000, [400000, 0, 500000, 0, 0, 300000])).toEqual({ pct: 6500 / 400000, avgDividendsCents: 6500, avgSpentCents: 400000, gapCents: 393500 })
    expect(passiveCoverage(600000 * 12, [500000])).toMatchObject({ pct: 1.2, gapCents: 0 })
  })
  it('sem gasto registrado não calcula', () => expect(passiveCoverage(1000, [0, 0])).toBeNull())
})

describe('moneyBuckets', () => {
  const row = (ticker: string, assetType: string, valueCents: number, costCents: number) => ({ ticker, assetType, valueCents, costCents, varCents: valueCents - costCents })
  const p = {
    totalValueCents: 200_000,
    rows: [row('AAAA3', 'Ação', 60_000, 50_000), row('FIIA11', 'FII', 40_000, 40_000), row('ETFX11', 'ETF', 20_000, 22_000)],
    manual: [{ id: 'z', name: 'ZZZZ', assetClass: 'exterior', valueCents: 30_000, costCents: 24_000, usdCents: 5_500, usdCostCents: 5_000 },
      { id: 'd', name: 'Dólar', assetClass: 'dolar', valueCents: 10_000, costCents: null, usdCents: null, usdCostCents: null }],
    rf: [{ key: 'td', closed: false, valueCents: 30_000, investedCents: 27_000, gainCents: 3_000 }, { key: 'x', closed: false, valueCents: 10_000, investedCents: null, gainCents: null }],
    crypto: [],
  } as unknown as Portfolio

  it('bolsa soma as quatro classes; exterior em US$; só blocos com valor; notas', () => {
    const b = moneyBuckets(p, { cryptoAt: null, dollarCents: 542 })
    expect(b.map(x => x.key)).toEqual(['bolsa', 'renda_fixa', 'exterior', 'dolar'])
    expect(b[0]).toMatchObject({ label: 'Bolsa', valueCents: 120_000, pct: 0.6, gainCents: 8_000, note: 'ações, FIIs, ETFs, BDRs' })
    expect(b[0].gainPct).toBeCloseTo(8_000 / 112_000)
    expect(b[1]).toMatchObject({ valueCents: 40_000, gainCents: 3_000, note: '2 títulos' })
    expect(b[2]).toMatchObject({ usdGain: true, gainPct: 0.1, note: 'US$ 55,00' })
    expect(b[3]).toMatchObject({ gainCents: null, gainPct: null, note: 'dólar R$ 5,42' })
  })

  it('outros entra na faixa quando tem valor; plural certo de títulos', () => {
    const q = { ...p, manual: [...(p.manual as never[]), { id: 'o', name: 'Imóvel', assetClass: 'outro', valueCents: 50_000, costCents: null, usdCents: null, usdCostCents: null }], rf: [(p.rf as never[])[0]] } as unknown as Portfolio
    const b = moneyBuckets(q, { cryptoAt: null, dollarCents: null })
    expect(b.find(x => x.key === 'outro')).toMatchObject({ label: 'Outros', valueCents: 50_000 })
    expect(b.find(x => x.key === 'renda_fixa')?.note).toBe('1 título')
  })

  it('cripto da Binance mostra o horário do saldo', () => {
    const c = moneyBuckets({ ...p, crypto: [{ asset: 'BTC', qty: 0.1, valueCents: 5_000, costCents: null }] } as unknown as Portfolio, { cryptoAt: '2026-10-28T17:02:00Z', dollarCents: null })
    expect(c.find(x => x.key === 'cripto')?.note).toMatch(/^Binance, \d{2}:\d{2}$/)
  })
})
