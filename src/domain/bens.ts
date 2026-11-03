import type { Category, Txn } from '../db/gastosRepo'
import type { Possession, PossessionKind, Reminder } from '../db/bensRepo'
import { addMonths, monthOf, plainBRL } from './money'
import type { Cents, ISODate, Month } from './types'

// shortcut: grupos e códigos da ficha Bens e Direitos do IRPF 2026; conferir no programa da Receita a cada ano.
export const KIND: Record<PossessionKind, { label: string; icon: string; grupo: string; codigo: string; ir: string; imovel: boolean }> = {
  apartamento: { label: 'Apartamento', icon: 'house', grupo: '01', codigo: '11', ir: '01 – Bens imóveis / 11 – Apartamento', imovel: true },
  casa: { label: 'Casa', icon: 'house', grupo: '01', codigo: '12', ir: '01 – Bens imóveis / 12 – Casa', imovel: true },
  terreno: { label: 'Terreno', icon: 'house', grupo: '01', codigo: '13', ir: '01 – Bens imóveis / 13 – Terreno', imovel: true },
  imovel: { label: 'Outro imóvel', icon: 'house', grupo: '01', codigo: '19', ir: '01 – Bens imóveis / 19 – Outros bens imóveis', imovel: true },
  veiculo: { label: 'Veículo', icon: 'car', grupo: '02', codigo: '01', ir: '02 – Bens móveis / 01 – Veículo automotor terrestre: caminhão, automóvel, moto etc.', imovel: false },
  outro: { label: 'Outro bem', icon: 'package', grupo: '02', codigo: '99', ir: '02 – Bens móveis / 99 – Outros bens móveis', imovel: false },
}

// ponto de partida ao cadastrar: a data muda por estado e cidade, a pessoa ajusta
export const DEFAULT_REMINDERS: Record<'imovel' | 'veiculo' | 'outro', Reminder[]> = {
  imovel: [{ name: 'IPTU', day: 10, month: 2, amountCents: null }],
  veiculo: [{ name: 'IPVA', day: 10, month: 1, amountCents: null }, { name: 'Licenciamento', day: 10, month: 3, amountCents: null }],
  outro: [],
}
export const remindersGroup = (k: PossessionKind) => (KIND[k].imovel ? 'imovel' : k === 'veiculo' ? 'veiculo' : 'outro')

const idx = (m: Month) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
export const brDate = (d: ISODate) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

export const isFinanced = (p: Possession) => p.installmentCents != null && p.installmentsTotal != null && p.firstInstallment != null
export const lastInstallment = (p: Possession): Month | null => (isFinanced(p) ? addMonths(p.firstInstallment!, p.installmentsTotal! - 1) : null)

/** Número da parcela que cai no mês (1…total), ou null fora do financiamento. */
export function installmentOf(p: Possession, month: Month): number | null {
  if (!isFinanced(p)) return null
  const n = idx(month) - idx(p.firstInstallment!) + 1
  return n >= 1 && n <= p.installmentsTotal! ? n : null
}

/** Parcelas que vencem do mês em diante (contando a do mês). */
export function remaining(p: Possession, month: Month): number {
  if (!isFinanced(p)) return 0
  return clamp(p.installmentsTotal! - (idx(month) - idx(p.firstInstallment!)), 0, p.installmentsTotal!)
}

/** Quanto falta pagar: o saldo devedor informado ou, sem ele, parcela × restantes (com os juros que ainda vão correr). */
export function debtOf(p: Possession, month: Month): { cents: Cents; estimated: boolean } {
  const left = remaining(p, month)
  if (!left) return { cents: 0, estimated: false }
  return p.debtCents != null ? { cents: p.debtCents, estimated: false } : { cents: p.installmentCents! * left, estimated: true }
}

export const valueOf = (p: Possession): Cents => p.valueCents ?? p.costCents

export interface Patrimonio { investCents: Cents; contasCents: Cents; bensCents: Cents; dividasCents: Cents; totalCents: Cents }
export function patrimonio(bens: Possession[], investCents: Cents, contasCents: Cents, month: Month): Patrimonio {
  const bensCents = bens.reduce((s, p) => s + valueOf(p), 0)
  const dividasCents = bens.reduce((s, p) => s + debtOf(p, month).cents, 0)
  return { investCents, contasCents, bensCents, dividasCents, totalCents: investCents + contasCents + bensCents - dividasCents }
}

/**
 * Gasto nas categorias do bem nos últimos 12 meses fechados (só os meses com lançamentos, para quem começou agora não ver a média diluída)
 * e o do mês atual até hoje.
 */
export function costsOf(p: Possession, txns: Txn[], cat: (t: Txn) => Category | null, today: ISODate): { totalCents: Cents; months: number; avgCents: Cents; thisMonthCents: Cents } {
  const cur = monthOf(today), ids = new Set(p.categoryIds)
  const first = txns.reduce<Month | null>((m, t) => (m === null || monthOf(t.date) < m ? monthOf(t.date) : m), null)
  const from = first && first > addMonths(cur, -12) ? first : addMonths(cur, -12)
  let totalCents = 0, thisMonthCents = 0
  if (ids.size) for (const t of txns) {
    if (t.amountCents >= 0 || !ids.has(cat(t)?.id ?? '')) continue
    const m = monthOf(t.date)
    if (m === cur) thisMonthCents -= t.amountCents
    else if (m >= from && m < cur) totalCents -= t.amountCents
  }
  const months = first ? Math.max(0, idx(cur) - idx(from)) : 0
  return { totalCents, months, avgCents: months ? Math.round(totalCents / months) : 0, thisMonthCents }
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const dateOf = (y: number, r: Reminder): ISODate => `${y}-${String(r.month).padStart(2, '0')}-${String(Math.min(r.day, daysIn(y, r.month))).padStart(2, '0')}`

/** Próximos vencimentos dos bens em até `days` dias (o de hoje entra), do mais perto ao mais longe. */
export function upcoming(bens: Possession[], today: ISODate, days = 60): { bem: Possession; reminder: Reminder; date: ISODate; inDays: number }[] {
  const y = Number(today.slice(0, 4)), t0 = Date.parse(`${today}T00:00:00Z`)
  return bens.flatMap(bem => bem.reminders.map(reminder => {
    const thisYear = dateOf(y, reminder)
    const date = thisYear >= today ? thisYear : dateOf(y + 1, reminder)
    return { bem, reminder, date, inDays: Math.round((Date.parse(`${date}T00:00:00Z`) - t0) / 86_400_000) }
  })).filter(u => u.inDays <= days).sort((a, b) => a.date.localeCompare(b.date) || a.bem.name.localeCompare(b.bem.name))
}

/**
 * Situação em 31/12 do ano para a ficha Bens e Direitos: custo de aquisição, não valor de mercado. Financiado entra pelo que já foi pago
 * (entrada + parcelas até dezembro); a dívida do financiamento do próprio bem não vai em Dívidas e Ônus. null: o bem ainda não era seu.
 */
export function irSituacao(p: Possession, year: number): { cents: Cents; paid: number } | null {
  if (Number(p.boughtAt.slice(0, 4)) > year) return null
  if (!isFinanced(p)) return { cents: p.costCents, paid: 0 }
  const paid = clamp(idx(`${year}-12`) - idx(p.firstInstallment!) + 1, 0, p.installmentsTotal!)
  return { cents: (p.downPaymentCents ?? 0) + p.installmentCents! * paid, paid }
}

export function irDiscriminacao(p: Possession, year: number): string {
  const s = irSituacao(p, year)
  const head = `${KIND[p.kind].label} ${p.name}${p.details ? ` - ${p.details}` : ''}. Adquirido em ${brDate(p.boughtAt)} por ${plainBRL(p.costCents)}`
  if (!isFinanced(p)) return `${head}, à vista.`
  const entrada = p.downPaymentCents ? `com entrada de ${plainBRL(p.downPaymentCents)} e ` : ''
  const first = `${p.firstInstallment!.slice(5, 7)}/${p.firstInstallment!.slice(0, 4)}`
  const paid = s ? `${p.downPaymentCents ? 'entrada e ' : ''}${s.paid} ${s.paid === 1 ? 'parcela' : 'parcelas'}` : ''
  return `${head}, ${entrada}financiamento em ${p.installmentsTotal} parcelas de ${plainBRL(p.installmentCents!)} a partir de ${first}. Valor pago até 31/12/${year}: ${plainBRL(s?.cents ?? 0)} (${paid}).`
}
