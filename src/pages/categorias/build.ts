import type { Account, Category, CategoryRule, Txn } from '../../db/gastosRepo'
import type { Subscription } from '../../domain/assinaturas'
import { monthTotals } from '../../domain/gastos'
import type { Cents, Month } from '../../domain/types'

export interface CategoryRow { category: Category | null; cents: Cents; countsAsSpending: boolean }

/** Uma linha por categoria + "Sem categoria". As que contam vêm de monthTotals (sempre iguais ao Resumo); as que não contam mostram a soma das saídas. */
export function spentByCategory(txns: Txn[], accounts: Account[], cat: (t: Txn) => Category | null, categories: Category[], month: Month): CategoryRow[] {
  const spent = new Map(monthTotals(txns, accounts, cat, month).byCategory.map(b => [b.category?.id ?? null, b.cents]))
  const out = new Map<string, Cents>()
  for (const t of txns) {
    const c = cat(t)
    if (c && !c.countsAsSpending && t.amountCents < 0 && t.date.slice(0, 7) === month) out.set(c.id, (out.get(c.id) ?? 0) - t.amountCents)
  }
  const rows = categories.map(c => ({ category: c, cents: c.countsAsSpending ? spent.get(c.id) ?? 0 : out.get(c.id) ?? 0, countsAsSpending: c.countsAsSpending }))
  const yes = rows.filter(r => r.countsAsSpending).sort((a, b) => b.cents - a.cents)
  const no = rows.filter(r => !r.countsAsSpending)
  return [...yes, { category: null, cents: spent.get(null) ?? 0, countsAsSpending: true }, ...no]
}

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

export function validateCategoryName(name: string, categories: Category[], exceptId?: string): string {
  const n = name.trim()
  if (!n) throw new Error('Digite um nome para a categoria')
  const key = fold(n)
  if (categories.some(c => c.id !== exceptId && fold(c.name) === key)) throw new Error('Já existe uma categoria com esse nome')
  return n
}

export function totalsOfSubscriptions(subs: Subscription[]) {
  const on = subs.filter(s => s.active)
  return { monthlyCents: on.reduce((a, s) => a + s.monthlyCents, 0), yearlyCents: on.reduce((a, s) => a + s.yearlyCents, 0), active: on.length, stopped: subs.length - on.length }
}

export const deleteImpact = (categoryId: string, rules: CategoryRule[], overrides: Record<string, string>) =>
  ({ rules: rules.filter(r => r.categoryId === categoryId).length, overrides: Object.values(overrides).filter(id => id === categoryId).length })
