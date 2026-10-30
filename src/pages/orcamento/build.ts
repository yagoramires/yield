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

// planejado = saídas que contam como gasto mais a meta dos variáveis (o limite total ou a soma das metas por categoria);
// reservado = investimentos (bloco ou categoria fora do gasto), que o Resumo não soma
export function spendingPlan(lines: BudgetLine[], categories: Category[], goals: Map<string, Cents> = new Map()): { plannedCents: Cents; reservedCents: Cents } {
  const off = new Set(categories.filter(c => !c.countsAsSpending).map(c => c.id))
  let plannedCents = 0, reservedCents = 0
  for (const l of lines) {
    if (l.kind !== 'saida') continue
    if (l.grupo === 'meta' || (l.categoryId && off.has(l.categoryId))) reservedCents += l.amountCents
    else plannedCents += l.amountCents
  }
  const cats = [...goals].filter(([k]) => k.startsWith('cat:')).reduce((s, [, v]) => s + v, 0)
  return { plannedCents: plannedCents + (goals.get('variaveis') ?? cats), reservedCents }
}

/** Mudanças em relação às metas valendo: campo vazio desliga a meta; valor igual não grava nada. */
export function goalChanges(inputs: Record<string, string>, current: Map<string, Cents>): { key: string; amountCents: Cents | null }[] {
  return Object.entries(inputs).flatMap(([key, text]) => {
    const amountCents = text.trim() ? parseMoney(text, 'Meta') : null
    if (amountCents !== null && amountCents <= 0) throw new Error('Meta: use um valor maior que zero, ou deixe em branco para não ter meta.')
    return amountCents === (current.get(key) ?? null) ? [] : [{ key, amountCents }]
  })
}
