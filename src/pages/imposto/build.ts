// Lógica pura da tela de Imposto: agrupamento por ano, saldo de IRRF de dezembro, avisos e validação do pagamento.
import type { DarfRow } from '../../domain/darf'
import type { TaxMonth } from '../../domain/tax'
import type { Cents, DarfPayment, ISODate, Month, Warning } from '../../domain/types'
import { parseDate, parseMoney } from '../notas/build'

export interface ImpostoRow { tax: TaxMonth; darf: DarfRow }
export interface PaymentForm { paidAt: string; principal: string; total: string }

const desc = <T>(xs: T[], key: (x: T) => string) => [...xs].sort((a, b) => (key(a) < key(b) ? 1 : -1))

// tax e darfs vêm alinhados por mês (computeDarfs mapeia derived.tax 1:1).
export function groupByYear(tax: TaxMonth[], darfs: DarfRow[]): { year: string; rows: ImpostoRow[] }[] {
  const byMonth = new Map(darfs.map(d => [d.month, d]))
  const by = new Map<string, ImpostoRow[]>()
  for (const t of tax) {
    const d = byMonth.get(t.month)
    if (d) by.set(t.month.slice(0, 4), [...(by.get(t.month.slice(0, 4)) ?? []), { tax: t, darf: d }])
  }
  return desc([...by].map(([year, rows]) => ({ year, rows: desc(rows, r => r.tax.month) })), g => g.year)
}

// Saldo de IRRF que sobrou em dezembro (comum + FII): vai para a declaração. Só anos que têm dezembro apurado.
export const irrfToDeclare = (tax: TaxMonth[]): { year: string; cents: Cents }[] =>
  desc(tax.filter(t => t.month.endsWith('-12')).map(t => ({ year: t.month.slice(0, 4), cents: t.comum.irrfCarryOutCents + t.fii.irrfCarryOutCents })), x => x.year)

export function lastDayOfMonth(m: Month): ISODate {
  const [y, mo] = m.split('-').map(Number)
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`
}

export const dayTradeMonths = (ws: Warning[]): Set<Month> =>
  new Set(ws.filter(w => w.kind === 'day_trade').map(w => w.date.slice(0, 7)))

export function buildPayment(month: Month, f: PaymentForm): DarfPayment {
  const paidAt = parseDate(f.paidAt, 'Data do pagamento')
  const principalCents = parseMoney(f.principal, 'Principal')
  const totalPaidCents = parseMoney(f.total, 'Total pago')
  if (totalPaidCents < principalCents) throw new Error('Total pago: não pode ser menor que o principal.')
  return { month, paidAt, principalCents, totalPaidCents }
}
