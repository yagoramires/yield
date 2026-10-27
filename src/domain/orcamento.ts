import type { Category, Txn } from '../db/gastosRepo'
import type { BudgetLine, IncomeSource, PjConfig } from '../db/orcamentoRepo'
import { monthTotals } from './gastos'
import type { Cents, Month } from './types'

export interface PjBreakdown { grossCents: Cents; proLaboreCents: Cents; irpjCents: Cents; inssCents: Cents; contabilidadeCents: Cents; outrosCents: Cents; netCents: Cents }

export function pjNet(grossCents: Cents, cfg: PjConfig): PjBreakdown {
  const proLaboreCents = Math.round(grossCents * cfg.proLaborePct / 100)
  const irpjCents = Math.round(grossCents * cfg.irpjPct / 100)
  const inssCents = Math.round(proLaboreCents * cfg.inssPct / 100)
  const { contabilidadeCents, outrosCents } = cfg
  return { grossCents, proLaboreCents, irpjCents, inssCents, contabilidadeCents, outrosCents, netCents: grossCents - irpjCents - inssCents - contabilidadeCents - outrosCents }
}

const sum = (lines: BudgetLine[], kind: BudgetLine['kind']) => lines.filter(l => l.kind === kind).reduce((s, l) => s + l.amountCents, 0)

export function monthSummary(lines: BudgetLine[]): { entradasCents: Cents; saidasCents: Cents; saldoCents: Cents } {
  const entradasCents = sum(lines, 'entrada'), saidasCents = sum(lines, 'saida')
  return { entradasCents, saidasCents, saldoCents: entradasCents - saidasCents }
}

export const sourceNet = (s: IncomeSource): Cents => s.kind === 'pj' ? pjNet(s.grossCents ?? 0, s).netCents : s.netCents ?? 0

// Recebe as linhas de UM mês; parcelas avançam, a última não é copiada, linhas de fonte são recalculadas.
export function nextMonthLines(lines: BudgetLine[], sources: IncomeSource[]): Omit<BudgetLine, 'id' | 'month'>[] {
  return lines
    .filter(l => l.recurring && !(l.installmentCurrent !== null && l.installmentTotal !== null && l.installmentCurrent >= l.installmentTotal))
    .map(({ id: _id, month: _month, ...l }) => {
      const source = sources.find(s => s.id === l.sourceId)
      return {
      ...l,
      amountCents: source ? sourceNet(source) : l.amountCents,
      sourceId: source ? l.sourceId : null,
      installmentCurrent: l.installmentCurrent !== null && l.installmentTotal !== null ? l.installmentCurrent + 1 : l.installmentCurrent,
      sourceKey: null,
    }})
}

export interface PlanVsReal { plannedSaidasCents: Cents; realSpentCents: Cents; byCategory: { categoryId: string; plannedCents: Cents; realCents: Cents }[] }

export function planVsReal(lines: BudgetLine[], txns: Txn[], cat: (t: Txn) => Category | null, month: Month): PlanVsReal {
  const saidas = lines.filter(l => l.month === month && l.kind === 'saida')
  const totals = monthTotals(txns, [], cat, month) // contas não entram no cálculo
  const planned = new Map<string, Cents>()
  for (const l of saidas) if (l.categoryId) planned.set(l.categoryId, (planned.get(l.categoryId) ?? 0) + l.amountCents)
  const byCategory = [...planned].map(([categoryId, plannedCents]) => ({
    categoryId, plannedCents, realCents: totals.byCategory.find(b => b.category?.id === categoryId)?.cents ?? 0,
  })).sort((a, b) => b.plannedCents - a.plannedCents)
  return { plannedSaidasCents: sum(saidas, 'saida'), realSpentCents: totals.spentCents, byCategory }
}
