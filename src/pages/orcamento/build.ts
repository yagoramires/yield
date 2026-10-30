import type { Category } from '../../db/gastosRepo'
import type { BudgetLine } from '../../db/orcamentoRepo'
import { monthOf } from '../../domain/money'
import type { Cents, ISODate, Month } from '../../domain/types'
import { parseMoney } from '../notas/build'

// Parcela sempre passa para o mês seguinte (avança até a última), então a linha é recorrente.
export function validateLine(input: { name: string; amount: string; installment: string; recurring: boolean }): { name: string; amountCents: Cents; installmentCurrent: number | null; installmentTotal: number | null; recurring: boolean } {
  const name = input.name.trim()
  if (!name) throw new Error('Informe o nome.')
  const amountCents = parseMoney(input.amount, 'Valor')
  const p = input.installment.trim()
  if (!p) return { name, amountCents, installmentCurrent: null, installmentTotal: null, recurring: input.recurring }
  const m = p.match(/^(\d+)\/(\d+)$/)
  const n = Number(m?.[1]), total = Number(m?.[2])
  if (!m || n < 1 || n > total) throw new Error('Parcela: use n/total, por exemplo 3/10.')
  return { name, amountCents, installmentCurrent: n, installmentTotal: total, recurring: true }
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

/** Onde o gasto fecha no ritmo atual; null no primeiro instante do mês e fora do mês corrente. */
export const pace = (realCents: Cents, progress: number): Cents | null => (progress > 0 && progress < 1 ? Math.round(realCents / progress) : null)

/** Um teto por categoria no mês: o gasto real da categoria é um só, dois tetos o mostrariam duas vezes. */
export function tetoError(lines: BudgetLine[], id: string | undefined, categoryId: string): string | null {
  if (!categoryId) return 'Escolha a categoria: o gasto real do teto vem dos lançamentos dela.'
  const self = lines.find(l => l.id === id)
  if (self?.grupo === 'variavel' && self.categoryId === categoryId) return null // já era teto desta categoria: mudar o valor não cria outro
  const other = lines.find(l => l.id !== id && l.kind === 'saida' && l.grupo === 'variavel' && l.installmentTotal === null && l.categoryId === categoryId)
  return other ? `Já existe um teto nesta categoria (${other.name}): edite o valor dele.` : null
}

// planejado = saídas que contam como gasto; reservado = investimentos e metas (bloco ou categoria fora do gasto), que o Resumo não soma
export function spendingPlan(lines: BudgetLine[], categories: Category[]): { plannedCents: Cents; reservedCents: Cents } {
  const off = new Set(categories.filter(c => !c.countsAsSpending).map(c => c.id))
  let plannedCents = 0, reservedCents = 0
  for (const l of lines) {
    if (l.kind !== 'saida') continue
    if (l.grupo === 'meta' || (l.categoryId && off.has(l.categoryId))) reservedCents += l.amountCents
    else plannedCents += l.amountCents
  }
  return { plannedCents, reservedCents }
}
