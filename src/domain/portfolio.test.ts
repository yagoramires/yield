import { describe, expect, test } from 'vitest'
import type { ManualAsset, Quote } from '../db/repo'
import type { RfHolding } from './rendaFixa'
import { buildPortfolio, portfolioResult } from './portfolio'
import type { Dividend, Position } from './types'

const pos = (o: Partial<Position> & { ticker: string }): Position => ({ assetType: 'Ação', qty: 100, totalCostCents: 100000, ...o })
const q = (symbol: string, priceCents: number): Quote => ({ symbol, priceCents, fetchedAt: '2026-10-26T17:32:00.000Z', source: 'yahoo' })
const man = (o: Partial<ManualAsset>): ManualAsset => ({ id: 'm1', name: 'BTC', assetClass: 'cripto', currency: 'BRL', costCents: null, quoteSymbol: null, quantity: null, valueCents: null, updatedAt: '2026-10-01', sourceKey: null, ...o })
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

describe('buildPortfolio com renda fixa, exterior e cripto', () => {
  const rf = (o: Partial<RfHolding>): RfHolding => ({ key: 'td:x', name: 'Tesouro Prefixado 2099', issuer: null, indexer: 'Prefixado', maturity: '2099-01-01', qty: 1, appliedCents: 100000, investedCents: 100000, receivedCents: 0, valueCents: 110000, gainCents: 10000, gainPct: 0.1, closed: false, asOf: TODAY, needsNewerPosicao: false, ...o })
  const usd = man({ id: 'u1', name: 'ZZZZ', assetClass: 'exterior', currency: 'USD', quoteSymbol: 'ZZZZ', quantity: 2 })

  test('exterior: quantidade × cotação em US$ × dólar', () => {
    const p = buildPortfolio([], [q('ZZZZ', 5000), q('BRL=X', 500)], [usd], [], TODAY)
    expect(p.manual[0]).toMatchObject({ valueCents: 50000, usdCents: 10000 })
    expect(p.byClass).toEqual([{ cls: 'exterior', costCents: null, valueCents: 50000 }])
  })

  test('exterior com aportado em US$: rendimento em dólar e aportado pelo dólar de hoje', () => {
    const p = buildPortfolio([], [q('ZZZZ', 5000), q('BRL=X', 500)], [{ ...usd, costCents: 8000 }], [], TODAY)
    expect(p.manual[0]).toMatchObject({ valueCents: 50000, usdCents: 10000, usdCostCents: 8000, costCents: 40000 })
    expect(p.byClass).toEqual([{ cls: 'exterior', costCents: 40000, valueCents: 50000 }])
    expect(p.totalCostCents).toBe(40000)
    expect(p.otherGainCents).toBe(10000)
    expect(p.otherCostCents).toBe(40000)
    expect(p.noCostCount).toBe(0)
  })

  test('exterior sem dólar do dia fica sem valor e fora do total', () => {
    const p = buildPortfolio([], [q('ZZZZ', 5000)], [usd], [], TODAY)
    expect(p.manual[0].valueCents).toBeNull()
    expect(p.totalValueCents).toBe(0)
  })

  test('cripto em US$ sem cotação usa o valor informado em R$, como o ativo em real', () => {
    const btc = man({ id: 'c1', currency: 'USD', quoteSymbol: 'BTC-USD', quantity: 0.02, valueCents: 300_000 })
    const p = buildPortfolio([], [], [btc], [], TODAY)
    expect(p.manual[0]).toMatchObject({ valueCents: 300_000, usdCents: null })
    expect(p.totalValueCents).toBe(300_000)
    // com cotação, a quantidade manda: 0,02 × US$ 60.000 × R$ 5
    expect(buildPortfolio([], [q('BTC-USD', 6_000_000), q('BRL=X', 500)], [btc], [], TODAY).manual[0].valueCents).toBe(600_000)
  })

  test('título aberto entra no total, no aportado e no resultado; encerrado não', () => {
    const p = buildPortfolio([], [], [], [], TODAY, { rf: [rf({}), rf({ key: 'rf:fim', closed: true, valueCents: 0, appliedCents: 0, gainCents: 500 })], crypto: [] })
    expect(p.totalValueCents).toBe(110000)
    expect(p.totalCostCents).toBe(100000)
    expect(p.otherGainCents).toBe(10000)
    expect(p.otherCostCents).toBe(100000)
    expect(p.byClass).toEqual([{ cls: 'renda_fixa', costCents: 100000, valueCents: 110000 }])
    expect(p.noCostCount).toBe(0)
  })

  test('título sem aplicado conhecido: no total, fora do aportado, conta como sem aportado', () => {
    const p = buildPortfolio([], [], [], [], TODAY, { rf: [rf({ appliedCents: null, investedCents: null, gainCents: null, gainPct: null })], crypto: [] })
    expect(p.totalValueCents).toBe(110000)
    expect(p.totalCostCents).toBe(0)
    expect(p.noCostCount).toBe(1)
    expect(p.byClass[0].costCents).toBeNull()
  })

  // o Yahoo não tem mais os pares em real (BTC-BRL dá 404): cotação em dólar × BRL=X
  test('cripto: quantidade × cotação em US$ × dólar; BRL vale a própria quantidade', () => {
    const p = buildPortfolio([], [q('BTC-USD', 6_000_000), q('BRL=X', 500)], [], [], TODAY, { rf: [], crypto: [
      { asset: 'BTC', qty: 0.5, costCents: 10_000_000, costManual: 0, costPartial: 0, fetchedAt: 'x' }, { asset: 'BRL', qty: 100, costCents: null, costManual: 0, costPartial: 0, fetchedAt: 'x' }, { asset: 'ETH', qty: 0, costCents: null, costManual: 0, costPartial: 0, fetchedAt: 'x' }] })
    expect(p.crypto).toEqual([{ asset: 'BTC', qty: 0.5, valueCents: 15_000_000, costCents: 10_000_000 }, { asset: 'BRL', qty: 100, valueCents: 10000, costCents: null }])
    expect(p.totalValueCents).toBe(15_010_000)
    expect(p.totalCostCents).toBe(10_000_000)
    expect(p.noCostCount).toBe(1)
    expect(p.otherGainCents).toBe(5_000_000)
    expect(p.otherCostCents).toBe(10_000_000)
  })
})

describe('portfolioResult', () => {
  test('renda variável cotada + renda fixa, exterior e cripto com aportado', () => {
    const p = buildPortfolio([pos({ ticker: 'AAAA3', qty: 10, totalCostCents: 1000 }), pos({ ticker: 'SEMCOT3' })], [q('AAAA3.SA', 120)], [], [], TODAY)
    expect(portfolioResult({ ...p, otherGainCents: 100, otherCostCents: 500 })).toEqual({ gainCents: 300, baseCents: 1500 })
  })
})
