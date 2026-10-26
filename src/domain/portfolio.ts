import type { ManualAsset, Quote } from '../db/repo'
import { yahooSymbol } from '../quotes/yahoo'
import type { AssetType, Cents, Dividend, ISODate, Position } from './types'

export interface PortfolioRow { ticker: string; assetType: AssetType; qty: number; avgPriceCents: Cents; costCents: Cents; priceCents: Cents | null; valueCents: Cents | null; varCents: Cents | null; varPct: number | null; quotedAt: string | null }
export interface ManualRow { id: string; name: string; assetClass: ManualAsset['assetClass']; valueCents: Cents | null }
export interface Portfolio { rows: PortfolioRow[]; manual: ManualRow[]; byClass: { cls: AssetType | ManualAsset['assetClass']; costCents: Cents | null; valueCents: Cents }[]; totalValueCents: Cents; totalCostCents: Cents; dividends12mCents: Cents; missingQuotes: string[] }

export function buildPortfolio(positions: Position[], quotes: Quote[], manual: ManualAsset[], dividends: Dividend[], today: ISODate): Portfolio {
  const bySymbol = new Map(quotes.map(x => [x.symbol, x]))
  const rows: PortfolioRow[] = positions.filter(p => p.qty > 0).map(p => {
    const quote = bySymbol.get(yahooSymbol(p.ticker))
    const valueCents = quote ? Math.round(p.qty * quote.priceCents) : null
    const varCents = valueCents === null ? null : valueCents - p.totalCostCents
    return {
      ticker: p.ticker, assetType: p.assetType, qty: p.qty, avgPriceCents: Math.round(p.totalCostCents / p.qty), costCents: p.totalCostCents,
      priceCents: quote?.priceCents ?? null, valueCents, varCents, varPct: varCents === null || p.totalCostCents === 0 ? null : varCents / p.totalCostCents,
      quotedAt: quote?.fetchedAt ?? null,
    }
  })
  const manualRows: ManualRow[] = manual.map(a => {
    const quote = a.quoteSymbol ? bySymbol.get(a.quoteSymbol) : undefined
    const valueCents = quote && a.quantity !== null ? Math.round(a.quantity * quote.priceCents) : a.valueCents
    return { id: a.id, name: a.name, assetClass: a.assetClass, valueCents }
  })

  // Custo e valor só de quem tem cotação, para a variação da classe fazer sentido.
  const classes = new Map<AssetType | ManualAsset['assetClass'], { costCents: Cents | null; valueCents: Cents }>()
  for (const r of rows) {
    if (r.valueCents === null || !r.assetType) continue
    const c = classes.get(r.assetType) ?? { costCents: 0, valueCents: 0 }
    classes.set(r.assetType, { costCents: (c.costCents ?? 0) + r.costCents, valueCents: c.valueCents + r.valueCents })
  }
  for (const m of manualRows) {
    if (m.valueCents === null) continue
    classes.set(m.assetClass, { costCents: null, valueCents: (classes.get(m.assetClass)?.valueCents ?? 0) + m.valueCents })
  }

  // 365 dias terminando em `today` (inclusive): começa 364 dias antes.
  const start = new Date(Date.parse(`${today}T00:00:00Z`) - 364 * 86_400_000).toISOString().slice(0, 10)
  return {
    rows, manual: manualRows,
    byClass: [...classes].map(([cls, v]) => ({ cls, ...v })),
    totalValueCents: rows.reduce((s, r) => s + (r.valueCents ?? 0), 0) + manualRows.reduce((s, m) => s + (m.valueCents ?? 0), 0),
    totalCostCents: rows.reduce((s, r) => s + r.costCents, 0),
    dividends12mCents: dividends.filter(d => d.payDate >= start && d.payDate <= today).reduce((s, d) => s + d.amountCents, 0),
    missingQuotes: rows.filter(r => r.valueCents === null).map(r => r.ticker),
  }
}
