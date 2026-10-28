import type { ManualAsset, Quote } from '../db/repo'
import type { CryptoBalance } from '../db/rendaFixaRepo'
import type { RfHolding } from './rendaFixa'
import { yahooSymbol } from '../quotes/yahoo'
import type { AssetType, Cents, Dividend, ISODate, Position } from './types'

export interface PortfolioRow { ticker: string; assetType: AssetType; qty: number; avgPriceCents: Cents; costCents: Cents; priceCents: Cents | null; valueCents: Cents | null; varCents: Cents | null; varPct: number | null; quotedAt: string | null }
export interface ManualRow { id: string; name: string; assetClass: ManualAsset['assetClass']; valueCents: Cents | null; usdCents: Cents | null /* só exterior */ }
export interface CryptoRow { asset: string; qty: number; valueCents: Cents | null; costCents: Cents | null }
export interface Portfolio { rows: PortfolioRow[]; manual: ManualRow[]; byClass: { cls: AssetType | ManualAsset['assetClass']; costCents: Cents | null; valueCents: Cents }[]; totalValueCents: Cents; totalCostCents: Cents; dividends12mCents: Cents; missingQuotes: string[]
  rf: RfHolding[]; crypto: CryptoRow[]; rfGainCents: Cents /* títulos abertos com ganho conhecido */; noCostCount: number /* itens com valor e sem aportado */ }

export function buildPortfolio(positions: Position[], quotes: Quote[], manual: ManualAsset[], dividends: Dividend[], today: ISODate,
  extra: { rf: RfHolding[]; crypto: CryptoBalance[] } = { rf: [], crypto: [] }): Portfolio {
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
  const dollar = bySymbol.get('BRL=X')?.priceCents
  const manualRows: ManualRow[] = manual.map(a => {
    const quote = a.quoteSymbol ? bySymbol.get(a.quoteSymbol) : undefined
    if (a.currency === 'USD') {
      const usdCents = quote && a.quantity !== null ? Math.round(a.quantity * quote.priceCents) : null
      return { id: a.id, name: a.name, assetClass: a.assetClass, usdCents, valueCents: usdCents !== null && dollar ? Math.round((usdCents * dollar) / 100) : null }
    }
    const valueCents = quote && a.quantity !== null ? Math.round(a.quantity * quote.priceCents) : a.valueCents
    return { id: a.id, name: a.name, assetClass: a.assetClass, valueCents, usdCents: null }
  })
  const openRf = extra.rf.filter(h => !h.closed && h.valueCents !== null)
  const crypto: CryptoRow[] = extra.crypto.filter(c => c.qty > 0).map(c => {
    const price = c.asset === 'BRL' ? 100 : bySymbol.get(`${c.asset}-BRL`)?.priceCents
    return { asset: c.asset, qty: c.qty, valueCents: price === undefined ? null : Math.round(c.qty * price), costCents: c.costCents }
  })

  // Custo e valor só de quem tem cotação, para a variação da classe fazer sentido.
  const classes = new Map<AssetType | ManualAsset['assetClass'], { costCents: Cents | null; valueCents: Cents }>()
  for (const r of rows) {
    if (r.valueCents === null || !r.assetType) continue
    const c = classes.get(r.assetType) ?? { costCents: 0, valueCents: 0 }
    classes.set(r.assetType, { costCents: (c.costCents ?? 0) + r.costCents, valueCents: c.valueCents + r.valueCents })
  }
  // Fora da renda variável a classe só tem custo se todos os itens dela tiverem.
  const add = (cls: ManualAsset['assetClass'], valueCents: Cents, costCents: Cents | null) => {
    const c = classes.get(cls)
    classes.set(cls, { costCents: c && c.costCents === null ? null : costCents === null ? null : (c?.costCents ?? 0) + costCents, valueCents: (c?.valueCents ?? 0) + valueCents })
  }
  for (const h of openRf) add('renda_fixa', h.valueCents!, h.appliedCents)
  for (const m of manualRows) if (m.valueCents !== null) add(m.assetClass, m.valueCents, null)
  for (const c of crypto) if (c.valueCents !== null) add('cripto', c.valueCents, c.costCents)

  // 365 dias terminando em `today` (inclusive): começa 364 dias antes.
  const start = new Date(Date.parse(`${today}T00:00:00Z`) - 364 * 86_400_000).toISOString().slice(0, 10)
  return {
    rows, manual: manualRows,
    byClass: [...classes].map(([cls, v]) => ({ cls, ...v })),
    totalValueCents: rows.reduce((s, r) => s + (r.valueCents ?? 0), 0) + manualRows.reduce((s, m) => s + (m.valueCents ?? 0), 0)
      + openRf.reduce((s, h) => s + h.valueCents!, 0) + crypto.reduce((s, c) => s + (c.valueCents ?? 0), 0),
    totalCostCents: rows.reduce((s, r) => s + r.costCents, 0) + openRf.reduce((s, h) => s + (h.appliedCents ?? 0), 0) + crypto.reduce((s, c) => s + (c.valueCents === null ? 0 : c.costCents ?? 0), 0),
    rf: extra.rf, crypto,
    rfGainCents: openRf.reduce((s, h) => s + (h.gainCents ?? 0), 0),
    noCostCount: manualRows.filter(m => m.valueCents !== null).length + openRf.filter(h => h.appliedCents === null).length + crypto.filter(c => c.valueCents !== null && c.costCents === null).length,
    dividends12mCents: dividends.filter(d => d.payDate >= start && d.payDate <= today).reduce((s, d) => s + d.amountCents, 0),
    missingQuotes: rows.filter(r => r.valueCents === null).map(r => r.ticker),
  }
}
