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

// Digitação do usuário (quantidade decimal): '0,01' e '0.01' são decimais; '1.000' e '1.234.567' são milhar.
// Regra: com vírgula, vale pt-BR; sem vírgula, um único '.' seguido de ≠ 3 dígitos é ponto decimal.
export function parseDecimal(v: string): number {
  const t = v.trim()
  if (!t || !/^(\d+(\.\d+)*)?(,\d+)?$/.test(t)) throw new Error(`Número inválido: "${v}"`)
  if (t.includes(',')) return brNumber(t.replace(/\./g, ''))
  return /^\d+\.\d+$/.test(t) && !/\.\d{3}$/.test(t) ? Number(t) : Number(t.replace(/\./g, ''))
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
