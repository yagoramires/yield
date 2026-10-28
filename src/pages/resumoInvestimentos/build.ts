import { addMonths, monthOf } from '../../domain/money'
import { replay } from '../../domain/ledger'
import type { Portfolio } from '../../domain/portfolio'
import type { Cents, CorporateEvent, Dividend, DividendKind, Month, Trade } from '../../domain/types'
import { BOLSA, carteiraClasses } from '../carteira/build'

const CLASS_LABEL: Record<string, string> = { renda_fixa: 'Renda fixa', cripto: 'Cripto', dolar: 'Dólar', exterior: 'Exterior', outro: 'Outros' }
export const classLabel = (c: string) => CLASS_LABEL[c] ?? c
// Cor fixa por classe (barra empilhada, bolinhas e o quadradinho do ticker), igual no Resumo e na Declaração.
const CLASS_COLOR: Record<string, string> = { Ação: '#5fb3ff', FII: '#c79bff', ETF: '#f5d76e', BDR: '#ff9f5a', renda_fixa: '#4fd1a5', cripto: '#ff8fd0', dolar: '#6fdc8c', exterior: '#7fd3e6', outro: '#9a9da6' }
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

/** `cls` é o rótulo mostrado; `clsKey` a chave da cor. */
export function topPositions(p: Portfolio, n: number): { name: string; cls: string; clsKey: string; valueCents: Cents; pct: number; varPct: number | null; manual: boolean }[] {
  const pct = (v: Cents) => (p.totalValueCents > 0 ? v / p.totalValueCents : 0)
  return [
    ...p.rows.flatMap(r => (r.valueCents === null ? [] : [{ name: r.ticker, cls: r.assetType as string, clsKey: r.assetType as string, valueCents: r.valueCents, pct: pct(r.valueCents), varPct: r.varPct, manual: false }])),
    ...p.manual.flatMap(m => (m.valueCents === null ? [] : [{ name: m.name, cls: classLabel(m.assetClass), clsKey: m.assetClass, valueCents: m.valueCents, pct: pct(m.valueCents), varPct: m.costCents ? (m.valueCents - m.costCents) / m.costCents : null, manual: true }])),
    ...(p.rf ?? []).flatMap(h => (h.closed || h.valueCents === null ? [] : [{ name: h.name, cls: classLabel('renda_fixa'), clsKey: 'renda_fixa', valueCents: h.valueCents, pct: pct(h.valueCents), varPct: h.gainPct, manual: false }])),
    ...(p.crypto ?? []).flatMap(c => (c.valueCents === null ? [] : [{ name: c.asset, cls: classLabel('cripto'), clsKey: 'cripto', valueCents: c.valueCents, pct: pct(c.valueCents), varPct: c.costCents ? (c.valueCents - c.costCents) / c.costCents : null, manual: false }])),
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

export type BucketKey = 'bolsa' | 'renda_fixa' | 'exterior' | 'cripto' | 'dolar' | 'outro'
export interface MoneyBucket { key: BucketKey; label: string; valueCents: Cents; pct: number; gainCents: Cents | null; gainPct: number | null; usdGain: boolean; note: string }

/** "Onde está seu dinheiro": bolsa (ações, FIIs, ETFs, BDRs), renda fixa, exterior, cripto e dólar; só os que têm valor. */
export function moneyBuckets(p: Portfolio, ctx: { cryptoAt: string | null; dollarCents: Cents | null }): MoneyBucket[] {
  const classes = carteiraClasses(p)
  const of = (keys: string[]) => classes.filter(c => keys.includes(c.key))
  const hhmm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
  const money = (c: Cents) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const notes: Record<BucketKey, string> = {
    bolsa: 'ações, FIIs, ETFs, BDRs',
    renda_fixa: ((n: number) => `${n} ${n === 1 ? 'título' : 'títulos'}`)(of(['renda_fixa'])[0]?.count ?? 0),
    exterior: `US$ ${money(p.manual.reduce((s, m) => s + (m.usdCents ?? 0), 0))}`,
    cripto: ctx.cryptoAt ? `Binance, ${hhmm(ctx.cryptoAt)}` : 'informado à mão',
    dolar: ctx.dollarCents ? `dólar R$ ${money(ctx.dollarCents)}` : 'sem cotação do dólar',
    outro: 'ativos manuais',
  }
  const parts: [BucketKey, string, string[]][] = [['bolsa', 'Bolsa', BOLSA], ['renda_fixa', 'Renda fixa', ['renda_fixa']], ['exterior', 'Exterior', ['exterior']], ['cripto', 'Cripto', ['cripto']], ['dolar', 'Dólar', ['dolar']], ['outro', 'Outros', ['outro']]]
  return parts.map(([key, label, keys]) => {
    const list = of(keys)
    const valueCents = list.reduce((s, c) => s + c.valueCents, 0)
    const known = list.filter(c => c.gainCents !== null)
    const gainCents = known.length ? known.reduce((s, c) => s + c.gainCents!, 0) : null
    const base = known.reduce((s, c) => s + (c.costCents ?? 0), 0)
    const gainPct = key === 'exterior' ? list[0]?.gainPct ?? null : gainCents === null || !base ? null : gainCents / base
    return { key, label, valueCents, pct: p.totalValueCents > 0 ? valueCents / p.totalValueCents : 0, gainCents, gainPct, usdGain: key === 'exterior', note: notes[key] }
  }).filter(b => b.valueCents > 0)
}
