import { expect, it } from 'vitest'
import { reinvested } from './reinvestimento'
import type { Dividend, Trade } from './types'

const buy = (tradeDate: string, cents: number, side: 'C' | 'V' = 'C'): Trade => ({ id: tradeDate, noteId: 'n', seq: 1, broker: 'Corretora Azul', tradeDate, settleDate: tradeDate, side, assetType: 'FII', ticker: 'AAAA11', qty: 1, priceCents: cents, feesCents: 0, irrfCents: 0 })
const div = (payDate: string, amountCents: number): Dividend => ({ id: payDate, ticker: 'AAAA11', kind: 'Rendimento', payDate, amountCents, broker: null, source: 'manual', sourceKey: null })

it('compra usa primeiro os proventos guardados; o resto é do bolso; sobra fica para a próxima compra; venda não mexe', () => {
  const trades = [buy('2026-01-10', 480_000), buy('2026-02-10', 100_000), buy('2026-03-10', 50_000, 'V')]
  const divs = [div('2026-01-10', 80_000), div('2026-01-20', 30_000), div('2026-02-05', 20_000), div('2026-04-01', 9_999)]
  expect(reinvested(trades, divs, '2026-01-31')).toEqual({ reinvestedCents: 80_000, dividendsCents: 110_000 }) // 800 do mesmo dia entram antes; 300 ficam guardados
  expect(reinvested(trades, divs, '2026-03-31')).toEqual({ reinvestedCents: 130_000, dividendsCents: 130_000 })
})
