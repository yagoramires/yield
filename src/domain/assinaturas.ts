import type { Category, Txn } from '../db/gastosRepo'
import type { Cents, ISODate } from './types'
import { normalizeDescription } from './gastos'

export interface Subscription { merchantKey: string; name: string /* descrição mais recente */; accountId: string; period: 'mensal' | 'anual'; amountCents: Cents /* positivo */; monthlyCents: Cents; yearlyCents: Cents; lastDate: ISODate; nextDate: ISODate; active: boolean; charges: number; previousAmountCents: Cents | null /* só quando a última cobrança subiu */ }

const DAY = 86_400_000
const ms = (d: ISODate) => Date.parse(`${d}T00:00:00Z`)
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

// soma meses no calendário, limitando ao último dia do mês de destino (31/01 + 1 mês = 28/02)
function addMonths(d: ISODate, n: number): ISODate {
  const [y, m, day] = d.split('-').map(Number)
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate()
  return iso(Date.UTC(y, m - 1 + n, Math.min(day, last)))
}

export function detectSubscriptions(txns: Txn[], cat: (t: Txn) => Category | null, dismissed: string[], today: ISODate): Subscription[] {
  const groups = new Map<string, Txn[]>()
  const pending = new Map<string, Txn[]>()
  for (const t of txns) {
    const c = cat(t)
    if (t.amountCents >= 0 || t.installment !== null || (c !== null && !c.countsAsSpending)) continue
    const norm = normalizeDescription(t.description)
    if (!norm) continue
    const key = `${t.accountId}|${norm}`
    if (dismissed.includes(key)) continue
    // pendente ainda pode mudar de valor ou sumir: não entra na detecção, só mostra que o mês já foi cobrado
    const into = t.pending ? pending : groups
    into.set(key, [...(into.get(key) ?? []), t])
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
    const before = g.length > 1 ? Math.abs(g[g.length - 2].amountCents) : null
    const charged = (pending.get(merchantKey) ?? []).filter(t => t.date > last.date && Math.abs(Math.abs(t.amountCents) - med) <= med * 0.15).map(t => t.date).sort().at(-1) ?? last.date
    const sinceLast = Math.round((ms(today) - ms(charged)) / DAY)
    out.push({
      merchantKey, name: last.description, accountId: last.accountId, period, amountCents,
      monthlyCents: period === 'mensal' ? amountCents : Math.round(amountCents / 12),
      yearlyCents: period === 'mensal' ? amountCents * 12 : amountCents,
      lastDate: charged,
      nextDate: addMonths(charged, period === 'anual' ? 12 : 1),
      active: sinceLast <= (period === 'mensal' ? 45 : 400), charges: g.length,
      previousAmountCents: before !== null && amountCents > before ? before : null,
    })
  }
  return out.sort((a, b) => b.monthlyCents - a.monthlyCents)
}
