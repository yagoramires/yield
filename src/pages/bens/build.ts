import type { Possession, PossessionKind } from '../../db/bensRepo'
import { DEFAULT_REMINDERS, remindersGroup } from '../../domain/bens'
import { editCents } from '../../domain/money'
import type { ISODate } from '../../domain/types'
import { parseDate, parseMoney } from '../notas/build'

export interface ReminderForm { name: string; date: string /* dd/mm */; amount: string }
export interface BemForm {
  kind: PossessionKind; name: string; details: string; boughtAt: string; cost: string; value: string
  financed: boolean; down: string; installment: string; total: string; first: string /* mm/aaaa */; debt: string
  categoryIds: string[]; reminders: ReminderForm[]
}

const two = (n: number) => String(n).padStart(2, '0')
const remindersOf = (k: PossessionKind): ReminderForm[] => DEFAULT_REMINDERS[remindersGroup(k)].map(r => ({ name: r.name, date: `${two(r.day)}/${two(r.month)}`, amount: '' }))

export const newBemForm = (kind: PossessionKind = 'veiculo'): BemForm => ({
  kind, name: '', details: '', boughtAt: '', cost: '', value: '', financed: false, down: '', installment: '', total: '', first: '', debt: '', categoryIds: [], reminders: remindersOf(kind),
})

/** Trocar o tipo troca os vencimentos sugeridos, mas só se a pessoa ainda não mexeu neles. */
export function changeKind(f: BemForm, kind: PossessionKind): BemForm {
  const untouched = JSON.stringify(f.reminders) === JSON.stringify(remindersOf(f.kind))
  return { ...f, kind, reminders: untouched ? remindersOf(kind) : f.reminders }
}

const money = (c: number | null) => (c == null ? '' : editCents(c))
export const toBemForm = (p: Possession): BemForm => ({
  kind: p.kind, name: p.name, details: p.details ?? '', boughtAt: p.boughtAt, cost: money(p.costCents), value: money(p.valueCents),
  financed: p.installmentCents != null, down: money(p.downPaymentCents), installment: money(p.installmentCents), total: p.installmentsTotal == null ? '' : String(p.installmentsTotal),
  first: p.firstInstallment ? `${p.firstInstallment.slice(5, 7)}/${p.firstInstallment.slice(0, 4)}` : '', debt: money(p.debtCents),
  categoryIds: p.categoryIds, reminders: p.reminders.map(r => ({ name: r.name, date: `${two(r.day)}/${two(r.month)}`, amount: money(r.amountCents) })),
})

const optMoney = (t: string, what: string) => (t.trim() ? parseMoney(t, what) : null)

/** Formulário → bem; `prev` mantém a data do "vale hoje" quando o valor não mudou. Erros em pt-BR, prontos para a tela. */
export function validateBem(f: BemForm, today: ISODate, prev?: Possession): Omit<Possession, 'id'> {
  const name = f.name.trim()
  if (!name) throw new Error('Nome: informe um nome para o bem (ex.: Onix 2024, Apartamento Centro).')
  const boughtAt = parseDate(f.boughtAt, 'Data da compra')
  if (boughtAt > today) throw new Error('Data da compra: não pode ser depois de hoje.')
  const costCents = parseMoney(f.cost, 'Valor da compra')
  const valueCents = optMoney(f.value, 'Vale hoje')
  const valueAt = valueCents == null ? null : prev && prev.valueCents === valueCents && prev.valueAt ? prev.valueAt : today

  let fin: Pick<Possession, 'downPaymentCents' | 'installmentCents' | 'installmentsTotal' | 'firstInstallment' | 'debtCents'> = { downPaymentCents: null, installmentCents: null, installmentsTotal: null, firstInstallment: null, debtCents: null }
  if (f.financed) {
    const total = Number(f.total.trim())
    if (!Number.isInteger(total) || total < 1 || total > 600) throw new Error('Número de parcelas: informe um número inteiro, por exemplo 48.')
    const m = f.first.trim().match(/^(\d{1,2})\/(\d{4})$/)
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) throw new Error('Primeira parcela: use mês/ano, por exemplo 04/2026.')
    fin = { downPaymentCents: optMoney(f.down, 'Entrada'), installmentCents: parseMoney(f.installment, 'Parcela'), installmentsTotal: total, firstInstallment: `${m[2]}-${two(Number(m[1]))}`, debtCents: optMoney(f.debt, 'Saldo devedor') }
  }

  const reminders = f.reminders.filter(r => r.name.trim() || r.date.trim() || r.amount.trim()).map(r => {
    const what = r.name.trim() || 'Vencimento'
    if (!r.name.trim()) throw new Error('Vencimento: dê um nome (ex.: IPVA, Seguro).')
    const d = r.date.trim().match(/^(\d{1,2})\/(\d{1,2})$/)
    if (!d || Number(d[1]) < 1 || Number(d[1]) > 31 || Number(d[2]) < 1 || Number(d[2]) > 12) throw new Error(`${what}: use dia/mês, por exemplo 10/01.`)
    return { name: r.name.trim(), day: Number(d[1]), month: Number(d[2]), amountCents: optMoney(r.amount, what) }
  })

  return { kind: f.kind, name, details: f.details.trim() || null, boughtAt, costCents, valueCents, valueAt, ...fin, categoryIds: f.categoryIds, reminders }
}
