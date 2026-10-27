import { describe, expect, it } from 'vitest'
import type { Dividend } from '../../domain/types'
import { buildDividend, byTicker, filterDividends, groupByMonth, summary, totalsByKind, totalsByYear, yearTable, yieldOnCost } from './build'

const d = (id: string, ticker: string, kind: Dividend['kind'], payDate: string, amountCents: number): Dividend =>
  ({ id, ticker, kind, payDate, amountCents, broker: 'CLEAR', source: 'b3', sourceKey: id })
const list = [
  d('1', 'HGLG11', 'Rendimento', '2026-10-14', 27500), d('2', 'ITSA4', 'JCP', '2026-10-01', 14740),
  d('3', 'BBAS3', 'Dividendo', '2026-09-01', 25510), d('4', 'ITSA4', 'Dividendo', '2025-12-10', 1000),
]

describe('filtro', () => {
  it('por ticker, tipo e mês; vazio = todos', () => {
    expect(filterDividends(list, { ticker: '', kind: '', month: '' })).toHaveLength(4)
    expect(filterDividends(list, { ticker: 'ITSA4', kind: '', month: '' }).map(x => x.id)).toEqual(['2', '4'])
    expect(filterDividends(list, { ticker: 'ITSA4', kind: 'JCP', month: '' }).map(x => x.id)).toEqual(['2'])
    expect(filterDividends(list, { ticker: '', kind: '', month: '2025-12' }).map(x => x.id)).toEqual(['4'])
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

describe('resumo de proventos', () => {
  const d = (ticker: string, payDate: string, amountCents: number): Dividend => ({ id: `${ticker}${payDate}`, ticker, kind: 'Rendimento', payDate, amountCents, broker: null, source: 'b3', sourceKey: null })
  const list = [d('AAAA11', '2025-10-31', 9999), d('AAAA11', '2025-11-14', 1000), d('BBBB11', '2026-03-10', 3000), d('AAAA11', '2026-10-20', 2000), d('CCCC3', '2025-02-01', 500), d('CCCC3', '2026-10-28', 700)]
  it('12 meses contam do mês de 11 meses atrás até hoje; ano até hoje contra o mesmo período do ano passado', () => {
    const s = summary(list, '2026-10-27')
    expect(s.last12Cents).toBe(6000)
    expect(s.avg12Cents).toBe(500)
    expect([s.ytdCents, s.ytdPrevCents]).toEqual([5000, 500])
    expect(s.top).toEqual({ ticker: 'AAAA11', totalCents: 3000 })
  })
  it('byTicker ordena do maior para o menor', () => {
    expect(byTicker(list).map(t => t.ticker)).toEqual(['AAAA11', 'BBBB11', 'CCCC3'])
  })
  it('rendimento sobre o custo só com quem está na carteira', () => {
    const y = yieldOnCost(summary(list, '2026-10-27').last12, [{ ticker: 'AAAA11', costCents: 30000 }, { ticker: 'DDDD3', costCents: 10000 }])
    expect(y.byTicker.get('AAAA11')).toBeCloseTo(0.1)
    expect(y.byTicker.get('DDDD3')).toBe(0)
    expect(y.total).toBeCloseTo(3000 / 40000)
    expect(yieldOnCost([], []).total).toBeNull()
  })
  it('yearTable calcula o crescimento sobre o ano anterior', () => {
    expect(yearTable(list)).toEqual([{ year: '2026', totalCents: 5700, growth: 5700 / 11499 - 1 }, { year: '2025', totalCents: 11499, growth: null }])
  })
})
