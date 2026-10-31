import { describe, expect, it } from 'vitest'
import { cdiIndex, closeIndex, portfolioIndex, rentOver } from './rentabilidade'
import type { Dividend, Trade } from './types'

const tr = (side: 'C' | 'V', qty: number, price: number, date: string): Trade =>
  ({ id: date + side, noteId: 'n' + date + side, seq: 1, broker: 'X', tradeDate: date, settleDate: date, side, assetType: 'Ação', ticker: 'AAAA3', qty, priceCents: price, feesCents: 0, irrfCents: 0 })
const closes = (pairs: [string, number][]) => new Map([['AAAA3', new Map(pairs)]])
const months = ['2026-01', '2026-02', '2026-03', '2026-04']

describe('rentabilidade', () => {
  it('só valorização: o índice acompanha o preço', () => {
    const idx = portfolioIndex([tr('C', 10, 1000, '2025-12-10')], [], [], closes([['2026-01', 1000], ['2026-02', 1100], ['2026-03', 1210], ['2026-04', 1210]]), months)
    expect(idx.map(v => v && Math.round(v * 100) / 100)).toEqual([100, 110, 121, 121])
  })
  it('compra no meio do período não conta como ganho (Dietz)', () => {
    const idx = portfolioIndex([tr('C', 10, 1000, '2025-12-10'), tr('C', 10, 1000, '2026-02-15')], [], [], closes([['2026-01', 1000], ['2026-02', 1000], ['2026-03', 1000], ['2026-04', 1000]]), months)
    expect(idx).toEqual([100, 100, 100, 100])
  })
  it('proventos somam no mês em que caem', () => {
    const div: Dividend[] = [{ id: 'd', ticker: 'AAAA3', kind: 'Dividendo', payDate: '2026-02-20', amountCents: 500, broker: null, source: 'b3', sourceKey: null }]
    const idx = portfolioIndex([tr('C', 10, 1000, '2025-12-10')], [], div, closes([['2026-01', 1000], ['2026-02', 1000], ['2026-03', 1000], ['2026-04', 1000]]), months)
    expect(idx[1]).toBeCloseTo(105)
  })
  it('vender tudo no começo do mês dá o retorno da venda, e recomprar depois de zerado não dobra', () => {
    const idx = portfolioIndex([tr('C', 10, 1000, '2025-12-10'), tr('V', 10, 1020, '2026-02-02'), tr('C', 10, 1000, '2026-03-20')], [], [],
      closes([['2026-01', 1000], ['2026-02', 1000], ['2026-03', 1100], ['2026-04', 1100]]), months)
    expect(idx.map(v => v && Math.round(v * 100) / 100)).toEqual([100, 102, 112.2, 112.2])
  })
  it('antes de ter carteira fica vazio; sem preço repete o último conhecido', () => {
    const idx = portfolioIndex([tr('C', 10, 1000, '2026-02-05')], [], [], closes([['2026-02', 1000], ['2026-04', 1200]]), months)
    expect(idx).toEqual([null, 100, 100, 120])
  })
  it('índice de preço e de CDI partem de 100; CDI para no último mês publicado', () => {
    expect(closeIndex(new Map([['2026-01', 2000], ['2026-02', 2200], ['2026-04', 1800]]), months).map(v => v && Math.round(v * 100) / 100)).toEqual([100, 110, 110, 90])
    const cdi = cdiIndex(new Map([['2026-02', 1], ['2026-03', 1]]), months)
    expect(cdi.map(v => v && Math.round(v * 10000) / 10000)).toEqual([100, 101, 102.01, null])
  })
})

describe('rentOver', () => {
  it('último valor de cada índice nos n meses, menos 100, e o CDI do último mês publicado', () => {
    const months = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
    const cdi = new Map(months.slice(0, -1).map(m => [m, 1])) // outubro ainda não publicado
    const ibov = new Map([['2025-10', 100_000], ['2026-10', 110_000]])
    const r = rentOver([], [], [], { closes: new Map(), ibov, cdi }, '2026-10')
    expect(r.carteiraPct).toBeNull()
    expect(r.ibovPct).toBeCloseTo(10)
    expect(r.cdiPct).toBeCloseTo((1.01 ** 11 - 1) * 100) // até o último mês publicado, como na tela
    expect(r.cdiMonthPct).toBe(1)
    expect(rentOver([], [], [], { closes: new Map(), ibov, cdi }, '2026-09', 11).cdiPct).toBeCloseTo((1.01 ** 11 - 1) * 100)
  })
})
