import { isMasked } from '../domain/money'

export interface MoneyToken { raw: string; kind: 'brl' | 'pct'; value: number /* brl em centavos */; decimals: number }

const NUM = String.raw`(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?`
const BRL = String.raw`[-−]?R\$[\s ]?[-−]?${NUM}(?:\s(?:mil|milhão|milhões)\b)?`
const PCT = String.raw`[-−+]?${NUM}\s?%`
const TOKEN = new RegExp(`${BRL}|${PCT}`, 'g')
const BRL_ONLY = new RegExp(BRL, 'g')

function parse(raw: string): MoneyToken {
  const num = raw.match(new RegExp(NUM))![0]
  const [int, dec = ''] = num.split(',')
  const n = Number(`${int.replace(/\./g, '')}.${dec || '0'}`) * (/[-−]/.test(raw) ? -1 : 1)
  if (raw.endsWith('%')) return { raw, kind: 'pct', value: n, decimals: dec.length }
  const mult = /milh/.test(raw) ? 1e6 : /mil\b/.test(raw) ? 1e3 : 1
  return { raw, kind: 'brl', value: Math.round(n * mult * 100), decimals: mult > 1 ? 0 : dec.length }
}

/** Valores em R$ e % de um texto, na ordem em que aparecem. */
export const moneyTokens = (text: string): MoneyToken[] => [...text.matchAll(TOKEN)].map(m => parse(m[0]))

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

/**
 * Os valores de `text` que não saíram de nenhuma `sources` (fatos ou resultados de ferramenta). Sinal não conta ("gastou R$ 10"
 * vale para −R$ 10); sem centavos aceita o valor arredondado ou truncado para reais; % aceita a fonte arredondada para as casas escritas.
 */
export function unverified(text: string, sources: string[]): string[] {
  const src = sources.flatMap(moneyTokens)
  const ok = (t: MoneyToken) => src.some(s => {
    if (s.kind !== t.kind) return false
    const [a, b] = [Math.abs(s.value), Math.abs(t.value)]
    if (t.kind === 'pct') return round(a, t.decimals) === b
    return Math.abs(a - b) < 1 || (t.decimals === 0 && Math.abs(a - b) < 100)
  })
  return moneyTokens(text).filter(t => !ok(t)).map(t => t.raw)
}

/** Com o olhinho ligado, os valores em R$ do texto da IA viram bolinhas, como no resto do app. */
export const maskMoney = (text: string): string => (isMasked() ? text.replace(BRL_ONLY, 'R$ •••••') : text)
