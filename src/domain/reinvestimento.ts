import type { Cents, Dividend, ISODate, Trade } from './types'

/**
 * Caixinha de proventos: cada provento pago entra nela e cada compra usa primeiro o que tem lá; só o resto saiu do bolso.
 * Provento e compra no mesmo dia: o provento entra antes. Devolve o total reinvestido e os proventos recebidos até `until`.
 */
export function reinvested(trades: Trade[], dividends: Dividend[], until: ISODate): { reinvestedCents: Cents; dividendsCents: Cents } {
  const events = [
    ...dividends.filter(d => d.payDate <= until).map(d => ({ date: d.payDate, order: 0, cents: d.amountCents })),
    ...trades.filter(t => t.side === 'C' && t.tradeDate <= until).map(t => ({ date: t.tradeDate, order: 1, cents: -(t.qty * t.priceCents + t.feesCents) })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)
  let pool = 0, reinvestedCents = 0, dividendsCents = 0
  for (const e of events) {
    if (e.cents > 0) { pool += e.cents; dividendsCents += e.cents; continue }
    const use = Math.min(pool, -e.cents)
    pool -= use; reinvestedCents += use
  }
  return { reinvestedCents: Math.round(reinvestedCents), dividendsCents }
}
