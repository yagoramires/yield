// Lógica pura da tela de Proventos: filtro, agrupamento, totais e validação do lançamento manual.
import { normalizeTicker } from '../../domain/ledger'
import { monthOf } from '../../domain/money'
import type { Cents, Dividend, DividendKind, ISODate, Month } from '../../domain/types'
import { normalizeBroker } from '../../import/parse'
import { parseDate, parseMoney } from '../notas/build'

export const KINDS: DividendKind[] = ['Dividendo', 'JCP', 'Rendimento']
export interface Filter { ticker: string; kind: DividendKind | ''; year: string }
export interface DividendForm { ticker: string; kind: DividendKind; payDate: string; broker: string; amount: string }

export const filterDividends = (list: Dividend[], f: Filter): Dividend[] =>
  list.filter(d => (!f.ticker || d.ticker === f.ticker) && (!f.kind || d.kind === f.kind) && (!f.year || d.payDate.startsWith(f.year)))

export function groupByMonth(list: Dividend[]): { month: Month; totalCents: Cents; items: Dividend[] }[] {
  const by = new Map<Month, Dividend[]>()
  for (const d of list) by.set(monthOf(d.payDate), [...(by.get(monthOf(d.payDate)) ?? []), d])
  return [...by].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([month, items]) => ({
    month,
    totalCents: items.reduce((s, d) => s + d.amountCents, 0),
    items: items.sort((a, b) => (a.payDate === b.payDate ? a.ticker.localeCompare(b.ticker) : a.payDate < b.payDate ? 1 : -1)),
  }))
}

export function totalsByYear(list: Dividend[]): { year: string; totalCents: Cents }[] {
  const by = new Map<string, Cents>()
  for (const d of list) by.set(d.payDate.slice(0, 4), (by.get(d.payDate.slice(0, 4)) ?? 0) + d.amountCents)
  return [...by].map(([year, totalCents]) => ({ year, totalCents })).sort((a, b) => (a.year < b.year ? 1 : -1))
}

export const totalsByKind = (list: Dividend[]): Record<DividendKind, Cents> =>
  list.reduce((t, d) => ({ ...t, [d.kind]: t[d.kind] + d.amountCents }), { Dividendo: 0, JCP: 0, Rendimento: 0 })

export function buildDividend(f: DividendForm): Omit<Dividend, 'id'> {
  const ticker = normalizeTicker(f.ticker)
  if (!ticker) throw new Error('Ticker: informe o ativo.')
  const payDate: ISODate = parseDate(f.payDate, 'Data')
  const amountCents = parseMoney(f.amount, 'Valor')
  return { ticker, kind: f.kind, payDate, amountCents, broker: f.broker.trim() ? normalizeBroker(f.broker) : null, source: 'manual', sourceKey: null }
}
