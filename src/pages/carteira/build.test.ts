import type { Portfolio } from '../../domain/portfolio'
import { carteiraClasses, pickClass } from './build'

const row = (ticker: string, assetType: string, valueCents: number | null, costCents: number) => ({ ticker, assetType, valueCents, costCents, varCents: valueCents === null ? null : valueCents - costCents })
const man = (id: string, assetClass: string, valueCents: number | null, o: object = {}) => ({ id, name: id, assetClass, valueCents, costCents: null, usdCents: null, usdCostCents: null, ...o })
const P = (o: Partial<Portfolio>): Portfolio => ({ rows: [], manual: [], rf: [], crypto: [], totalValueCents: 0, ...o } as unknown as Portfolio)

const p = P({
  totalValueCents: 100_000,
  rows: [row('AAAA3', 'Ação', 30_000, 25_000), row('BBBB4', 'Ação', 20_000, 22_000), row('FIIA11', 'FII', null, 9_000)] as never,
  manual: [man('Dólar à vista', 'dolar', 10_000), man('ZZZZ', 'exterior', 15_000, { costCents: 12_000, usdCents: 3_000, usdCostCents: 2_400 })] as never,
  rf: [{ key: 'td:x', name: 'Tesouro Prefixado 2099', closed: false, valueCents: 20_000, investedCents: 18_000, gainCents: 2_000 }, { key: 'rf:y', closed: true, valueCents: 0, investedCents: 1_000, gainCents: 100 }] as never,
  crypto: [{ asset: 'BTC', qty: 0.1, valueCents: 5_000, costCents: null }] as never,
})

test('classes por valor, com %, resultado e o que está sem cotação', () => {
  const list = carteiraClasses(p)
  expect(list.map(c => c.key)).toEqual(['Ação', 'renda_fixa', 'exterior', 'dolar', 'cripto', 'FII'])
  expect(list[0]).toMatchObject({ label: 'Ações', valueCents: 50_000, pct: 0.5, gainCents: 3_000, count: 2, missingQuotes: 0 })
  expect(list[0].gainPct).toBeCloseTo(3_000 / 47_000)
  expect(list.find(c => c.key === 'renda_fixa')).toMatchObject({ valueCents: 20_000, gainCents: 2_000, count: 1 })
  expect(list.find(c => c.key === 'exterior')).toMatchObject({ usdGain: true, gainCents: 3_000, gainPct: 0.25 })
  expect(list.find(c => c.key === 'dolar')).toMatchObject({ gainCents: null, gainPct: null })
  expect(list.find(c => c.key === 'FII')).toMatchObject({ valueCents: 0, count: 1, missingQuotes: 1 })
})

test('patrimônio zero não divide por zero', () => {
  expect(carteiraClasses(P({ rows: [row('FIIA11', 'FII', null, 9_000)] as never }))[0].pct).toBe(0)
})

test('classe pedida, bolsa = maior da bolsa, e a maior quando a pedida não existe', () => {
  const list = carteiraClasses(p)
  expect(pickClass(list, 'exterior')).toBe('exterior')
  expect(pickClass(list, 'bolsa')).toBe('Ação')
  expect(pickClass(list, 'BDR')).toBe('Ação')
  expect(pickClass(list, null)).toBe('Ação')
  expect(pickClass([], 'bolsa')).toBeNull()
})
