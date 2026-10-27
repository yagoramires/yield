import type { Category } from '../../db/gastosRepo'
import type { BudgetLine } from '../../db/orcamentoRepo'
import { monthOf } from '../../domain/money'
import type { Cents, ISODate, Month } from '../../domain/types'
import { parseMoney } from '../notas/build'

export function validateLine(input: { name: string; amount: string; installment: string }): { name: string; amountCents: Cents; installmentCurrent: number | null; installmentTotal: number | null } {
  const name = input.name.trim()
  if (!name) throw new Error('Informe o nome.')
  const amountCents = parseMoney(input.amount, 'Valor')
  const p = input.installment.trim()
  if (!p) return { name, amountCents, installmentCurrent: null, installmentTotal: null }
  const m = p.match(/^(\d+)\/(\d+)$/)
  const n = Number(m?.[1]), total = Number(m?.[2])
  if (!m || n < 1 || n > total) throw new Error('Parcela: use n/total, por exemplo 3/10.')
  return { name, amountCents, installmentCurrent: n, installmentTotal: total }
}

export function monthProgress(month: Month, today: ISODate): number {
  const cur = monthOf(today)
  if (month !== cur) return month < cur ? 1 : 0
  const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
  return Number(today.slice(8, 10)) / days
}

export function defaultMonth(months: Month[], today: ISODate): Month {
  const cur = monthOf(today)
  return months.includes(cur) ? cur : months.at(-1) ?? cur
}

// planejado = saídas que contam como gasto; reservado = saídas em categorias como investimento, que o Resumo não soma
export function spendingPlan(lines: BudgetLine[], categories: Category[]): { plannedCents: Cents; reservedCents: Cents } {
  const off = new Set(categories.filter(c => !c.countsAsSpending).map(c => c.id))
  let plannedCents = 0, reservedCents = 0
  for (const l of lines) {
    if (l.kind !== 'saida') continue
    if (l.categoryId && off.has(l.categoryId)) reservedCents += l.amountCents
    else plannedCents += l.amountCents
  }
  return { plannedCents, reservedCents }
}
