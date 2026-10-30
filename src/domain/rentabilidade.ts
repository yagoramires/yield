import { replay } from './ledger'
import { addMonths } from './money'
import type { Cents, CorporateEvent, Dividend, Month, Trade } from './types'

/** Último valor conhecido até `m` (meses em ordem de texto 'AAAA-MM'). */
const upTo = (series: Map<Month, number> | undefined, m: Month): number | undefined => {
  let best: Month | undefined
  for (const k of series?.keys() ?? []) if (k <= m && (!best || k > best)) best = k
  return best ? series!.get(best) : undefined
}

/**
 * Índice da carteira de bolsa (base 100 no primeiro mês com posição). Retorno do mês =
 * (valor no fim + vendas + proventos) / (valor no início + compras) − 1: compra e venda não contam como ganho,
 * e vender tudo ou voltar a comprar depois de zerado não distorce o mês.
 * `closes` = fechamento mensal por ticker; sem preço no mês vale o último conhecido, e sem nenhum, o preço médio.
 */
export function portfolioIndex(trades: Trade[], events: CorporateEvent[], dividends: Dividend[], closes: Map<string, Map<Month, Cents>>, months: Month[]): (number | null)[] {
  const value = (m: Month) => replay(trades.filter(t => t.tradeDate <= `${m}-31`), events.filter(e => e.date <= `${m}-31`)).positions
    .filter(p => p.qty > 0).reduce((s, p) => s + p.qty * (upTo(closes.get(p.ticker), m) ?? p.totalCostCents / p.qty), 0)
  const inMonth = (m: Month) => trades.filter(t => t.tradeDate.startsWith(m))
  const bought = (m: Month) => inMonth(m).filter(t => t.side === 'C').reduce((s, t) => s + t.qty * t.priceCents + t.feesCents, 0)
  const sold = (m: Month) => inMonth(m).filter(t => t.side === 'V').reduce((s, t) => s + t.qty * t.priceCents - t.feesCents, 0)
  const paid = (m: Month) => dividends.filter(d => d.payDate.startsWith(m)).reduce((s, d) => s + d.amountCents, 0)
  const out: (number | null)[] = []
  let prev = 0
  for (const m of months) {
    const v = value(m)
    const last = out[out.length - 1] ?? null
    if (last === null) out.push(v > 0 ? 100 : null)
    else {
      const base = prev + bought(m)
      out.push(base > 0 ? last * ((v + sold(m) + paid(m)) / base) : last)
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

const lastKnown = (vs: (number | null)[]) => [...vs].reverse().find((v): v is number => v !== null) ?? null

/**
 * Carteira de bolsa × CDI × Ibovespa nos últimos `n` meses (os mesmos índices da tela de Resumo), em % sobre o começo,
 * e o CDI do último mês publicado. Quem chama tira os ETFs de renda fixa dos trades, como o Resumo.
 */
export function rentOver(trades: Trade[], events: CorporateEvent[], dividends: Dividend[], hist: { closes: Map<string, Map<Month, Cents>>; ibov: Map<Month, Cents>; cdi: Map<Month, number> }, thisMonth: Month, n = 12):
  { carteiraPct: number | null; cdiPct: number | null; ibovPct: number | null; cdiMonthPct: number | null } {
  const months = Array.from({ length: n + 1 }, (_, i) => addMonths(thisMonth, i - n))
  const pct = (vs: (number | null)[]) => { const v = lastKnown(vs); return v === null ? null : v - 100 }
  const lastCdi = [...hist.cdi.keys()].filter(m => m <= thisMonth).sort().at(-1)
  return {
    carteiraPct: pct(portfolioIndex(trades, events, dividends, hist.closes, months)),
    cdiPct: hist.cdi.size ? pct(cdiIndex(hist.cdi, months)) : null,
    ibovPct: hist.ibov.size ? pct(closeIndex(hist.ibov, months)) : null,
    cdiMonthPct: lastCdi ? hist.cdi.get(lastCdi)! : null,
  }
}
