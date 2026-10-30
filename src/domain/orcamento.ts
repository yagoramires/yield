import type { Category, Txn } from '../db/gastosRepo'
import type { BudgetLine, Grupo, IncomeSource, PjConfig } from '../db/orcamentoRepo'
import { monthTotals } from './gastos'
import { addMonths, monthsBetween } from './money'
import type { Cents, Month } from './types'

export interface PjBreakdown { grossCents: Cents; proLaboreCents: Cents; irpjCents: Cents; inssCents: Cents; contabilidadeCents: Cents; outrosCents: Cents; dasCents: Cents; netCents: Cents }

/** PJ e MEI: o MEI vem com os percentuais zerados e o DAS fixo em `dasCents`; na PJ o DAS fica em 0. */
export function pjNet(grossCents: Cents, cfg: PjConfig): PjBreakdown {
  const proLaboreCents = Math.round(grossCents * cfg.proLaborePct / 100)
  const irpjCents = Math.round(grossCents * cfg.irpjPct / 100)
  const inssCents = Math.round(proLaboreCents * cfg.inssPct / 100)
  const { contabilidadeCents, outrosCents, dasCents } = cfg
  return { grossCents, proLaboreCents, irpjCents, inssCents, contabilidadeCents, outrosCents, dasCents, netCents: grossCents - irpjCents - inssCents - dasCents - contabilidadeCents - outrosCents }
}

const sum = (lines: BudgetLine[], kind: BudgetLine['kind']) => lines.filter(l => l.kind === kind).reduce((s, l) => s + l.amountCents, 0)

export function monthSummary(lines: BudgetLine[]): { entradasCents: Cents; saidasCents: Cents; saldoCents: Cents } {
  const entradasCents = sum(lines, 'entrada'), saidasCents = sum(lines, 'saida')
  return { entradasCents, saidasCents, saldoCents: entradasCents - saidasCents }
}

interface CltTabela {
  inss: [Cents, number][] // [teto da faixa, alíquota]
  irrf: [Cents, number, Cents][] // [teto da base, alíquota, parcela a deduzir]
  dependente: Cents; simplificado: Cents
  reducao: { isentoAte: Cents; ate: Cents; a: Cents; b: number } | null // redução do IRRF: zera até isentoAte, a − b × bruto até `ate`
}
// Uma tabela por ano, só com valores publicados. 2026: Portaria MPS/MF 13/2026, Lei 15.191/2025 e Lei 15.270/2025.
const CLT_TABELAS: Record<number, CltTabela> = {
  2026: {
    inss: [[162100, 0.075], [290284, 0.09], [435427, 0.12], [847555, 0.14]],
    irrf: [[242880, 0, 0], [282665, 0.075, 18216], [375105, 0.15, 39416], [466468, 0.225, 67549], [Infinity, 0.275, 90873]],
    dependente: 18959, simplificado: 60720,
    reducao: { isentoAte: 500000, ate: 735000, a: 97862, b: 0.133145 },
  },
}
const ANOS = Object.keys(CLT_TABELAS).map(Number).sort((a, b) => a - b)
export const ULTIMA_TABELA_CLT = ANOS[ANOS.length - 1]

/** Ano da tabela usada para `year`: a dele, senão a mais recente anterior, senão a mais antiga que o app tem. */
export const cltTabelaAno = (year: number): number => ANOS.filter(y => y <= year).at(-1) ?? ANOS[0]
const tabela = (year: number) => CLT_TABELAS[cltTabelaAno(year)]

/** INSS do empregado: alíquota de cada faixa só sobre a parte do salário nela, até o teto; centavo truncado como na folha. */
export function inssEmpregado(grossCents: Cents, year = ULTIMA_TABELA_CLT): Cents {
  let total = 0, from = 0
  for (const [to, rate] of tabela(year).inss) {
    if (grossCents > from) total += (Math.min(grossCents, to) - from) * rate
    from = to
  }
  return Math.floor(total + 1e-6)
}

/** IRRF mensal: tabela progressiva sobre bruto − (INSS + dependentes, ou o desconto simplificado se for maior), menos a redução do ano, se houver. */
export function irrfMensal(grossCents: Cents, inssCents: Cents, dependents: number, year = ULTIMA_TABELA_CLT): Cents {
  const t = tabela(year)
  const base = grossCents - Math.max(inssCents + dependents * t.dependente, t.simplificado)
  const [, rate, deduct] = t.irrf.find(([to]) => base <= to)!
  const tax = Math.max(0, base * rate - deduct)
  const r = t.reducao
  const reduction = !r ? 0 : grossCents <= r.isentoAte ? tax : grossCents <= r.ate ? r.a - r.b * grossCents : 0
  return Math.round(Math.max(0, tax - reduction))
}

export interface CltBreakdown { grossCents: Cents; inssCents: Cents; irrfCents: Cents; outrosCents: Cents; fgtsCents: Cents; netCents: Cents }

/** Salário CLT: `outrosCents` são os demais descontos da folha (plano, VT, VR…). FGTS (8%) é depósito do empregador, não sai do líquido. */
export function cltNet(grossCents: Cents, dependents: number, outrosCents: Cents, year = ULTIMA_TABELA_CLT): CltBreakdown {
  const inssCents = inssEmpregado(grossCents, year)
  const irrfCents = irrfMensal(grossCents, inssCents, dependents, year)
  return { grossCents, inssCents, irrfCents, outrosCents, fgtsCents: Math.round(grossCents * 0.08), netCents: grossCents - inssCents - irrfCents - outrosCents }
}

/** `month` escolhe a tabela do CLT; sem ele, a mais recente. */
export const sourceNet = (s: IncomeSource, month?: Month): Cents =>
  s.kind === 'pj' || s.kind === 'mei' ? pjNet(s.grossCents ?? 0, s).netCents : s.kind === 'clt' ? cltNet(s.grossCents ?? 0, s.dependents, s.outrosCents, month ? Number(month.slice(0, 4)) : undefined).netCents : s.netCents ?? 0

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
      amountCents: source ? sourceNet(source, target) : l.amountCents,
      sourceId: source ? l.sourceId : null,
      installmentCurrent: current,
      sourceKey: l.sourceKey && /^(sub|parc):/.test(l.sourceKey) ? `${l.sourceKey.replace(/@\d{4}-\d{2}$/, '')}@${target}` : null,
    }]
  })
}

export const nextMonthLines = (lines: BudgetLine[], sources: IncomeSource[]) => (lines.length ? copyLines(lines, sources, addMonths(lines[0].month, 1)) : [])

export type Bloco = 'parcela' | Grupo
/** Bloco da saída na tela: n/total é parcela; sem grupo (linha de antes dos blocos) é custo fixo. */
export const blocoOf = (l: Pick<BudgetLine, 'installmentTotal' | 'grupo'>): Bloco => (l.installmentTotal !== null ? 'parcela' : l.grupo ?? 'fixo')

type NewLine = Omit<BudgetLine, 'id' | 'month'>

/** Fontes de renda sem uma entrada ligada nas linhas do mês. */
export const missingSources = (lines: Pick<BudgetLine, 'kind' | 'sourceId'>[], sources: IncomeSource[]) =>
  sources.filter(s => !lines.some(l => l.kind === 'entrada' && l.sourceId === s.id))

/** Mês novo nasce com toda fonte de renda que as linhas copiadas não trouxeram; fonte com líquido zerado fica de fora (está mal configurada). */
export function withSources(lines: NewLine[], sources: IncomeSource[], month: Month): NewLine[] {
  const add = missingSources(lines, sources).filter(s => sourceNet(s, month) > 0)
  return [...lines, ...add.map((s, i) => ({
    kind: 'entrada' as const, name: s.name, amountCents: sourceNet(s, month), recurring: true, position: lines.length + i,
    categoryId: null, installmentCurrent: null, installmentTotal: null, sourceId: s.id, sourceKey: null, grupo: null,
  }))]
}

export interface Teto { line: BudgetLine; realCents: Cents | null /* sem categoria não há o que medir */ }

/** Custos variáveis do mês: cada teto contra o gasto real da categoria dele nos lançamentos. */
export function variaveis(lines: BudgetLine[], txns: Txn[], cat: (t: Txn) => Category | null, month: Month): { tetos: Teto[]; plannedCents: Cents; realCents: Cents } {
  const by = monthTotals(txns, [], cat, month).byCategory
  const real = (id: string) => by.find(b => b.category?.id === id)?.cents ?? 0
  const tetos = lines.filter(l => l.month === month && l.kind === 'saida' && blocoOf(l) === 'variavel')
    .map(line => ({ line, realCents: line.categoryId ? real(line.categoryId) : null }))
  const cats = new Set(tetos.flatMap(t => (t.line.categoryId ? [t.line.categoryId] : [])))
  return { tetos, plannedCents: tetos.reduce((s, t) => s + t.line.amountCents, 0), realCents: [...cats].reduce((s, c) => s + real(c), 0) }
}
