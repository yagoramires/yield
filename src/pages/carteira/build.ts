import type { ManualAsset } from '../../db/repo'
import type { Portfolio } from '../../domain/portfolio'
import type { AssetType, Cents } from '../../domain/types'

export type ClassKey = AssetType | ManualAsset['assetClass']
export interface ClassSummary {
  key: ClassKey; label: string; valueCents: Cents; pct: number
  gainCents: Cents | null; gainPct: number | null; usdGain: boolean /* exterior: % sobre o aportado em US$ */
  count: number; missingQuotes: number
}

const LABEL: Record<string, string> = { Ação: 'Ações', FII: 'FIIs', ETF: 'ETFs', BDR: 'BDRs', renda_fixa: 'Renda fixa', exterior: 'Exterior', cripto: 'Cripto', dolar: 'Dólar', outro: 'Outros' }
export const BOLSA: ClassKey[] = ['Ação', 'FII', 'ETF', 'BDR']
export const classTitle = (k: string) => LABEL[k] ?? k

type Item = { value: Cents | null; cost: Cents | null; usd?: Cents | null; usdCost?: Cents | null }

/** Todas as classes da carteira (bolsa, renda fixa, exterior, cripto, dólar…), da maior para a menor. */
export function carteiraClasses(p: Portfolio): ClassSummary[] {
  const items = new Map<ClassKey, Item[]>()
  const push = (k: ClassKey, it: Item) => items.set(k, [...(items.get(k) ?? []), it])
  for (const r of p.rows) if (r.assetType) push(r.assetType, { value: r.valueCents, cost: r.valueCents === null ? null : r.costCents })
  for (const h of p.rf) if (!h.closed) push('renda_fixa', { value: h.valueCents, cost: h.gainCents === null ? null : h.investedCents })
  for (const c of p.crypto) push('cripto', { value: c.valueCents, cost: c.costCents })
  for (const m of p.manual) push(m.assetClass, { value: m.valueCents, cost: m.costCents, usd: m.usdCents, usdCost: m.usdCostCents })

  return [...items].map(([key, list]) => {
    const valueCents = list.reduce((s, i) => s + (i.value ?? 0), 0)
    const known = list.filter(i => i.value !== null && i.cost !== null)
    // renda fixa: o ganho do título já inclui juros e resgates; nas outras, valor − custo
    const gainCents = !known.length ? null : key === 'renda_fixa'
      ? p.rf.filter(h => !h.closed && h.gainCents !== null).reduce((s, h) => s + h.gainCents!, 0)
      : known.reduce((s, i) => s + i.value! - i.cost!, 0)
    const base = known.reduce((s, i) => s + i.cost!, 0)
    const usd = list.filter(i => i.usd != null && i.usdCost != null)
    const usdBase = usd.reduce((s, i) => s + i.usdCost!, 0)
    const gainPct = key === 'exterior' ? (usdBase ? usd.reduce((s, i) => s + i.usd! - i.usdCost!, 0) / usdBase : null) : gainCents === null || !base ? null : gainCents / base
    return {
      key, label: classTitle(key), valueCents, pct: p.totalValueCents > 0 ? valueCents / p.totalValueCents : 0,
      gainCents, gainPct, usdGain: key === 'exterior', count: list.length, missingQuotes: list.filter(i => i.value === null).length,
    }
  }).sort((a, b) => b.valueCents - a.valueCents)
}

/** Classe a abrir: a pedida (se tiver itens); 'bolsa' = a maior da bolsa; senão a maior. */
export function pickClass(list: ClassSummary[], wanted: string | null): ClassKey | null {
  if (wanted === 'bolsa') return list.find(c => BOLSA.includes(c.key))?.key ?? list[0]?.key ?? null
  return list.find(c => c.key === wanted)?.key ?? list[0]?.key ?? null
}
