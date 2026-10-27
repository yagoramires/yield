import type { Category, Txn } from '../db/gastosRepo'
import type { BudgetLine, IncomeSource, PjConfig } from '../db/orcamentoRepo'
import { monthTotals } from './gastos'
import { addMonths, monthsBetween } from './money'
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

// Recebe as linhas de UM mês e copia para `target`: parcelas avançam pela distância e as que já acabaram não são copiadas,
// linhas de fonte são recalculadas, chave de sugestão vai com o mês novo (para não sugerir de novo) e a da planilha cai.
export function copyLines(lines: BudgetLine[], sources: IncomeSource[], target: Month): Omit<BudgetLine, 'id' | 'month'>[] {
  return lines.flatMap(({ id: _id, month, ...l }) => {
    const parcela = l.installmentCurrent !== null && l.installmentTotal !== null
    const current = parcela ? l.installmentCurrent! + monthsBetween(month, target).length - 1 : l.installmentCurrent
    if (!l.recurring || (parcela && current! > l.installmentTotal!)) return []
    const source = sources.find(s => s.id === l.sourceId)
    return [{
      ...l,
      amountCents: source ? sourceNet(source) : l.amountCents,
      sourceId: source ? l.sourceId : null,
      installmentCurrent: current,
      sourceKey: l.sourceKey && /^(sub|parc):/.test(l.sourceKey) ? `${l.sourceKey.replace(/@\d{4}-\d{2}$/, '')}@${target}` : null,
    }]
  })
}

export const nextMonthLines = (lines: BudgetLine[], sources: IncomeSource[]) => (lines.length ? copyLines(lines, sources, addMonths(lines[0].month, 1)) : [])

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
