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

// shortcut: tabelas de 2026 fixas no código (Portaria MPS/MF 13/2026, Lei 15.191/2025 e Lei 15.270/2025); trocar a cada ano.
const INSS_FAIXAS: [Cents, number][] = [[162100, 0.075], [290284, 0.09], [435427, 0.12], [847555, 0.14]] // [teto da faixa, alíquota]
const IRRF_FAIXAS: [Cents, number, Cents][] = [[242880, 0, 0], [282665, 0.075, 18216], [375105, 0.15, 39416], [466468, 0.225, 67549], [Infinity, 0.275, 90873]]
const DEPENDENTE: Cents = 18959
const DESCONTO_SIMPLIFICADO: Cents = 60720

/** INSS do empregado: alíquota de cada faixa só sobre a parte do salário nela, até o teto; centavo truncado como na folha. */
export function inssEmpregado(grossCents: Cents): Cents {
  let total = 0, from = 0
  for (const [to, rate] of INSS_FAIXAS) {
    if (grossCents > from) total += (Math.min(grossCents, to) - from) * rate
    from = to
  }
  return Math.floor(total + 1e-6)
}

/** IRRF mensal 2026: tabela progressiva sobre bruto − (INSS + dependentes, ou o desconto simplificado se for maior), menos a redução da Lei 15.270. */
export function irrfMensal(grossCents: Cents, inssCents: Cents, dependents: number): Cents {
  const base = grossCents - Math.max(inssCents + dependents * DEPENDENTE, DESCONTO_SIMPLIFICADO)
  const [, rate, deduct] = IRRF_FAIXAS.find(([to]) => base <= to)!
  const tax = Math.max(0, base * rate - deduct)
  const reduction = grossCents <= 500000 ? tax : grossCents <= 735000 ? 97862 - 0.133145 * grossCents : 0
  return Math.round(Math.max(0, tax - reduction))
}

export interface CltBreakdown { grossCents: Cents; inssCents: Cents; irrfCents: Cents; outrosCents: Cents; fgtsCents: Cents; netCents: Cents }

/** Salário CLT: `outrosCents` são os demais descontos da folha (plano, VT, VR…). FGTS (8%) é depósito do empregador, não sai do líquido. */
export function cltNet(grossCents: Cents, dependents: number, outrosCents: Cents): CltBreakdown {
  const inssCents = inssEmpregado(grossCents)
  const irrfCents = irrfMensal(grossCents, inssCents, dependents)
  return { grossCents, inssCents, irrfCents, outrosCents, fgtsCents: Math.round(grossCents * 0.08), netCents: grossCents - inssCents - irrfCents - outrosCents }
}

export const sourceNet = (s: IncomeSource): Cents =>
  s.kind === 'pj' ? pjNet(s.grossCents ?? 0, s).netCents : s.kind === 'clt' ? cltNet(s.grossCents ?? 0, s.dependents, s.outrosCents).netCents : s.netCents ?? 0

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
