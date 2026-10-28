import { BinanceError } from '../../cripto/binance'
import type { Db } from '../../db/client'
import { applySource, DEFAULT_PJ, saveSource, type IncomeSource, type SourceKind } from '../../db/orcamentoRepo'
import { cltNet, pjNet, sourceNet } from '../../domain/orcamento'
import type { AssetType, Dividend, Month, Trade } from '../../domain/types'
import { typeFromName, type B3Import, type importB3 } from '../../import/b3'
import type { InvestmentCounts } from '../../openfinance/sync'
import { parseMoney } from '../notas/build'

type B3Result = Awaited<ReturnType<typeof importB3>>

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

/** Junta os relatórios escolhidos de uma vez num só import. */
export const mergeB3 = (list: B3Import[]): B3Import => ({
  trades: list.flatMap(p => p.trades), names: Object.assign({}, ...list.map(p => p.names)), dividends: list.flatMap(p => p.dividends), events: list.flatMap(p => p.events),
  ignored: list.reduce((s, p) => s + p.ignored, 0), toReview: list.flatMap(p => p.toReview), checks: list.flatMap(p => p.checks), sales: list.flatMap(p => p.sales), subscriptions: list.flatMap(p => p.subscriptions),
  rfMoves: list.flatMap(p => p.rfMoves), rfPositions: list.flatMap(p => p.rfPositions), issuers: list.flatMap(p => p.issuers),
})

type TickerType = { ticker: string; type: AssetType }

/**
 * Tickers final 11 ainda sem operação podem ser FII, ETF ou unit. O tipo sai do nome do produto nos relatórios
 * (Proventos, Movimentação) ou dos proventos já conhecidos (Rendimento → FII; Dividendo/JCP → unit).
 * Sem nenhum provento, com proventos conhecidos, quase sempre é ETF (FII paga todo mês).
 * `ask` é o que sobra para o usuário escolher; `inferred` já vem resolvido.
 */
export function typesToConfirm(p: B3Import, existing: Trade[], dividends: Pick<Dividend, 'ticker' | 'kind'>[] = []): { ask: TickerType[]; inferred: TickerType[] } {
  const known = new Set(existing.map(t => t.ticker))
  const kinds = new Map<string, Set<string>>()
  for (const d of [...dividends, ...p.dividends]) kinds.set(d.ticker, (kinds.get(d.ticker) ?? new Set()).add(d.kind))
  const byKind = (t: string): AssetType | null => {
    const k = kinds.get(t)
    return !k ? null : k.has('Dividendo') || k.has('JCP') ? 'Ação' : 'FII'
  }
  const out = { ask: [] as TickerType[], inferred: [] as TickerType[] }
  const given = new Map(p.trades.flatMap(t => (t.assetType ? [[t.ticker, t.assetType] as const] : [])))
  for (const ticker of [...new Set(p.trades.map(t => t.ticker))].filter(t => !known.has(t) && /11$/.test(t)).sort()) {
    if (given.has(ticker)) { out.inferred.push({ ticker, type: given.get(ticker)! }); continue }
    const type = (p.names[ticker] && typeFromName(p.names[ticker])) || byKind(ticker)
    if (type) out.inferred.push({ ticker, type })
    else out.ask.push({ ticker, type: kinds.size ? 'ETF' : 'FII' })
  }
  return out
}

/** Tipo de cada ticker: o que já está nas operações vale; depois, o deduzido ou confirmado na tela. */
export function typeMap(existing: Trade[], confirmed: TickerType[]): Map<string, AssetType> {
  return new Map([...confirmed.map(c => [c.ticker, c.type] as const), ...existing.map(t => [t.ticker, t.assetType] as const)])
}

export function b3Summary(r: B3Result, p: Pick<B3Import, 'ignored' | 'toReview'>) {
  const counts = [
    ...(r.trades || r.notesSkipped || r.tradesSkipped ? [`${n(r.trades, 'operação', 'operações')} em ${n(r.notes, 'dia', 'dias')}`] : []),
    ...(r.notesSkipped ? [`${n(r.notesSkipped, 'dia já existia', 'dias já existiam')}`] : []),
    ...(r.tradesSkipped ? [`${n(r.tradesSkipped, 'operação já estava numa nota', 'operações já estavam em notas')}`] : []),
    n(r.dividends, 'provento', 'proventos'), ...(r.replaced ? [`${r.replaced} substituíram os da planilha`] : []), `${r.dividendsSkipped} já existiam`,
    ...(r.eventsSkipped ? [r.eventsSkipped === 1 ? '1 evento já existia' : `${r.eventsSkipped} eventos já existiam`] : []),
    ...(r.sales ? [`${n(r.sales, 'leilão de fração lançado como venda', 'leilões de fração lançados como venda')}`] : []),
    ...(r.checked ? [`${n(r.checked, 'posição conferida com a B3', 'posições conferidas com a B3')}`] : []),
    ...(r.rfMoves.inserted || r.rfMoves.skipped ? [n(r.rfMoves.inserted, 'movimentação de renda fixa', 'movimentações de renda fixa'), ...(r.rfMoves.skipped ? [n(r.rfMoves.skipped, 'já existia', 'já existiam')] : [])] : []),
    ...(r.rfPositions.updated || r.rfPositions.older ? [n(r.rfPositions.updated, 'título de renda fixa atualizado', 'títulos de renda fixa atualizados'), ...(r.rfPositions.older ? [n(r.rfPositions.older, 'de uma Posição mais antiga ignorado', 'de uma Posição mais antiga ignorados')] : [])] : []),
    ...(r.issuers ? [n(r.issuers, 'empresa no cadastro do IR', 'empresas no cadastro do IR')] : []),
    ...(p.ignored ? [`${n(p.ignored, 'movimentação ignorada', 'movimentações ignoradas')} (liquidações e frações; as compras e vendas vêm do relatório de Negociação)`] : []),
  ]
  return {
    counts: counts.join(' · '),
    applied: r.applied.map(e => (e.kind === 'mudanca_ticker' ? `${e.ticker} → ${e.newTicker} (${br(e.date)})` : `${e.ticker} ${KIND[e.kind]} ${signed(e.qtyDelta)} (${br(e.date)})`)),
    toReview: [...p.toReview, ...r.review].map(t => `${t.movimentacao} ${t.produto.split(' - ')[0]} (${br(t.date)})${t.nota ? `: ${t.nota}` : ''}`),
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

export const investmentLine = (c: InvestmentCounts) => c.found
  ? `${c.label}: ${n(c.inserted, 'operação nova', 'operações novas')}, ${n(c.updated, 'atualizada com taxas', 'atualizadas com taxas')}, ${n(c.existing, 'já existia', 'já existiam')}`
  : `${c.label}: nenhum investimento de renda variável na Pluggy`

/** Avisos aparecem em lista própria na tela; aqui só as contagens. */
export function orcamentoImportSummary(r: { months: number; lines: number; skipped: number }): string {
  return [n(r.months, 'mês', 'meses'), n(r.lines, 'linha', 'linhas'), `${r.skipped} já existiam`].join(' · ')
}

export interface SourceForm { name: string; kind: SourceKind; gross: string; proLabore: string; irpj: string; inss: string; contabilidade: string; outros: string; net: string; dependents: string; das: string }

const pct = (text: string): number => {
  const t = text.trim().replace(',', '.')
  const x = /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN
  if (!(x >= 0 && x <= 100)) throw new Error('Percentual inválido: use um número entre 0 e 100')
  return x
}

export function validateSource(f: SourceForm): Omit<IncomeSource, 'id' | 'sourceKey'> {
  const name = f.name.trim()
  if (!name) throw new Error('Dê um nome para a fonte')
  if (f.kind === 'fixo') return { name, kind: 'fixo', grossCents: null, netCents: parseMoney(f.net, 'Líquido'), ...DEFAULT_PJ, dependents: 0 }
  if (f.kind === 'clt') {
    const d = f.dependents.trim()
    if (d && !(/^\d+$/.test(d) && Number(d) <= 30)) throw new Error('Dependentes: use um número inteiro de 0 a 30')
    const grossCents = parseMoney(f.gross, 'Bruto'), outrosCents = parseMoney(f.outros, 'Outros descontos', false), dependents = Number(d || 0)
    if (cltNet(grossCents, dependents, outrosCents).netCents <= 0) throw new Error('O líquido ficou negativo: confira os descontos')
    return { name, kind: 'clt', grossCents, netCents: null, ...DEFAULT_PJ, outrosCents, dependents }
  }
  if (f.kind === 'mei') {
    const grossCents = parseMoney(f.gross, 'Bruto'), dasCents = parseMoney(f.das, 'DAS do mês'), outrosCents = parseMoney(f.outros, 'Outros descontos', false)
    const cfg = { proLaborePct: 0, irpjPct: 0, inssPct: 0, contabilidadeCents: 0, outrosCents, dasCents }
    if (pjNet(grossCents, cfg).netCents <= 0) throw new Error('O líquido ficou negativo: confira os descontos')
    return { name, kind: 'mei', grossCents, netCents: null, ...cfg, dependents: 0 }
  }
  const cfg = { dasCents: 0, proLaborePct: pct(f.proLabore), irpjPct: pct(f.irpj), inssPct: pct(f.inss), contabilidadeCents: parseMoney(f.contabilidade, 'Contabilidade', false), outrosCents: parseMoney(f.outros, 'Outros descontos', false) }
  const grossCents = parseMoney(f.gross, 'Bruto')
  if (pjNet(grossCents, cfg).netCents <= 0) throw new Error('O líquido ficou negativo: confira os descontos')
  return { name, kind: 'pj', grossCents, netCents: null, ...cfg, dependents: 0 }
}

/** Salva a fonte e recalcula as entradas a partir de `fromMonth`; devolve quantas mudaram. */
export async function saveSourceForm(db: Db, v: ReturnType<typeof validateSource>, editing: IncomeSource | null, fromMonth: Month, onSaved: (s: IncomeSource) => void): Promise<number> {
  const sourceKey = editing?.sourceKey ?? null
  const s = { ...v, id: await saveSource(db, { ...v, ...(editing ? { id: editing.id } : {}), sourceKey }), sourceKey }
  onSaved(s) // antes do applySource: se ele falhar, o próximo Salvar edita esta fonte em vez de criar outra
  return applySource(db, s.id, fromMonth, sourceNet(s, fromMonth))
}

/** Senha do backup: mínimo de 8 caracteres e confirmação igual. */
export function backupPasswordError(password: string, confirm: string): string | null {
  if (password.length < 8) return 'Use uma senha com pelo menos 8 caracteres.'
  if (password !== confirm) return 'As duas senhas não são iguais.'
  return null
}

export function binanceErrorText(e: unknown): string {
  if (e instanceof BinanceError && e.kind === 'chave') return 'Binance: chave inválida ou sem permissão de leitura'
  if (e instanceof BinanceError && e.kind === 'rede') return 'Sem conexão com a Binance'
  return `Binance: ${errText(e)}`
}

/** Fontes do histórico da Binance que ficaram de fora do aportado calculado. */
export function historyFailText(failed: { source: string; error: unknown }[]): string | null {
  const why = (e: unknown) => (e instanceof BinanceError && e.kind === 'chave' ? 'a chave não tem acesso' : e instanceof BinanceError && e.kind === 'rede' ? 'sem conexão' : errText(e))
  return failed.length ? `Não lido: ${failed.map(f => `${f.source} (${why(f.error)})`).join('; ')}.` : null
}

/** Resumo da busca do aportado na Binance: o que achou em cada fonte e o que ficou sem histórico. */
export function costSummaryText(r: { failed: { source: string; error: unknown }[]; found: Record<string, number>; computed: string[]; missing: string[] }): string {
  const total = Object.values(r.found).reduce((s, n) => s + n, 0)
  const parts = [total ? `Histórico da Binance: ${Object.entries(r.found).map(([src, n]) => `${n} ${src}`).join(', ')}.` : 'Histórico da Binance: nenhuma compra encontrada.']
  if (r.computed.length) parts.push(`Aportado calculado: ${r.computed.join(', ')}.`)
  if (r.missing.length) parts.push(`Sem compra no histórico: ${r.missing.join(', ')} (informe à mão).`)
  const fail = historyFailText(r.failed)
  if (fail) parts.push(fail)
  return parts.join(' ')
}
