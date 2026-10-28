// Lógica pura da tela de Imposto: agrupamento por ano, saldo de IRRF de dezembro, avisos e validação do pagamento.
import type { DarfRow } from '../../domain/darf'
import type { OpeningLoss, TaxMonth } from '../../domain/tax'
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

// Avisos do mês que explicam o "incompleto": venda maior que a posição e evento sem posição.
export const incompleteWarnings = (ws: Warning[], m: Month): Warning[] =>
  ws.filter(w => (w.kind === 'venda_maior_que_posicao' || w.kind === 'evento_sem_posicao') && w.date.startsWith(m))

export interface OpeningLossForm { month: string /* mm/aaaa */; comum: string; fii: string }

export function buildOpeningLoss(f: OpeningLossForm, now = new Date()): OpeningLoss {
  const m = /^(\d{2})\/(\d{4})$/.exec(f.month.trim())
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) throw new Error('Mês: use mm/aaaa, por exemplo 01/2019.')
  // a apuração vai só até o mês atual: prejuízo de um mês futuro nunca entraria na conta
  if (`${m[2]}-${m[1]}` > `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`) throw new Error('Mês: o prejuízo inicial não pode ser de um mês futuro.')
  // campo vazio = não informado (fica o prejuízo calculado daquele lado); zero digitado zera
  const read = (t: string, what: string) => (t.trim() ? parseMoney(t, what, false) : null)
  const comumCents = read(f.comum, 'Prejuízo comum'), fiiCents = read(f.fii, 'Prejuízo FII')
  if (!comumCents && !fiiCents) throw new Error('Informe o valor do prejuízo comum, de FII ou dos dois.')
  return { month: `${m[2]}-${m[1]}`, comumCents, fiiCents }
}

export function buildPayment(month: Month, f: PaymentForm): DarfPayment {
  const paidAt = parseDate(f.paidAt, 'Data do pagamento')
  const principalCents = parseMoney(f.principal, 'Principal')
  const totalPaidCents = parseMoney(f.total, 'Total pago')
  if (totalPaidCents < principalCents) throw new Error('Total pago: não pode ser menor que o principal.')
  return { month, paidAt, principalCents, totalPaidCents }
}

const isOpen = (r: DarfRow) => r.status === 'em_aberto' || r.status === 'pago_a_menor'
// Mesma regra de computeDarfs: openCents exclui meses incompletos, openIncompleteCents só conta eles.
export const openCounts = (rows: DarfRow[]) => ({
  complete: rows.filter(r => isOpen(r) && !r.incomplete).length,
  incomplete: rows.filter(r => isOpen(r) && r.incomplete).length,
})

// Prejuízo comum e de FII nunca se compensam entre si: sempre separados (positivos).
export const lossCarry = (t: TaxMonth): { comum: Cents; fii: Cents } => ({ comum: Math.abs(t.comum.lossOutCents), fii: Math.abs(t.fii.lossOutCents) })

// Mês isento = o lucro de ações foi isentado (vendas <= R$ 20 mil e lucro > 0, ver computeTax).
export const exemptSales = (tax: TaxMonth[], year: string): Cents =>
  tax.filter(t => t.month.startsWith(year) && t.comum.exemptProfitCents > 0).reduce((a, t) => a + t.stockSalesCents, 0)

export const isEmptyMonth = (r: ImpostoRow): boolean =>
  r.tax.stockSalesCents === 0 && r.tax.comum.resultCents === 0 && r.tax.fii.resultCents === 0 && r.darf.darfCents === 0 && !r.darf.payment
