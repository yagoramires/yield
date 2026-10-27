import { DEFAULT_PJ, type IncomeSource, type SourceKind } from '../../db/orcamentoRepo'
import { pjNet } from '../../domain/orcamento'
import type { Dividend } from '../../domain/types'
import type { B3Import, importB3 } from '../../import/b3'
import type { importPlanilha, PlanilhaImport } from '../../import/planilha'
import { parseMoney } from '../notas/build'

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

export const refreshLine = (r: { ok: string[]; failed: string[] }) =>
  `${r.ok.length} ok · ${n(r.failed.length, 'falhou', 'falharam')}${r.failed.length ? ` (${r.failed.join(', ')})` : ''}`

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export interface RestoreSteps { checkpoint(): Promise<void>; close(): Promise<void>; swap(): Promise<string>; reopen(): Promise<void>; reload(): Promise<void> }

/** Troca o banco pelo backup. Qualquer falha com o banco fechado reabre; depois da troca, a mensagem sempre diz onde ficou a cópia de segurança. */
export async function restoreBackup(s: RestoreSteps): Promise<{ ok: boolean; message: string }> {
  let closed = false
  let safety: string | undefined
  try {
    await s.checkpoint()
    await s.close()
    closed = true
    safety = await s.swap()
    await s.reopen()
    closed = false
    await s.reload()
    return { ok: true, message: `Dados substituídos. A cópia de segurança dos dados anteriores está em ${safety}.` }
  } catch (e) {
    let message = safety ? `O backup foi aplicado, mas houve um erro depois (${errText(e)}).` : `Não foi possível importar o backup: ${errText(e)}`
    if (closed) {
      try { await s.reopen(); await s.reload() } catch (e2) { message += ` O banco não reabriu (${errText(e2)}): feche e abra o Yield.` }
    }
    if (safety) message += ` Seus dados anteriores estão em ${safety}.`
    return { ok: false, message }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** itemId da Pluggy é um UUID; minúsculo para não duplicar o mesmo banco por causa de caixa. */
export function parseItemId(text: string): string {
  const id = text.trim()
  if (!UUID.test(id)) throw new Error('itemId inválido: copie do painel da Pluggy')
  return id.toLowerCase()
}

/** Avisos aparecem em lista própria na tela; aqui só as contagens. */
export function orcamentoImportSummary(r: { months: number; lines: number; skipped: number }, sourceCreated: boolean): string {
  return [n(r.months, 'mês', 'meses'), n(r.lines, 'linha', 'linhas'), `${r.skipped} já existiam`, ...(sourceCreated ? ['1 fonte de renda PJ criada'] : [])].join(' · ')
}

export interface SourceForm { name: string; kind: SourceKind; gross: string; proLabore: string; irpj: string; inss: string; contabilidade: string; outros: string; net: string }

const pct = (text: string): number => {
  const t = text.trim().replace(',', '.')
  const x = /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN
  if (!(x >= 0 && x <= 100)) throw new Error('Percentual inválido: use um número entre 0 e 100')
  return x
}

export function validateSource(f: SourceForm): Omit<IncomeSource, 'id' | 'sourceKey'> {
  const name = f.name.trim()
  if (!name) throw new Error('Dê um nome para a fonte')
  if (f.kind === 'fixo') return { name, kind: 'fixo', grossCents: null, netCents: parseMoney(f.net, 'Líquido'), ...DEFAULT_PJ }
  const cfg = { proLaborePct: pct(f.proLabore), irpjPct: pct(f.irpj), inssPct: pct(f.inss), contabilidadeCents: parseMoney(f.contabilidade, 'Contabilidade', false), outrosCents: parseMoney(f.outros, 'Outros descontos', false) }
  const grossCents = parseMoney(f.gross, 'Bruto')
  if (pjNet(grossCents, cfg).netCents <= 0) throw new Error('O líquido ficou negativo: confira os descontos')
  return { name, kind: 'pj', grossCents, netCents: null, ...cfg }
}
