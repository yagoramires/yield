import type { Category, Txn } from '../db/gastosRepo'
import type { BudgetLine } from '../db/orcamentoRepo'
import type { Subscription } from './assinaturas'
import { normalizeDescription } from './gastos'
import { monthOf, monthsBetween } from './money'
import type { Cents, Month } from './types'

export interface Suggestion { key: string; reason: 'assinatura' | 'parcela'; name: string; amountCents: Cents; categoryId: string | null; installmentCurrent: number | null; installmentTotal: number | null; recurring: boolean }

export function suggestForMonth(month: Month, subscriptions: Subscription[], txns: Txn[], cat: (t: Txn) => Category | null, lines: BudgetLine[], dismissed: string[]): Suggestion[] {
  const out: Suggestion[] = []
  for (const s of subscriptions) {
    if (!s.active || (s.period === 'anual' && s.nextDate.slice(0, 7) !== month)) continue
    const desc = s.merchantKey.slice(s.merchantKey.indexOf('|') + 1)
    const last = txns.find(t => t.accountId === s.accountId && t.date === s.lastDate && normalizeDescription(t.description) === desc)
    out.push({ key: `sub:${s.merchantKey}@${month}`, reason: 'assinatura', name: s.name, amountCents: s.amountCents, categoryId: (last && cat(last)?.id) ?? null, installmentCurrent: null, installmentTotal: null, recurring: s.period !== 'anual' })
  }

  const groups = new Map<string, { t: Txn; n: number; total: number }>()
  for (const t of txns) {
    const m = t.installment?.match(/^(\d+)\/(\d+)$/)
    if (t.amountCents >= 0 || !m) continue
    const n = Number(m[1]), total = Number(m[2])
    if (total <= 1 || n < 1 || n > total) continue
    const key = `parc:${t.accountId}|${normalizeDescription(t.description)}|${total}|${Math.abs(t.amountCents)}`
    const g = groups.get(key)
    if (!g || n > g.n || (n === g.n && t.date > g.t.date)) groups.set(key, { t, n, total })
  }
  for (const [key, { t, n, total }] of groups) {
    const j = monthsBetween(monthOf(t.date), month).length - 1 // meses desde a última parcela vista
    if (j >= 1 && j <= total - n) out.push({ key: `${key}@${month}`, reason: 'parcela', name: t.description.trim(), amountCents: Math.abs(t.amountCents), categoryId: cat(t)?.id ?? null, installmentCurrent: n + j, installmentTotal: total, recurring: true })
  }

  const hidden = new Set([...dismissed, ...lines.filter(l => l.month === month && l.sourceKey).map(l => l.sourceKey!)])
  return out.filter(s => !hidden.has(s.key)).sort((a, b) => b.amountCents - a.amountCents || a.name.localeCompare(b.name))
}
