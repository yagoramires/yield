import type { Dividend } from '../../domain/types'
import type { B3Import, importB3 } from '../../import/b3'
import type { importPlanilha, PlanilhaImport } from '../../import/planilha'

type B3Result = Awaited<ReturnType<typeof importB3>>
type PlanilhaResult = Awaited<ReturnType<typeof importPlanilha>>

const br = (iso: string) => iso.split('-').reverse().join('/')
const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
const signed = (q: number) => `${q > 0 ? '+' : '−'}${String(Math.abs(q)).replace('.', ',')}`
const KIND: Record<string, string> = { bonificacao: 'bonificação', desdobramento: 'desdobramento', grupamento: 'grupamento' }

/** Quantos proventos da planilha o extrato vai apagar — espelha a regra de `upsertDividends`. */
export function planilhaReplacedByB3(existing: Dividend[], incoming: B3Import['dividends']): number {
  const known = new Set(existing.flatMap(d => (d.sourceKey ? [d.sourceKey] : [])))
  const months = new Set(incoming.filter(d => !d.sourceKey || !known.has(d.sourceKey)).map(d => `${d.ticker}|${d.payDate.slice(0, 7)}`))
  return existing.filter(d => d.source === 'planilha' && months.has(`${d.ticker}|${d.payDate.slice(0, 7)}`)).length
}

export function planilhaSummary(r: PlanilhaResult, p: Pick<PlanilhaImport, 'typeConflicts' | 'ignored'>) {
  return {
    counts: `${n(r.notes, 'nota', 'notas')} · ${r.notesSkipped} já existiam · ${n(r.dividends, 'provento', 'proventos')} · ${r.dividendsSkipped} pulados · ${n(r.manualAssets, 'ativo manual', 'ativos manuais')}`,
    warnings: [...p.typeConflicts, ...p.ignored],
  }
}

export function b3Summary(r: B3Result, p: Pick<B3Import, 'ignored' | 'toReview'>) {
  const counts = [
    n(r.dividends, 'provento', 'proventos'), `${r.replaced} substituíram os da planilha`, `${r.dividendsSkipped} já existiam`,
    ...(r.eventsSkipped ? [r.eventsSkipped === 1 ? '1 evento já existia' : `${r.eventsSkipped} eventos já existiam`] : []),
    ...(p.ignored ? [`${n(p.ignored, 'movimentação ignorada', 'movimentações ignoradas')} (negociações entram pelas notas)`] : []),
  ]
  return {
    counts: counts.join(' · '),
    applied: r.applied.map(e => (e.kind === 'mudanca_ticker' ? `${e.ticker} → ${e.newTicker} (${br(e.date)})` : `${e.ticker} ${KIND[e.kind]} ${signed(e.qtyDelta)} (${br(e.date)})`)),
    toReview: p.toReview.map(t => `${t.movimentacao} ${t.produto.split(' - ')[0]} (${br(t.date)})`),
  }
}
