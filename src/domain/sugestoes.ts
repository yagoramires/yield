import type { Category, Txn } from '../db/gastosRepo'
import type { BudgetLine } from '../db/orcamentoRepo'
import type { Possession } from '../db/bensRepo'
import { installmentOf } from './bens'
import type { Subscription } from './assinaturas'
import { displayName, normalizeDescription } from './gastos'
import { installmentIn, parcKey, purchaseOfKey, purchases, type Purchase } from './parcelas'
import type { Cents, ISODate, Month } from './types'

export interface Suggestion { key: string; reason: 'assinatura' | 'parcela'; name: string; amountCents: Cents; categoryId: string | null; installmentCurrent: number | null; installmentTotal: number | null; recurring: boolean }

export function suggestForMonth(month: Month, subscriptions: Subscription[], txns: Txn[], cat: (t: Txn) => Category | null, lines: BudgetLine[], dismissed: string[], bens: Possession[] = [], today: ISODate = `${month}-01`, ps: Purchase[] = purchases(txns, today)): Suggestion[] {
  const out: Suggestion[] = []
  for (const s of subscriptions) {
    if (!s.active || (s.period === 'anual' && s.nextDate.slice(0, 7) !== month)) continue
    const desc = s.merchantKey.slice(s.merchantKey.indexOf('|') + 1)
    const last = txns.find(t => t.accountId === s.accountId && t.date === s.lastDate && normalizeDescription(t.description) === desc)
    out.push({ key: `sub:${s.merchantKey}@${month}`, reason: 'assinatura', name: displayName(s.name), amountCents: s.amountCents, categoryId: (last && cat(last)?.id) ?? null, installmentCurrent: null, installmentTotal: null, recurring: s.period !== 'anual' })
  }

  // parcelas das compras ainda em aberto no cartão, só a partir do mês em que a parcela ainda não veio
  const byId = new Map(txns.map(t => [t.id, t]))
  for (const p of ps) {
    const n = installmentIn(p, month)
    if (!p.open || n === null || p.members.some(x => x.n >= n)) continue
    if (lines.some(l => l.month === month && purchaseOfKey([p], l.sourceKey)) || dismissed.some(k => k.endsWith(`@${month}`) && purchaseOfKey([p], k))) continue
    const last = byId.get(p.members.find(x => x.n === p.maxN)!.txnId)
    // a chave é a da parcela mais recente (sempre está em p.keys): a linha criada com ela esconde a sugestão nos meses seguintes
    out.push({ key: `${parcKey(p.accountId, normalizeDescription(p.name), p.total, p.amountCents)}@${month}`, reason: 'parcela', name: displayName(p.name), amountCents: p.amountCents, categoryId: (last && cat(last)?.id) ?? null, installmentCurrent: n, installmentTotal: p.total, recurring: true })
  }

  // parcela do financiamento de um bem cadastrado em Bens
  for (const b of bens) {
    const n = installmentOf(b, month)
    if (n !== null) out.push({ key: `bem:${b.id}@${month}`, reason: 'parcela', name: b.name, amountCents: b.installmentCents!, categoryId: null, installmentCurrent: n, installmentTotal: b.installmentsTotal, recurring: true })
  }

  const hidden = new Set([...dismissed, ...lines.filter(l => l.month === month && l.sourceKey).map(l => l.sourceKey!)])
  return out.filter(s => !hidden.has(s.key)).sort((a, b) => b.amountCents - a.amountCents || a.name.localeCompare(b.name))
}
