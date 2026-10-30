// Fatos do mês para a IA: cada número sai dos mesmos cálculos dos Resumos; o modelo só escolhe o que importa e explica.
import type { Category, GastosData, Txn } from '../db/gastosRepo'
import type { OrcamentoData } from '../db/orcamentoRepo'
import type { RfMove } from '../db/rendaFixaRepo'
import type { Subscription } from '../domain/assinaturas'
import { monthTotals } from '../domain/gastos'
import { addMonths, monthOf, plainBRL } from '../domain/money'
import { goalsFor } from '../domain/orcamento'
import { portfolioResult, type Portfolio } from '../domain/portfolio'
import { rfJurosByMonth } from '../domain/rendaFixa'
import type { rentOver } from '../domain/rentabilidade'
import type { Dividend, ISODate, Month } from '../domain/types'
import { biggestChanges, nextCharges, spentByCategory } from '../pages/categorias/build'
import { cleanDescription, comparePreviousMonth, cutToDay, monthForecast, spentByMonth, topSpending } from '../pages/lancamentos/build'
import { spendingPlan } from '../pages/orcamento/build'
import { passiveCoverage } from '../pages/resumoInvestimentos/build'
import type { Route } from '../ui/routes'
import { brlS, pctS, pctU } from './fmt'

export interface AiInput {
  today: ISODate
  gastos: { data: GastosData; categorize: (t: Txn) => Category | null; subscriptions: Subscription[] }
  orcamento: OrcamentoData
  portfolio: Portfolio
  dividends: Dividend[]
  rfMoves: RfMove[]
  rent: ReturnType<typeof rentOver> | null
}

/** Os do mês escolhido entram no hash do cache; os de agora (cotação, CDI, saldo) mudam toda hora e não. */
export const MONTH_KINDS = ['gasto_mes', 'vs_anterior', 'variacao_categoria', 'orcamento', 'maiores_gastos', 'cobrancas'] as const
export type FactKind = (typeof MONTH_KINDS)[number] | 'carteira' | 'rentabilidade' | 'renda_passiva' | 'saldo_parado'
export interface Fact { id: string; kind: FactKind; text: string; route: Route; categoryId?: string }

const monthLabel = (m: Month) => `${new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 15)).toLocaleString('pt-BR', { month: 'long', timeZone: 'UTC' })} de ${m.slice(0, 4)}`
const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

export function buildFacts(month: Month, input: AiInput): Fact[] {
  const { data, categorize: cat, subscriptions } = input.gastos
  const thisMonth = monthOf(input.today)
  const isCurrent = month === thisMonth
  const prev = addMonths(month, -1)
  const [mes, mesAnt] = [monthLabel(month), monthLabel(prev)]
  const out: Fact[] = []

  const totals = monthTotals(data.txns, data.accounts, cat, month)
  if (totals.spentCents > 0 || totals.incomeCents > 0) {
    const left = totals.incomeCents - totals.spentCents
    out.push({ id: 'gasto_mes', kind: 'gasto_mes', route: 'gastos-resumo',
      text: `Em ${mes}: gasto ${plainBRL(totals.spentCents)}, entradas ${plainBRL(totals.incomeCents)}, sobrou ${plainBRL(left)}${totals.incomeCents > 0 ? ` (${pctU((left / totals.incomeCents) * 100)} do que entrou)` : ''}.` })
  }

  const cmp = comparePreviousMonth(data.txns, cat, month, input.today)
  if (cmp.currentCents > 0 || cmp.previousSameDayCents > 0) {
    const diff = cmp.currentCents - cmp.previousSameDayCents
    out.push({ id: 'vs_anterior', kind: 'vs_anterior', route: 'gastos-resumo',
      text: `Gasto até o dia ${cmp.day}: ${plainBRL(cmp.currentCents)} em ${mes} contra ${plainBRL(cmp.previousSameDayCents)} em ${mesAnt} até o mesmo dia (diferença de ${brlS(diff)}${cmp.previousSameDayCents > 0 ? `, ${pctS((diff / cmp.previousSameDayCents) * 100)}` : ''}).` })
  }

  // como no Resumo: no mês atual compara com o anterior até o mesmo dia
  const prevTxns = isCurrent ? cutToDay(data.txns, prev, cmp.day) : data.txns
  const spendMap = (txns: Txn[], m: Month) => new Map(spentByCategory(txns, data.accounts, cat, data.categories, m).flatMap(r => (r.category && r.countsAsSpending ? [[r.category.id, r.cents] as const] : [])))
  const [curMap, prevMap] = [spendMap(data.txns, month), spendMap(prevTxns, prev)]
  const names = new Map(data.categories.map(c => [c.id, c.name]))
  for (const ch of biggestChanges(curMap, prevMap, 3)) {
    const [c, p] = [curMap.get(ch.id) ?? 0, prevMap.get(ch.id) ?? 0]
    out.push({ id: `variacao_categoria:${ch.id}`, kind: 'variacao_categoria', route: 'lancamentos', categoryId: ch.id,
      text: `${names.get(ch.id) ?? ch.id}: ${plainBRL(c)} em ${mes} contra ${plainBRL(p)} em ${mesAnt}${isCurrent ? ` até o dia ${cmp.day}` : ''} (diferença de ${brlS(ch.deltaCents)}${ch.pct !== null ? `, ${pctS(ch.pct * 100)}` : ''}).` })
  }

  const lines = input.orcamento.lines.filter(l => l.month === month)
  const planned = spendingPlan(lines, data.categories, goalsFor(input.orcamento.goals, input.orcamento.months, month, data.categories)).plannedCents
  if (planned > 0) {
    const spent = totals.spentCents
    const forecast = monthForecast(spent, month, input.today)
    const fim = forecast !== null
      ? `No ritmo atual o mês fecha em ${plainBRL(forecast)}, ${plainBRL(Math.abs(forecast - planned))} ${forecast > planned ? 'acima' : 'abaixo'} do planejado.`
      : spent > planned ? `Passou ${plainBRL(spent - planned)} do planejado.` : `Sobraram ${plainBRL(planned - spent)} do planejado.`
    out.push({ id: 'orcamento', kind: 'orcamento', route: 'orcamento',
      text: `Orçamento de ${mes}: planejado ${plainBRL(planned)}, gasto ${plainBRL(spent)} (${pctU((spent / planned) * 100)} do planejado). ${fim}` })
  }

  const top = topSpending(data.txns, cat, month, 3)
  if (top.length) {
    out.push({ id: 'maiores_gastos', kind: 'maiores_gastos', route: 'lancamentos',
      text: `Maiores gastos de ${mes}: ${top.map(t => `${cleanDescription(t.description).name} ${plainBRL(-t.amountCents)} em ${day(t.date)}`).join('; ')}.` })
  }

  if (!isCurrent) return out // daqui para baixo é o retrato de hoje: num mês passado confundiria

  const soon = nextCharges(subscriptions, input.today)
  if (soon.list.length) {
    out.push({ id: 'cobrancas', kind: 'cobrancas', route: 'assinaturas',
      text: `Assinaturas nos próximos 30 dias: ${plainBRL(soon.totalCents)} em ${soon.list.length} cobrança${soon.list.length === 1 ? '' : 's'} (${soon.list.slice(0, 3).map(s => `${s.name} ${plainBRL(s.amountCents)} em ${day(s.nextDate)}`).join('; ')}).` })
  }

  const p = input.portfolio
  if (p.totalValueCents > 0) {
    const { gainCents, baseCents } = portfolioResult(p)
    out.push({ id: 'carteira', kind: 'carteira', route: 'carteira',
      text: `Carteira: patrimônio de ${plainBRL(p.totalValueCents)}; resultado de ${brlS(gainCents)}${baseCents > 0 ? ` (${pctS((gainCents / baseCents) * 100)}) sobre ${plainBRL(baseCents)} investidos` : ''}.` })
  }

  const r = input.rent
  if (r && r.carteiraPct !== null && (r.cdiPct !== null || r.ibovPct !== null)) {
    const vs = r.cdiPct === null ? '' : ` A carteira ficou ${r.carteiraPct >= r.cdiPct ? 'acima' : 'abaixo'} do CDI.`
    out.push({ id: 'rentabilidade', kind: 'rentabilidade', route: 'investimentos-resumo',
      text: `Rentabilidade nos últimos 12 meses: carteira de bolsa ${pctS(r.carteiraPct)}${r.cdiPct !== null ? `, CDI ${pctS(r.cdiPct)}` : ''}${r.ibovPct !== null ? `, Ibovespa ${pctS(r.ibovPct)}` : ''}.${vs}` })
  }

  // mesmo cálculo do Resumo de investimentos: meses fechados de gasto e juros da renda fixa junto dos proventos
  const juros12m = rfJurosByMonth(input.rfMoves, thisMonth, 12).reduce((s, m) => s + m.cents, 0)
  const cov = data.txns.length ? passiveCoverage(p.dividends12mCents + juros12m, spentByMonth(data.txns, cat, addMonths(thisMonth, -1), 12).map(m => m.cents)) : null
  if (cov && cov.avgDividendsCents > 0) {
    out.push({ id: 'renda_passiva', kind: 'renda_passiva', route: 'investimentos-resumo',
      text: `Renda passiva: proventos e juros dos últimos 12 meses dão em média ${plainBRL(cov.avgDividendsCents)} por mês, ${pctU(cov.pct * 100)} do gasto médio de ${plainBRL(cov.avgSpentCents)} por mês${cov.gapCents > 0 ? `; faltam ${plainBRL(cov.gapCents)} por mês para cobrir o gasto` : ''}.` })
  }

  // saldo como a Pluggy informou; conta por arquivo não tem saldo
  const contas = data.accounts.filter(a => a.source === 'pluggy' && a.kind === 'conta' && (a.balanceCents ?? 0) > 0)
  if (contas.length) {
    const total = contas.reduce((s, a) => s + a.balanceCents!, 0)
    const at = contas.map(a => a.balanceAt).filter(Boolean).sort().at(-1)
    const rende = r?.cdiMonthPct != null ? ` A 100% do CDI do último mês (${pctU(r.cdiMonthPct)}) esse valor renderia cerca de ${plainBRL(Math.round((total * r.cdiMonthPct) / 100))} por mês.` : ''
    out.push({ id: 'saldo_parado', kind: 'saldo_parado', route: 'gastos-resumo',
      text: `Saldo em conta corrente: ${plainBRL(total)} (${[...new Set(contas.map(a => a.institution))].join(', ')}${at ? `, saldo de ${day(at.slice(0, 10))}` : ''}).${rende}` })
  }
  return out
}

/** SHA-256 só dos fatos do mês: cotação e CDI mudam a toda hora e marcariam os insights como desatualizados sem motivo. */
export async function factsHash(facts: Fact[]): Promise<string> {
  const own = facts.filter(f => (MONTH_KINDS as readonly string[]).includes(f.kind))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(own)))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}
