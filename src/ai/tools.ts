// Ferramentas do chat: só leem os dados que a tela já carregou (não recebem o banco) e devolvem valores já formatados,
// para o modelo nunca precisar somar nem converter centavos.
import type { Txn } from '../db/gastosRepo'
import { fold, monthTotals } from '../domain/gastos'
import { monthOf, monthsBetween, plainBRL } from '../domain/money'
import { blocoOf, custos, goalsFor } from '../domain/orcamento'
import { portfolioResult } from '../domain/portfolio'
import type { Cents, Month } from '../domain/types'
import { carteiraClasses } from '../pages/carteira/build'
import { spentByCategory } from '../pages/categorias/build'
import { cleanDescription, monthForecast } from '../pages/lancamentos/build'
import { spendingPlan } from '../pages/orcamento/build'
import { byTicker } from '../pages/proventos/build'
import type { AiInput } from './facts'
import { brlS, pctS, pctU } from './fmt'

type LoadRent = (meses: number) => Promise<AiInput['rent']>
type Args = Record<string, unknown>

const mes = { type: 'string', description: 'mês no formato AAAA-MM' }
const fn = (name: string, description: string, properties: Record<string, object>, required: string[]) =>
  ({ type: 'function' as const, function: { name, description, parameters: { type: 'object', properties, required } } })

export const TOOLS = [
  fn('gastos', 'Total gasto num período e quanto foi em cada categoria.', { de: mes, ate: mes, categoria: { type: 'string', description: 'nome da categoria (opcional)' } }, ['de', 'ate']),
  fn('lancamentos', 'Lista os gastos de um período (até 30, os mais recentes), com o total e a quantidade de todos.', { de: mes, ate: mes, busca: { type: 'string', description: 'parte da descrição, ex.: "padaria" (opcional)' }, categoria: { type: 'string', description: 'nome da categoria (opcional)' } }, ['de', 'ate']),
  fn('orcamento', 'Planejado × realizado do orçamento de um mês, por bloco, e as metas por categoria.', { mes }, ['mes']),
  fn('carteira', 'Patrimônio investido, valorização sobre o aportado (sem proventos) e quanto há em cada classe de investimento.', {}, []),
  fn('rentabilidade', 'Rentabilidade da carteira de bolsa comparada ao CDI e ao Ibovespa nos últimos meses.', { meses: { type: 'integer', description: 'de 1 a 24; padrão 12' } }, []),
  fn('proventos', 'Proventos (dividendos, JCP, rendimentos) recebidos num período, por mês e por ativo.', { de: mes, ate: mes }, ['de', 'ate']),
]

const isMonth = (v: unknown): v is Month => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
const opt = (v: unknown) => (typeof v === 'string' && v.trim() ? fold(v) : null)

function period(a: Args): Month[] | string {
  if (!isMonth(a.de) || !isMonth(a.ate)) return 'Use meses no formato AAAA-MM em "de" e "ate".'
  if (a.de > a.ate) return '"de" precisa ser antes de "ate".'
  const ms = monthsBetween(a.de, a.ate)
  return ms.length > 36 ? 'Período longo demais: no máximo 36 meses.' : ms
}

export async function runTool(name: string, args: unknown, input: AiInput, loadRent: LoadRent): Promise<object> {
  const a = (args && typeof args === 'object' ? args : {}) as Args
  const { data, categorize: cat } = input.gastos
  const catName = (t: Txn) => cat(t)?.name ?? 'Sem categoria'
  switch (name) {
    case 'gastos': {
      const ms = period(a)
      if (typeof ms === 'string') return { erro: ms }
      const want = opt(a.categoria)
      const by = new Map<string, Cents>()
      for (const m of ms) for (const r of spentByCategory(data.txns, data.accounts, cat, data.categories, m)) {
        const n = r.category?.name ?? 'Sem categoria'
        if (r.countsAsSpending && r.cents > 0 && (!want || fold(n).includes(want))) by.set(n, (by.get(n) ?? 0) + r.cents)
      }
      const rows = [...by].sort((x, y) => y[1] - x[1])
      return { periodo: `${a.de} a ${a.ate}`, total: plainBRL(rows.reduce((s, r) => s + r[1], 0)), porCategoria: rows.slice(0, 15).map(([categoria, c]) => ({ categoria, valor: plainBRL(c) })) }
    }
    case 'lancamentos': {
      const ms = period(a)
      if (typeof ms === 'string') return { erro: ms }
      const [busca, want, inRange] = [opt(a.busca), opt(a.categoria), new Set(ms)]
      const list = data.txns.filter(t => {
        const c = cat(t)
        if (t.amountCents >= 0 || !inRange.has(monthOf(t.date)) || (c && !c.countsAsSpending)) return false
        if (want && !fold(catName(t)).includes(want)) return false
        return !busca || fold(t.description).includes(busca) || fold(cleanDescription(t.description).name).includes(busca)
      }).sort((x, y) => y.date.localeCompare(x.date))
      return {
        periodo: `${a.de} a ${a.ate}`, total: plainBRL(-list.reduce((s, t) => s + t.amountCents, 0)), quantidade: list.length,
        linhas: list.slice(0, 30).map(t => ({ data: `${t.date.slice(8, 10)}/${t.date.slice(5, 7)}/${t.date.slice(0, 4)}`, descricao: cleanDescription(t.description).name, categoria: catName(t), valor: plainBRL(-t.amountCents) })),
      }
    }
    case 'orcamento': {
      if (!isMonth(a.mes)) return { erro: 'Use o mês no formato AAAA-MM em "mes".' }
      const m = a.mes
      const o = input.orcamento
      const lines = o.lines.filter(l => l.month === m)
      const goals = goalsFor(o.goals, o.months, m, data.categories)
      const spent = monthTotals(data.txns, data.accounts, cat, m).spentCents
      const forecast = monthForecast(spent, m, input.today)
      const c = custos(o.lines, data.txns, cat, m, goals, new Set(o.fixedCategories))
      const saidas = lines.filter(l => l.kind === 'saida')
      const paidIn = (b: string) => saidas.filter(l => blocoOf(l) === b && c.paid.has(l.id)).reduce((s, l) => s - c.paid.get(l.id)!.amountCents, 0)
      const real: Record<string, Cents | undefined> = { fixo: paidIn('fixo') + c.fixasCents, parcela: paidIn('parcela'), variavel: c.realCents, meta: undefined }
      const names = new Map(data.categories.map(x => [x.id, x.name]))
      return {
        mes: m, planejado: plainBRL(spendingPlan(lines, data.categories, goals).plannedCents), realizado: plainBRL(spent), ...(forecast !== null ? { previsaoDoMes: plainBRL(forecast) } : {}),
        porBloco: (['fixo', 'parcela', 'variavel', 'meta'] as const).flatMap(b => {
          const planned = saidas.filter(l => blocoOf(l) === b).reduce((s, l) => s + l.amountCents, 0)
          const r = real[b]
          return planned > 0 || (r ?? 0) > 0 ? [{ bloco: b, planejado: plainBRL(planned), ...(r !== undefined ? { realizado: plainBRL(r) } : {}) }] : []
        }),
        metas: c.variaveis.filter(v => v.goalCents !== null).map(v => ({ categoria: v.categoryId ? names.get(v.categoryId) ?? v.categoryId : 'Sem categoria', meta: plainBRL(v.goalCents!), gasto: plainBRL(v.realCents) })),
      }
    }
    case 'carteira': {
      const p = input.portfolio
      const { gainCents, baseCents } = portfolioResult(p)
      return {
        patrimonio: plainBRL(p.totalValueCents), valorizacao: brlS(gainCents), ...(baseCents > 0 ? { valorizacaoPct: pctS((gainCents / baseCents) * 100), aportado: plainBRL(baseCents) } : {}),
        porClasse: carteiraClasses(p).filter(x => x.valueCents > 0).map(x => ({ classe: x.label, valor: plainBRL(x.valueCents), pct: pctU(x.pct * 100) })),
      }
    }
    case 'rentabilidade': {
      const meses = Math.min(24, Math.max(1, Math.round(Number(a.meses ?? 12)) || 12))
      const r = await loadRent(meses)
      if (!r) return { erro: 'Não consegui o histórico de cotações agora (sem internet?).' }
      const f = (v: number | null) => (v === null ? 'sem dado' : pctS(v))
      return { periodo: `últimos ${meses} meses`, carteira: f(r.carteiraPct), cdi: f(r.cdiPct), ibovespa: f(r.ibovPct) }
    }
    case 'proventos': {
      const ms = period(a)
      if (typeof ms === 'string') return { erro: ms }
      const inRange = new Set(ms)
      const list = input.dividends.filter(d => inRange.has(monthOf(d.payDate)))
      const byMonth = ms.map(m => ({ mes: m, valor: list.filter(d => monthOf(d.payDate) === m).reduce((s, d) => s + d.amountCents, 0) })).filter(x => x.valor > 0)
      return {
        periodo: `${a.de} a ${a.ate}`, total: plainBRL(list.reduce((s, d) => s + d.amountCents, 0)),
        porMes: byMonth.map(x => ({ mes: x.mes, valor: plainBRL(x.valor) })), porAtivo: byTicker(list).slice(0, 10).map(x => ({ ativo: x.ticker, valor: plainBRL(x.totalCents) })),
      }
    }
    default: return { erro: `Ferramenta desconhecida: ${name}.` }
  }
}
