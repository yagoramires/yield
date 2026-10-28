import { replay } from './ledger'
import type { Cents, CorporateEvent, Dividend, Month, Trade } from './types'

/** Último valor conhecido até `m` (meses em ordem de texto 'AAAA-MM'). */
const upTo = (series: Map<Month, number> | undefined, m: Month): number | undefined => {
  let best: Month | undefined
  for (const k of series?.keys() ?? []) if (k <= m && (!best || k > best)) best = k
  return best ? series!.get(best) : undefined
}

/**
 * Índice da carteira de bolsa (base 100 no primeiro mês com posição), mês a mês pelo Dietz modificado:
 * r = (V_fim − V_início − aportes + proventos) / (V_início + aportes/2). Compras e vendas do mês não contam como ganho.
 * `closes` = fechamento mensal por ticker; sem preço no mês vale o último conhecido, e sem nenhum, o preço médio.
 */
export function portfolioIndex(trades: Trade[], events: CorporateEvent[], dividends: Dividend[], closes: Map<string, Map<Month, Cents>>, months: Month[]): (number | null)[] {
  const value = (m: Month) => replay(trades.filter(t => t.tradeDate <= `${m}-31`), events.filter(e => e.date <= `${m}-31`)).positions
    .filter(p => p.qty > 0).reduce((s, p) => s + p.qty * (upTo(closes.get(p.ticker), m) ?? p.totalCostCents / p.qty), 0)
  const flow = (m: Month) => trades.filter(t => t.tradeDate.startsWith(m)).reduce((s, t) => s + (t.side === 'C' ? t.qty * t.priceCents + t.feesCents : -(t.qty * t.priceCents - t.feesCents)), 0)
  const paid = (m: Month) => dividends.filter(d => d.payDate.startsWith(m)).reduce((s, d) => s + d.amountCents, 0)
  const out: (number | null)[] = []
  let prev = 0
  for (const m of months) {
    const v = value(m)
    const last = out[out.length - 1] ?? null
    if (last === null) out.push(v > 0 ? 100 : null)
    else {
      const f = flow(m), denom = prev + f / 2
      out.push(denom > 0 ? last * (1 + (v - prev - f + paid(m)) / denom) : last)
    }
    prev = v
  }
  return out
}

/** Índice de um preço (base 100 no primeiro mês); sem fechamento no mês, repete o último. */
export function closeIndex(closes: Map<Month, number>, months: Month[]): (number | null)[] {
  const base = upTo(closes, months[0]) ?? closes.get([...closes.keys()].sort()[0])
  return months.map(m => { const c = upTo(closes, m); return base && c ? (c / base) * 100 : null })
}

/** Índice do CDI a partir do % acumulado de cada mês; para no primeiro mês ainda não publicado. */
export function cdiIndex(monthlyPct: Map<Month, number>, months: Month[]): (number | null)[] {
  const out: (number | null)[] = [100]
  for (const m of months.slice(1)) {
    const prev = out[out.length - 1], pct = monthlyPct.get(m)
    out.push(prev === null || pct === undefined ? null : prev * (1 + pct / 100))
  }
  return out
}
