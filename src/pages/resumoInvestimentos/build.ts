import { addMonths, monthOf } from '../../domain/money'
import { replay } from '../../domain/ledger'
import type { Portfolio } from '../../domain/portfolio'
import type { Cents, CorporateEvent, Dividend, DividendKind, Month, Trade } from '../../domain/types'

const CLASS_LABEL: Record<string, string> = { renda_fixa: 'Renda fixa', cripto: 'Cripto', dolar: 'Dólar', outro: 'Outros' }
export const classLabel = (c: string) => CLASS_LABEL[c] ?? c
// Cor fixa por classe (barra empilhada, bolinhas e o quadradinho do ticker), igual no Resumo e na Declaração.
const CLASS_COLOR: Record<string, string> = { Ação: '#5fb3ff', FII: '#c79bff', ETF: '#f5d76e', BDR: '#ff9f5a', renda_fixa: '#4fd1a5', cripto: '#ff8fd0', dolar: '#6fdc8c', outro: '#9a9da6' }
export const classColor = (c: string) => CLASS_COLOR[c] ?? '#9a9da6'

const lastN = (lastMonth: Month, n: number) => Array.from({ length: n }, (_, i) => addMonths(lastMonth, i - n + 1))

/** Custo da posição aberta no fim de cada mês (replay até o último dia). Ativos manuais não têm histórico. */
export function investedByMonth(trades: Trade[], events: CorporateEvent[], lastMonth: Month, n: number): { month: Month; cents: Cents }[] {
  return lastN(lastMonth, n).map(month => {
    // "-31" serve de limite mesmo em meses curtos: a comparação é de texto.
    const end = `${month}-31`
    const r = replay(trades.filter(t => t.tradeDate <= end), events.filter(e => e.date <= end))
    return { month, cents: r.positions.filter(p => p.qty > 0).reduce((s, p) => s + p.totalCostCents, 0) }
  })
}

export function dividendsByMonth(dividends: Dividend[], lastMonth: Month, n: number): { month: Month; byKind: Record<DividendKind, Cents> }[] {
  const out = lastN(lastMonth, n).map(month => ({ month, byKind: { Rendimento: 0, Dividendo: 0, JCP: 0 } as Record<DividendKind, Cents> }))
  for (const d of dividends) {
    const m = out.find(x => x.month === monthOf(d.payDate))
    if (m) m.byKind[d.kind] += d.amountCents
  }
  return out
}

export function topPositions(p: Portfolio, n: number): { name: string; cls: string; valueCents: Cents; pct: number; varPct: number | null; manual: boolean }[] {
  const pct = (v: Cents) => (p.totalValueCents > 0 ? v / p.totalValueCents : 0)
  return [
    ...p.rows.flatMap(r => (r.valueCents === null ? [] : [{ name: r.ticker, cls: r.assetType as string, valueCents: r.valueCents, pct: pct(r.valueCents), varPct: r.varPct, manual: false }])),
    ...p.manual.flatMap(m => (m.valueCents === null ? [] : [{ name: m.name, cls: classLabel(m.assetClass), valueCents: m.valueCents, pct: pct(m.valueCents), varPct: null, manual: true }])),
  ].sort((a, b) => b.valueCents - a.valueCents).slice(0, n)
}

/** Quanto os proventos (média mensal dos últimos 12 meses) cobrem do gasto médio dos meses que têm gasto. */
export function passiveCoverage(dividends12mCents: Cents, monthlySpentCents: Cents[]): { pct: number; avgDividendsCents: Cents; avgSpentCents: Cents; gapCents: Cents } | null {
  const months = monthlySpentCents.filter(c => c > 0)
  if (!months.length) return null
  const avgSpentCents = Math.round(months.reduce((s, c) => s + c, 0) / months.length)
  const avgDividendsCents = Math.round(dividends12mCents / 12)
  return { pct: avgDividendsCents / avgSpentCents, avgDividendsCents, avgSpentCents, gapCents: Math.max(0, avgSpentCents - avgDividendsCents) }
}
