// Lógica pura da tela de Proventos: filtro, agrupamento, totais e validação do lançamento manual.
import { normalizeTicker } from '../../domain/ledger'
import { addMonths, monthOf } from '../../domain/money'
import type { Cents, Dividend, DividendKind, ISODate, Month } from '../../domain/types'
import { normalizeBroker } from '../../import/parse'
import { parseDate, parseMoney } from '../notas/build'

export const KINDS: DividendKind[] = ['Dividendo', 'JCP', 'Rendimento']
export interface Filter { ticker: string; kind: DividendKind | ''; month: Month | '' }
export interface DividendForm { ticker: string; kind: DividendKind; payDate: string; broker: string; amount: string }

export const filterDividends = (list: Dividend[], f: Filter): Dividend[] =>
  list.filter(d => (!f.ticker || d.ticker === f.ticker) && (!f.kind || d.kind === f.kind) && (!f.month || d.payDate.startsWith(f.month)))

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

const sum = (list: Dividend[]) => list.reduce((s, d) => s + d.amountCents, 0)

/** Últimos 12 meses (o mês atual conta, até hoje) e o ano até hoje contra o mesmo período do ano passado. */
export function summary(list: Dividend[], today: ISODate) {
  const from12 = `${addMonths(monthOf(today), -11)}-01`
  const last12 = list.filter(d => d.payDate >= from12 && d.payDate <= today)
  const year = today.slice(0, 4), prevYear = String(Number(year) - 1)
  const ytdCents = sum(list.filter(d => d.payDate >= `${year}-01-01` && d.payDate <= today))
  const ytdPrevCents = sum(list.filter(d => d.payDate >= `${prevYear}-01-01` && d.payDate <= `${prevYear}${today.slice(4)}`))
  const top = byTicker(last12)[0] ?? null
  return { last12, last12Cents: sum(last12), avg12Cents: Math.round(sum(last12) / 12), year, ytdCents, ytdPrevCents, top }
}

/** Total por ativo, do maior para o menor. */
export function byTicker(list: Dividend[]): { ticker: string; totalCents: Cents }[] {
  const by = new Map<string, Cents>()
  for (const d of list) by.set(d.ticker, (by.get(d.ticker) ?? 0) + d.amountCents)
  return [...by].map(([ticker, totalCents]) => ({ ticker, totalCents })).sort((a, b) => b.totalCents - a.totalCents || a.ticker.localeCompare(b.ticker))
}

/**
 * Rendimento sobre o custo: proventos dos últimos 12 meses ÷ custo da posição atual, por ativo e no total.
 * Só entra quem ainda está na carteira (provento de ativo vendido não tem custo para comparar).
 */
export function yieldOnCost(last12: Dividend[], positions: { ticker: string; costCents: Cents }[]): { byTicker: Map<string, number>; total: number | null } {
  const paid = new Map(byTicker(last12).map(t => [t.ticker, t.totalCents]))
  const held = positions.filter(p => p.costCents > 0)
  const byT = new Map(held.map(p => [p.ticker, (paid.get(p.ticker) ?? 0) / p.costCents]))
  const cost = held.reduce((s, p) => s + p.costCents, 0)
  return { byTicker: byT, total: cost ? held.reduce((s, p) => s + (paid.get(p.ticker) ?? 0), 0) / cost : null }
}

/** Total de cada ano (mais recente primeiro) e o crescimento sobre o ano anterior; o ano atual vai até hoje. */
export function yearTable(list: Dividend[]): { year: string; totalCents: Cents; growth: number | null }[] {
  const years = totalsByYear(list)
  return years.map((y, i) => {
    const prev = years[i + 1]
    return { ...y, growth: prev && prev.totalCents > 0 ? y.totalCents / prev.totalCents - 1 : null }
  })
}
