import { describe, expect, it } from 'vitest'
import type { Dividend } from '../../domain/types'
import { buildDividend, filterDividends, groupByMonth, totalsByKind, totalsByYear } from './build'

const d = (id: string, ticker: string, kind: Dividend['kind'], payDate: string, amountCents: number): Dividend =>
  ({ id, ticker, kind, payDate, amountCents, broker: 'CLEAR', source: 'b3', sourceKey: id })
const list = [
  d('1', 'HGLG11', 'Rendimento', '2026-10-14', 27500), d('2', 'ITSA4', 'JCP', '2026-10-01', 14740),
  d('3', 'BBAS3', 'Dividendo', '2026-09-01', 25510), d('4', 'ITSA4', 'Dividendo', '2025-12-10', 1000),
]

describe('filtro', () => {
  it('por ticker, tipo e ano; vazio = todos', () => {
    expect(filterDividends(list, { ticker: '', kind: '', year: '' })).toHaveLength(4)
    expect(filterDividends(list, { ticker: 'ITSA4', kind: '', year: '' }).map(x => x.id)).toEqual(['2', '4'])
    expect(filterDividends(list, { ticker: 'ITSA4', kind: 'JCP', year: '2026' }).map(x => x.id)).toEqual(['2'])
    expect(filterDividends(list, { ticker: '', kind: '', year: '2025' }).map(x => x.id)).toEqual(['4'])
  })
})

describe('agrupamento e totais', () => {
  it('meses do mais novo ao mais antigo, itens por data desc, com total', () => {
    const g = groupByMonth(list)
    expect(g.map(x => [x.month, x.totalCents])).toEqual([['2026-10', 42240], ['2026-09', 25510], ['2025-12', 1000]])
    expect(g[0].items.map(x => x.id)).toEqual(['1', '2'])
  })
  it('total por ano (desc) e por tipo', () => {
    expect(totalsByYear(list)).toEqual([{ year: '2026', totalCents: 67750 }, { year: '2025', totalCents: 1000 }])
    expect(totalsByKind(list)).toEqual({ Dividendo: 26510, JCP: 14740, Rendimento: 27500 })
  })
})

describe('buildDividend', () => {
  const ok = { ticker: ' hglg11 ', kind: 'Rendimento' as const, payDate: '2026-10-14', broker: ' clear ', amount: '1.234,56' }
  it('monta provento manual', () => {
    expect(buildDividend(ok)).toEqual({ ticker: 'HGLG11', kind: 'Rendimento', payDate: '2026-10-14', amountCents: 123456, broker: 'CLEAR', source: 'manual', sourceKey: null })
  })
  it('corretora vazia vira null', () => expect(buildDividend({ ...ok, broker: ' ' }).broker).toBeNull())
  it('rejeita ticker vazio, data inválida e valor ruim', () => {
    expect(() => buildDividend({ ...ok, ticker: ' ' })).toThrow(/Ticker/)
    expect(() => buildDividend({ ...ok, payDate: '2026-02-30' })).toThrow(/Data/)
    for (const amount of ['abc', '', '0', '0,00', '29.05']) expect(() => buildDividend({ ...ok, amount })).toThrow(/Valor/)
  })
})
