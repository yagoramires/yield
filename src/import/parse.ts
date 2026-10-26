import type { Cents, ISODate } from '../domain/types'

const blank = (v: unknown) => v == null || (typeof v === 'string' && /^[\s-]*$/.test(v))

// '1.234,56' → 1234.56 (pt-BR); `${n}e2` evita 1.005 * 100 = 100.49999…
// toFixed nunca usa notação exponencial (1e-14 → '0.000000'), o que quebraria o 'e2'.
function toCents(n: number): Cents { return Math.round(Number(`${n.toFixed(6)}e2`)) + 0 }

function brNumber(s: string): number {
  const n = Number(s.replace(/[^\d,-]/g, '').replace(',', '.'))
  if (Number.isNaN(n)) throw new Error(`Número inválido: "${s}"`)
  return n
}

export function parseQty(v: string | number | null | undefined): number {
  if (blank(v)) return 0
  return typeof v === 'number' ? v : brNumber(v!.replace(/\./g, ''))
}

// Digitação do usuário (quantidade decimal). Com vírgula: pt-BR. Sem vírgula, o ponto é decimal,
// exceto grupos de milhar (2+ pontos); '1.500' é ambíguo e é rejeitado.
export const AMBIGUOUS_MSG = 'Valor ambíguo: use vírgula para decimais (1,5) ou escreva sem ponto (1500).'
export function parseDecimal(v: string): number {
  const t = v.trim()
  const bad = () => new Error(`Número inválido: "${v}"`)
  if (t.includes(',')) {
    if (!/^(\d{1,3}(\.\d{3})*|\d+),\d+$/.test(t)) throw bad()
    return Number(t.replace(/\./g, '').replace(',', '.'))
  }
  if (/^\d+$/.test(t)) return Number(t)
  if (/^0\.\d+$/.test(t)) return Number(t)
  if (/^\d{1,3}(\.\d{3}){2,}$/.test(t)) return Number(t.replace(/\./g, ''))
  if (/^\d+\.\d{3}$/.test(t)) throw new Error(AMBIGUOUS_MSG)
  if (/^\d+\.(\d{1,2}|\d{4,})$/.test(t)) return Number(t)
  throw bad()
}

export function parseBRL(v: string | number | null | undefined): Cents {
  if (blank(v)) return 0
  if (typeof v === 'number') return toCents(v)
  const neg = /^\s*\(.*\)\s*$/.test(v!)
  const n = brNumber(v!.replace(/\./g, ''))
  return toCents(neg ? -Math.abs(n) : n)
}

export function parseBRDate(v: string | number): ISODate {
  if (typeof v === 'number') {
    // Serial do Excel: dias desde 1899-12-30; aritmética em UTC, sem fuso local.
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000).toISOString().slice(0, 10)
  }
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(v)
  if (!m) throw new Error(`Data inválida: "${v}"`)
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

const KNOWN_BROKERS = ['CLEAR', 'INTER', 'BTG']

export function normalizeBroker(v: string): string {
  const s = v.trim().replace(/\s+/g, ' ').toUpperCase()
  return KNOWN_BROKERS.find(b => s === b || s.startsWith(b + ' ')) ?? s
}
