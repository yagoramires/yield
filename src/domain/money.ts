import type { Cents, ISODate, Month } from './types'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

// A saída do Intl traz espaço sem quebra (U+00A0) após "R$".
export const formatBRL = (c: Cents): string => brl.format(c / 100)

export const monthOf = (d: ISODate): Month => d.slice(0, 7)

export function addMonths(m: Month, n: number): Month {
  const t = Number(m.slice(0, 4)) * 12 + (Number(m.slice(5, 7)) - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

export function monthsBetween(from: Month, to: Month): Month[] {
  const out: Month[] = []
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m)
  return out
}

const num = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const formatCents = (c: Cents): string => num.format(c / 100)
