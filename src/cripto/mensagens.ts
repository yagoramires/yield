import { errText } from '../domain/text'
import { BinanceError } from './binance'

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
  if (r.missing.length) parts.push(r.failed.length
    ? `Sem compra no histórico lido: ${r.missing.join(', ')} (alguma fonte não foi lida; tente de novo antes de informar à mão).`
    : `Sem compra no histórico: ${r.missing.join(', ')} (informe à mão).`)
  const fail = historyFailText(r.failed)
  if (fail) parts.push(fail)
  return parts.join(' ')
}
