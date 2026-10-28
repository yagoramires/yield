import { monthOf, monthsBetween } from './money'
import type { Cents, Month, Sale, Warning } from './types'

export interface PotMonth {
  resultCents: Cents; exemptProfitCents: Cents; lossInCents: Cents /* ≤ 0, vindo do mês anterior */
  baseCents: Cents; taxDueCents: Cents; irrfMonthCents: Cents; irrfUsedCents: Cents
  irrfCarryOutCents: Cents; lossOutCents: Cents /* ≤ 0 */; taxPayableCents: Cents
}
export interface TaxMonth { month: Month; stockSalesCents: Cents; comum: PotMonth; fii: PotMonth; incomplete: boolean }

const EXEMPT_LIMIT_CENTS = 2_000_000

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

function potMonth(
  result: Cents, exempt: Cents, irrfMonth: Cents, ratePct: number, prev: PotMonth | undefined, january: boolean,
): PotMonth {
  const lossIn = prev?.lossOutCents ?? 0
  const net = result - exempt + lossIn
  const base = Math.max(net, 0)
  const taxDue = Math.floor((base * ratePct) / 100)
  const available = irrfMonth + (january ? 0 : (prev?.irrfCarryOutCents ?? 0))
  const irrfUsed = Math.min(available, taxDue)
  return {
    resultCents: result, exemptProfitCents: exempt, lossInCents: lossIn, baseCents: base, taxDueCents: taxDue,
    irrfMonthCents: irrfMonth, irrfUsedCents: irrfUsed, irrfCarryOutCents: available - irrfUsed,
    lossOutCents: Math.min(net, 0), taxPayableCents: taxDue - irrfUsed,
  }
}

export function computeTax(sales: Sale[], warnings: Warning[], from: Month, to: Month): TaxMonth[] {
  const out: TaxMonth[] = []
  for (const month of monthsBetween(from, to)) {
    const prev = out[out.length - 1]
    // ETF de renda fixa: o imposto é retido na fonte (tabela regressiva), não entra no DARF
    const sold = sales.filter((x) => monthOf(x.tradeDate) === month && x.assetType !== 'ETF RF')
    const settled = sales.filter((x) => monthOf(x.settleDate) === month && x.assetType !== 'ETF RF')
    const comum = (x: Sale) => x.assetType !== 'FII'
    const acoes = sold.filter((x) => x.assetType === 'Ação')
    const stockSalesCents = sum(acoes.map((x) => x.alienationCents))
    const acaoResult = sum(acoes.map((x) => x.resultCents))
    const exempt = stockSalesCents <= EXEMPT_LIMIT_CENTS && acaoResult > 0 ? acaoResult : 0
    const january = month.endsWith('-01')
    out.push({
      month,
      stockSalesCents,
      comum: potMonth(sum(sold.filter(comum).map((x) => x.resultCents)), exempt, sum(settled.filter(comum).map((x) => x.irrfCents)), 15, prev?.comum, january),
      fii: potMonth(sum(sold.filter((x) => !comum(x)).map((x) => x.resultCents)), 0, sum(settled.filter((x) => !comum(x)).map((x) => x.irrfCents)), 20, prev?.fii, january),
      incomplete: warnings.some((w) => w.kind === 'venda_maior_que_posicao' && monthOf(w.date) === month),
    })
  }
  return out
}
