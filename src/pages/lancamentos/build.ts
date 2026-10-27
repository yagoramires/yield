import type { Account, Category, CategoryRule, GastosData, Txn } from '../../db/gastosRepo'
import { normalizeDescription, type MonthTotals } from '../../domain/gastos'
import { addMonths, monthOf } from '../../domain/money'
import type { Cents, ISODate, Month } from '../../domain/types'
import { SYNC_EVERY_MS } from '../../openfinance/sync'

type Cat = (t: Txn) => Category | null

export interface TxnFilter { accountKind: 'todas' | 'conta' | 'cartao'; categoryId: string | 'sem' | null; search: string }
export const NO_FILTER: TxnFilter = { accountKind: 'todas', categoryId: null, search: '' }

// Mesmo critério de monthTotals: sem categoria conta como gasto; entrada é o que conta como gasto ou é receita.
const isSpending = (t: Txn, c: Category | null) => t.amountCents < 0 && (c === null || c.countsAsSpending)
const counts = (t: Txn, c: Category | null) => c === null || c.countsAsSpending || (t.amountCents > 0 && c.id === 'receita')

export const daysInMonth = (m: Month) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()

export function filterTxns(txns: Txn[], accounts: Account[], cat: Cat, month: Month, f: TxnFilter): Txn[] {
  const kind = new Map(accounts.map(a => [a.id, a.kind]))
  const q = normalizeDescription(f.search)
  const raw = f.search.trim().toLowerCase() // "123" ou "pg" normalizam para vazio: aí a busca é literal
  return txns.filter(t => {
    if (monthOf(t.date) !== month) return false
    if (f.accountKind !== 'todas' && kind.get(t.accountId) !== f.accountKind) return false
    // "sem" é só gasto sem categoria, o mesmo que soma a barra "Sem categoria" do Resumo
    if (f.categoryId === 'sem' && !(cat(t) === null && t.amountCents < 0)) return false
    if (f.categoryId !== null && f.categoryId !== 'sem' && cat(t)?.id !== f.categoryId) return false
    if (q) return normalizeDescription(t.description).includes(q)
    return !raw || t.description.toLowerCase().includes(raw)
  })
}

// `cat` é opcional para manter a assinatura do plano; sem ele tudo conta no total do dia.
export function groupByDay(txns: Txn[], cat: Cat = () => null): { date: ISODate; totalCents: Cents; txns: Txn[] }[] {
  const by = new Map<ISODate, Txn[]>()
  for (const t of txns) by.set(t.date, [...(by.get(t.date) ?? []), t])
  return [...by.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, ts]) => ({ date, txns: ts, totalCents: ts.reduce((s, t) => s + (counts(t, cat(t)) ? t.amountCents : 0), 0) }))
}

export const suggestRulePattern = (description: string): string => normalizeDescription(description)

export function duplicateAccountWarning(accounts: Account[]): string[] {
  const groups = new Map<string, Account[]>()
  for (const a of accounts) {
    const tail = a.number?.replace(/\D/g, '').slice(-4)
    if (!tail) continue
    const key = `${a.institution.trim().toLowerCase()}|${a.kind}|${tail}`
    groups.set(key, [...(groups.get(key) ?? []), a])
  }
  return [...groups.values()]
    .filter(g => new Set(g.map(a => a.source)).size > 1)
    .map(g => { const a = g.find(x => x.source === 'arquivo') ?? g[0]; return `${a.institution} ···${a.number!.replace(/\D/g, '').slice(-4)} pode estar em dobro (Pluggy e extrato)` })
}

export function cumulativeByDay(txns: Txn[], cat: Cat, month: Month): Cents[] {
  const daily = new Array<Cents>(daysInMonth(month)).fill(0)
  for (const t of txns) if (monthOf(t.date) === month && isSpending(t, cat(t))) daily[Number(t.date.slice(8, 10)) - 1] -= t.amountCents
  let acc = 0
  return daily.map(v => (acc += v))
}

export function spentByMonth(txns: Txn[], cat: Cat, lastMonth: Month, n: number): { month: Month; cents: Cents }[] {
  const out = Array.from({ length: n }, (_, i) => ({ month: addMonths(lastMonth, i - n + 1), cents: 0 }))
  const idx = new Map(out.map((o, i) => [o.month, i]))
  for (const t of txns) {
    const i = idx.get(monthOf(t.date))
    if (i !== undefined && isSpending(t, cat(t))) out[i].cents -= t.amountCents
  }
  return out
}

export function topSpending(txns: Txn[], cat: Cat, month: Month, n: number): Txn[] {
  return txns.filter(t => monthOf(t.date) === month && isSpending(t, cat(t))).sort((a, b) => a.amountCents - b.amountCents).slice(0, n)
}

/** `day`: até que dia comparou (hoje no mês corrente, o último dia num mês passado). */
export function comparePreviousMonth(txns: Txn[], cat: Cat, month: Month, today: ISODate): { currentCents: Cents; previousSameDayCents: Cents; day: number } {
  const day = month === monthOf(today) ? Number(today.slice(8, 10)) : daysInMonth(month)
  const prev = cumulativeByDay(txns, cat, addMonths(month, -1))
  return { currentCents: cumulativeByDay(txns, cat, month)[day - 1], previousSameDayCents: prev[Math.min(day, prev.length) - 1], day }
}

/** Barras de "Por categoria": as `shown` maiores, o resto em "Outras (n)" e "Sem categoria" no fim. */
export function categoryBars(byCategory: MonthTotals['byCategory'], shown: number): { label: string; cents: Cents; categoryId: string | 'sem' | null }[] {
  const named = byCategory.filter(b => b.category)
  const rest = named.slice(shown)
  const none = byCategory.find(b => !b.category)
  return [
    ...named.slice(0, shown).map(b => ({ label: b.category!.name, cents: b.cents, categoryId: b.category!.id })),
    ...(rest.length ? [{ label: `Outras (${rest.length})`, cents: rest.reduce((s, b) => s + b.cents, 0), categoryId: null }] : []),
    ...(none ? [{ label: 'Sem categoria', cents: none.cents, categoryId: 'sem' as const }] : []),
  ]
}

/** A regra que categorizou o lançamento, espelhando a ordem de `categorize` (escolha manual vence). */
export function ruleFor(t: Txn, rules: CategoryRule[], overrides: Record<string, string>): CategoryRule | null {
  if (overrides[t.fingerprint]) return null
  const desc = normalizeDescription(t.description)
  return rules.filter(r => r.pattern && desc.includes(r.pattern.toLowerCase())).sort((a, b) => b.pattern.length - a.pattern.length)[0] ?? null
}

/** Sincroniza ao abrir: algum item salvo sem conta, ou conta da Pluggy nunca sincronizada ou mais velha que SYNC_EVERY_MS. */
export function needsSync(g: GastosData, nowMs: number): boolean {
  if (!g.pluggyItems.length) return false
  // contas de item removido ficam no banco; não podem disparar sincronização
  const pluggy = g.accounts.filter(a => a.source === 'pluggy' && g.pluggyItems.some(i => i.itemId === a.itemId))
  return g.pluggyItems.some(i => !pluggy.some(a => a.itemId === i.itemId))
    || pluggy.some(a => !a.lastSyncAt || nowMs - Date.parse(a.lastSyncAt) > SYNC_EVERY_MS)
}
