import type { Account, Category, Txn } from '../db/gastosRepo'
import type { BudgetLine, Goal, Grupo, IncomeSource, PjConfig } from '../db/orcamentoRepo'
import { fold, monthTotals, normalizeDescription, shortName } from './gastos'
import { addMonths, monthsBetween } from './money'
import { ownerMention } from './transferencias'
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

export const GOAL_INVESTIR = 'investir', GOAL_VARIAVEIS = 'variaveis'
export const catGoal = (categoryId: string) => `cat:${categoryId}`

/** Metas valendo em `month`: para cada chave, a mudança mais recente até ele; null desliga a meta dali em diante. */
export function goalsAt(goals: Goal[], month: Month): Map<string, Cents> {
  const last = new Map<string, Goal>()
  for (const g of goals) if (g.month <= month && (last.get(g.key)?.month ?? '') <= g.month) last.set(g.key, g)
  return new Map([...last].flatMap(([k, g]) => (g.amountCents === null ? [] : [[k, g.amountCents] as const])))
}

/**
 * Lançamentos do mês que já estão planejados em outro bloco, e qual linha cada um pagou: assinaturas aceitas, parcelas aceitas
 * (pela chave da sugestão) e, para as outras linhas de custo fixo e parcela, um lançamento de valor a até 5% da linha na mesma
 * categoria ou sem categoria (Pix para outra pessoa fica sem). Parcela que não está no plano conta como gasto.
 */
function planned(lines: BudgetLine[], txns: Txn[], cat: (t: Txn) => Category | null, month: Month): { paid: Map<string, Txn>; used: Set<string> } {
  const ls = lines.filter(l => l.month === month && l.kind === 'saida')
  const key = (l: BudgetLine) => l.sourceKey!.replace(/@\d{4}-\d{2}$/, '')
  const byKey = new Map(ls.filter(l => /^(sub|parc):/.test(l.sourceKey ?? '')).map(l => [key(l), l]))
  const paid = new Map<string, Txn>() // linha → lançamento
  const used = new Set<string>()
  const ofMonth = txns.filter(t => t.date.slice(0, 7) === month && t.amountCents < 0).sort((a, b) => a.date.localeCompare(b.date))
  for (const t of ofMonth) {
    const norm = `${t.accountId}|${normalizeDescription(t.description)}`, total = t.installment?.match(/^\d+\/(\d+)$/)?.[1]
    // assinatura só leva a cobrança de valor parecido (15%, como na detecção): outras compras no mesmo lugar continuam gasto
    const sub = byKey.get(`sub:${norm}`), line = sub && Math.abs(-t.amountCents - sub.amountCents) <= sub.amountCents * 0.15 ? sub
      : total ? byKey.get(`parc:${norm}|${total}|${-t.amountCents}`) : undefined
    if (line) { used.add(t.id); if (!paid.has(line.id)) paid.set(line.id, t) }
  }
  for (const l of ls) {
    if (blocoOf(l) === 'variavel' || blocoOf(l) === 'meta' || /^(sub|parc):/.test(l.sourceKey ?? '')) continue
    const t = ofMonth.find(t => {
      const c = cat(t)
      // sem categoria vale (Pix para outra pessoa), menos para a fatura: um Pix qualquer não paga o cartão
      const sameCat = c === null ? l.categoryId !== 'pagamento-de-fatura' : c.id === l.categoryId
      return !used.has(t.id) && sameCat && Math.abs(-t.amountCents - l.amountCents) <= l.amountCents * 0.05
    })
    if (t) { used.add(t.id); paid.set(l.id, t) }
  }
  return { paid, used }
}

export interface VarRow { categoryId: string | null /* null: sem categoria */; realCents: Cents; goalCents: Cents | null; txns: Txn[] /* os gastos do mês que somam o real, mais recentes primeiro */ }

/**
 * Custos do mês puxados dos lançamentos, por categoria, sem o que já está planejado em fixos e parcelas. As categorias em `fixed`
 * vão para os fixos (o que saiu fora do plano); as outras e o sem categoria, para os variáveis, junto com as linhas à mão.
 */
export function custos(lines: BudgetLine[], txns: Txn[], cat: (t: Txn) => Category | null, month: Month, goals: Map<string, Cents>, fixed: Set<string>): {
  variaveis: VarRow[]; fixas: VarRow[]; manual: BudgetLine[]; realCents: Cents /* variáveis + à mão */; fixasCents: Cents; goalCents: Cents | null; paid: Map<string, Txn>
} {
  const { paid, used } = planned(lines, txns, cat, month)
  const own = txns.filter(t => !used.has(t.id))
  const by = monthTotals(own, [], cat, month).byCategory
  const spent = own.filter(t => t.date.slice(0, 7) === month && t.amountCents < 0).sort((a, b) => b.date.localeCompare(a.date))
  const ofCat = (id: string | null) => spent.filter(t => (cat(t)?.id ?? null) === id)
  const rows = new Map<string | null, VarRow>(by.filter(b => b.cents > 0).map(b => [b.category?.id ?? null, { categoryId: b.category?.id ?? null, realCents: b.cents, goalCents: null, txns: ofCat(b.category?.id ?? null) }]))
  for (const [k, cents] of goals) {
    if (!k.startsWith('cat:')) continue
    const id = k.slice(4)
    rows.set(id, { categoryId: id, realCents: rows.get(id)?.realCents ?? 0, goalCents: cents, txns: rows.get(id)?.txns ?? [] })
  }
  const sorted = [...rows.values()].sort((a, b) => b.realCents - a.realCents || (b.goalCents ?? 0) - (a.goalCents ?? 0))
  const isFixed = (r: VarRow) => r.categoryId !== null && fixed.has(r.categoryId)
  // conta fixa que mudou de valor (luz, aluguel em dois Pix) não casa com a linha: o que saiu na categoria abate o que a linha ainda espera
  const waiting = (id: string) => lines.filter(l => l.month === month && l.kind === 'saida' && blocoOf(l) === 'fixo' && l.categoryId === id && !paid.has(l.id)).reduce((s, l) => s + l.amountCents, 0)
  const fixas = sorted.filter(isFixed).map(r => ({ ...r, realCents: Math.max(0, r.realCents - waiting(r.categoryId!)) })).filter(r => r.realCents > 0 || r.goalCents !== null)
  const variaveis = sorted.filter(r => !isFixed(r))
  const manual = lines.filter(l => l.month === month && l.kind === 'saida' && blocoOf(l) === 'variavel')
  const sum = (rs: VarRow[]) => rs.reduce((s, r) => s + r.realCents, 0)
  return {
    variaveis, fixas, manual, paid,
    realCents: sum(variaveis) + manual.reduce((s, l) => s + l.amountCents, 0),
    fixasCents: sum(fixas),
    goalCents: goals.get(GOAL_VARIAVEIS) ?? null, // só o limite total: a soma das metas de algumas categorias contra o gasto de todas enganaria
  }
}

export interface InvGroup { key: string; name: string; inCents: Cents; outCents: Cents /* resgates */; netCents: Cents; txns: Txn[] /* mais recentes primeiro */ }

/**
 * Destino de uma aplicação ou resgate: o nome curto sem "Aplicação"/"Resgate" na frente, para os dois caírem no mesmo grupo.
 * A chave fica salva em orcamento.reservas: mudar shortName/displayName ou esta função muda a chave (o teste fixa os formatos).
 */
export function investDest(description: string): { key: string; name: string } {
  const short = shortName(description)
  const name = /^dinheiro (guardado|resgatado)\b/i.test(short) ? 'Dinheiro guardado' // a caixinha do Nubank
    : short.replace(/^(aplica[cç][aã]o|resgate|aporte|aplic|resg)\b\.?\s*((de|em|no|na)\s+)?/i, '').replace(/\bautom[aá]tic[ao]\b/i, 'automática').trim()
  const shown = name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Aplicações e resgates'
  return { key: fold(shown), name: shown }
}

// entrada que é rendimento (juros, dividendo, JCP) não é resgate: não desconta do investido
const isYield = (t: Txn) => t.operationType === 'RENDIMENTO_APLIC_FINANCEIRA' || /rendimento|dividend|jcp|juros s|provento/i.test(t.description)

/**
 * Investido no mês: aplicações menos resgates de cada destino (lançamentos em Investimento ou numa categoria criada que não conta
 * como gasto) mais as linhas à mão. Destinos marcados como reserva ficam de fora: é dinheiro guardado que entra e sai, não investimento.
 */
export function investido(lines: BudgetLine[], txns: Txn[], cat: (t: Txn) => Category | null, month: Month, goals: Map<string, Cents>, reservas: Set<string> = new Set()):
  { groups: InvGroup[]; reservas: InvGroup[]; fromTxnsCents: Cents; reservaCents: Cents; manual: BudgetLine[]; realCents: Cents; goalCents: Cents | null } {
  const invest = (c: Category | null) => !!c && (c.id === 'investimento' || (!c.countsAsSpending && !c.builtin))
  const by = new Map<string, InvGroup>()
  for (const t of txns.filter(t => t.date.slice(0, 7) === month && (t.amountCents < 0 || (t.amountCents > 0 && !isYield(t))) && invest(cat(t))).sort((a, b) => b.date.localeCompare(a.date))) {
    const { key, name } = investDest(t.description)
    const g = by.get(key) ?? { key, name, inCents: 0, outCents: 0, netCents: 0, txns: [] }
    if (t.amountCents < 0) g.inCents -= t.amountCents; else g.outCents += t.amountCents
    g.netCents = g.inCents - g.outCents
    g.txns.push(t)
    by.set(key, g)
  }
  const all = [...by.values()].sort((a, b) => Math.abs(b.netCents) - Math.abs(a.netCents))
  const groups = all.filter(g => !reservas.has(g.key)), res = all.filter(g => reservas.has(g.key))
  const sum = (gs: InvGroup[]) => gs.reduce((s, g) => s + g.netCents, 0)
  const manual = lines.filter(l => l.month === month && l.kind === 'saida' && blocoOf(l) === 'meta')
  const fromTxnsCents = sum(groups)
  return { groups, reservas: res, fromTxnsCents, reservaCents: sum(res), manual, realCents: fromTxnsCents + manual.reduce((s, l) => s + l.amountCents, 0), goalCents: goals.get(GOAL_INVESTIR) ?? null }
}

/**
 * Metas que valem para as telas do mês: só em mês com plano (sem plano não há orçamento) e só de categorias que
 * existem e contam como gasto (categoria apagada ou que deixou de ser gasto não pode ter meta que ninguém consegue tirar).
 */
export function goalsFor(goals: Goal[], months: Month[], month: Month, categories: Category[]): Map<string, Cents> {
  if (!months.includes(month)) return new Map()
  const spending = new Set(categories.filter(c => c.countsAsSpending).map(c => catGoal(c.id)))
  return new Map([...goalsAt(goals, month)].filter(([k]) => !k.startsWith('cat:') || spending.has(k)))
}

/** Média mensal de gasto por categoria nos `n` meses antes de `month` (para sugerir a meta). */
export function averageByCategory(txns: Txn[], cat: (t: Txn) => Category | null, month: Month, n = 3): Map<string, Cents> {
  const sum = new Map<string, Cents>()
  for (let i = 1; i <= n; i++) for (const b of monthTotals(txns, [], cat, addMonths(month, -i)).byCategory) if (b.category) sum.set(b.category.id, (sum.get(b.category.id) ?? 0) + b.cents)
  return new Map([...sum].map(([k, v]) => [k, Math.round(v / n)]))
}

/**
 * O que entrou na conta no mês vindo de terceiros (Pix e TED de outras pessoas, reembolso, venda avulsa): entrada de conta corrente
 * que conta como receita, sem transferência entre contas suas, sem Pix no nome do titular ou da empresa dele, sem resgate.
 * Cada entrada do plano leva o depósito de valor parecido (até 10% de diferença) para o salário não contar duas vezes.
 */
export function outrasEntradas(lines: BudgetLine[], txns: Txn[], accounts: Pick<Account, 'id' | 'kind'>[], cat: (t: Txn) => Category | null, month: Month,
  owner: { names: string[]; companies: string[] }): Txn[] {
  const contas = new Set(accounts.filter(a => a.kind === 'conta').map(a => a.id))
  const left = txns.filter(t => {
    if (t.amountCents <= 0 || t.date.slice(0, 7) !== month || !contas.has(t.accountId) || ownerMention(t.description, owner.names, owner.companies)) return false
    const c = cat(t)
    return c === null || c.countsAsSpending || c.id === 'receita' // o mesmo critério de entrada do Resumo de gastos
  }).sort((a, b) => a.date.localeCompare(b.date))
  for (const l of lines.filter(l => l.month === month && l.kind === 'entrada')) {
    let best = -1
    left.forEach((t, i) => {
      const d = Math.abs(t.amountCents - l.amountCents)
      if (d <= l.amountCents * 0.1 && (best < 0 || d < Math.abs(left[best].amountCents - l.amountCents))) best = i
    })
    if (best >= 0) left.splice(best, 1)
  }
  return left
}
