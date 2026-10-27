import { darfDueDate } from './calendar'
import type { TaxMonth } from './tax'
import type { Cents, DarfPayment, ISODate, Month } from './types'

export type DarfStatus = 'sem_imposto' | 'acumulado' | 'a_vencer' | 'em_aberto' | 'pago' | 'pago_a_menor'
export interface DarfRow {
  month: Month; taxCents: Cents /* comum + fii a pagar no mês */; accumulatedCents: Cents
  darfCents: Cents /* 0 quando acumula */; dueDate: ISODate | null; status: DarfStatus; payment: DarfPayment | null
  complementCents: Cents /* darfCents − principal pago, quando pago a menor */; incomplete: boolean /* herdado do TaxMonth */
}
export interface DarfResult { rows: DarfRow[]; orphanPayments: DarfPayment[] /* pagamento num mês que hoje não tem DARF (o acúmulo mudou) */; openCents: Cents; openIncompleteCents: Cents }

export const DARF_CODE = '6015'
const MIN_DARF_CENTS = 1000

export function computeDarfs(months: TaxMonth[], payments: DarfPayment[], today: ISODate): DarfResult {
  let pending = 0
  const rows = months.map((m): DarfRow => {
    const taxCents = m.comum.taxPayableCents + m.fii.taxPayableCents
    const accumulatedCents = taxCents + pending
    const row = { month: m.month, taxCents, accumulatedCents, incomplete: m.incomplete, payment: null, complementCents: 0 }
    if (accumulatedCents < MIN_DARF_CENTS) {
      pending = accumulatedCents
      return { ...row, darfCents: 0, dueDate: null, status: accumulatedCents === 0 ? 'sem_imposto' : 'acumulado' }
    }
    pending = 0
    const dueDate = darfDueDate(m.month)
    const payment = payments.find((p) => p.month === m.month) ?? null
    const complementCents = payment ? Math.max(accumulatedCents - payment.principalCents, 0) : 0
    const status: DarfStatus = payment ? (complementCents > 0 ? 'pago_a_menor' : 'pago') : today <= dueDate ? 'a_vencer' : 'em_aberto'
    return { ...row, darfCents: accumulatedCents, dueDate, status, payment, complementCents }
  })
  const withDarf = new Set(rows.filter((r) => r.darfCents > 0).map((r) => r.month))
  const open = (incomplete: boolean) => rows
    .filter((r) => r.incomplete === incomplete && (r.status === 'em_aberto' || r.status === 'pago_a_menor'))
    .reduce((a, r) => a + (r.status === 'em_aberto' ? r.darfCents : r.complementCents), 0)
  return {
    rows,
    orphanPayments: payments.filter((p) => !withDarf.has(p.month)),
    openCents: open(false),
    openIncompleteCents: open(true),
  }
}
