import type { Category, Txn } from '../db/gastosRepo'
import type { Cents, ISODate } from './types'
import { normalizeDescription } from './gastos'

export interface Subscription { merchantKey: string; name: string /* descrição mais recente */; accountId: string; period: 'mensal' | 'anual'; amountCents: Cents /* positivo */; monthlyCents: Cents; yearlyCents: Cents; lastDate: ISODate; nextDate: ISODate; active: boolean; charges: number }

const DAY = 86_400_000
const ms = (d: ISODate) => Date.parse(`${d}T00:00:00Z`)
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

function addYear(d: ISODate): ISODate {
  const [y, m, day] = d.split('-').map(Number)
  return iso(Date.UTC(y + 1, m - 1, m === 2 && day === 29 ? 28 : day))
}

export function detectSubscriptions(txns: Txn[], cat: (t: Txn) => Category | null, dismissed: string[], today: ISODate): Subscription[] {
  const groups = new Map<string, Txn[]>()
  for (const t of txns) {
    const c = cat(t)
    if (t.amountCents >= 0 || t.installment !== null || t.pending || (c !== null && !c.countsAsSpending)) continue
    const norm = normalizeDescription(t.description)
    if (!norm) continue
    const key = `${t.accountId}|${norm}`
    if (!dismissed.includes(key)) groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const out: Subscription[] = []
  for (const [merchantKey, g] of groups) {
    g.sort((a, b) => a.date.localeCompare(b.date))
    const intervals = g.slice(1).map((t, i) => Math.round((ms(t.date) - ms(g[i].date)) / DAY))
    const amounts = g.map(t => Math.abs(t.amountCents))
    const med = median(amounts)
    if (amounts.some(a => Math.abs(a - med) > med * 0.15)) continue
    const within = (lo: number, hi: number) => intervals.every(n => n >= lo && n <= hi)
    const period = g.length >= 3 && within(25, 35) ? 'mensal' : g.length >= 2 && within(350, 380) ? 'anual' : null
    if (!period) continue
    const last = g[g.length - 1]
    const amountCents = Math.abs(last.amountCents)
    const sinceLast = Math.round((ms(today) - ms(last.date)) / DAY)
    out.push({
      merchantKey, name: last.description, accountId: last.accountId, period, amountCents,
      monthlyCents: period === 'mensal' ? amountCents : Math.round(amountCents / 12),
      yearlyCents: period === 'mensal' ? amountCents * 12 : amountCents,
      lastDate: last.date,
      nextDate: period === 'anual' ? addYear(last.date) : iso(ms(last.date) + Math.round(median(intervals)) * DAY),
      active: sinceLast <= (period === 'mensal' ? 45 : 400), charges: g.length,
    })
  }
  return out.sort((a, b) => b.monthlyCents - a.monthlyCents)
}
