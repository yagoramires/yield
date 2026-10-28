import type { Account, Category, CategoryRule, Txn } from '../../db/gastosRepo'
import type { Subscription } from '../../domain/assinaturas'
import type { BudgetLine } from '../../db/orcamentoRepo'
import { fold, monthTotals, normalizeDescription } from '../../domain/gastos'
import { ruleFor, suggestRulePattern } from '../lancamentos/build'
import { formatCents } from '../../domain/money'
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

/** Cobranças previstas das ativas até `days` dias à frente, por data; a prevista que já passou (atrasada) entra também. */
export function nextCharges(subs: Subscription[], today: string, days = 30) {
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
  const list = subs.filter(s => s.active && s.nextDate <= limit).sort((a, b) => a.nextDate.localeCompare(b.nextDate))
  return { list, totalCents: list.reduce((a, s) => a + s.amountCents, 0) }
}

export const deleteImpact = (categoryId: string, rules: CategoryRule[], overrides: Record<string, string>) =>
  ({ rules: rules.filter(r => r.categoryId === categoryId).length, overrides: Object.values(overrides).filter(id => id === categoryId).length })

/** Variação em % contra o mês anterior; `null` quando o anterior foi 0 (não há base para comparar). */
export const monthDelta = (cur: Cents, prev: Cents): number | null => (prev === 0 ? null : Math.round(((cur - prev) / prev) * 100))

/** Orçamento do mês por categoria: soma das saídas planejadas com categoria. Mês sem linha = sem orçamento. */
export function budgetByCategory(lines: BudgetLine[], month: Month): Map<string, Cents> {
  const out = new Map<string, Cents>()
  for (const l of lines) if (l.month === month && l.kind === 'saida' && l.categoryId) out.set(l.categoryId, (out.get(l.categoryId) ?? 0) + l.amountCents)
  return out
}

/** Quantos lançamentos cada regra categoriza de fato hoje (a escolha à mão e a regra mais específica ganham). */
export function ruleUsage(txns: Txn[], rules: CategoryRule[], overrides: Record<string, string>): Map<string, number> {
  const out = new Map<string, number>()
  for (const t of txns) {
    const r = ruleFor(t, rules, overrides)
    if (r) out.set(r.id, (out.get(r.id) ?? 0) + 1)
  }
  return out
}

/** O que uma regra nova pegaria: lançamentos sem escolha à mão cuja descrição tem o trecho. `null` se o trecho normaliza para vazio. */
export function rulePreview(pattern: string, txns: Txn[], overrides: Record<string, string>, cat: (t: Txn) => Category | null): { count: number; uncategorized: number; examples: Txn[] } | null {
  const p = normalizeDescription(pattern)
  if (!p) return null
  const hits = txns.filter(t => !overrides[t.fingerprint] && normalizeDescription(t.description).includes(p))
  return {
    count: hits.length,
    uncategorized: hits.filter(t => cat(t) === null).length,
    examples: [...hits].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 3),
  }
}

const MIN_SUGGESTION = 3

/** Escolhas à mão repetidas que poderiam virar regra: mesmo trecho e mesma categoria em 3+ lançamentos, sem regra nem recusa. */
export function ruleSuggestions(txns: Txn[], overrides: Record<string, string>, rules: CategoryRule[], dismissed: string[]): { pattern: string; categoryId: string; count: number }[] {
  const skip = new Set([...rules.map(r => r.pattern), ...dismissed])
  const by = new Map<string, Map<string, number>>() // trecho → categoria → vezes
  for (const t of txns) {
    const categoryId = overrides[t.fingerprint]
    const pattern = categoryId ? suggestRulePattern(t.description) : ''
    if (!pattern || skip.has(pattern)) continue
    const m = by.get(pattern) ?? new Map<string, number>()
    m.set(categoryId, (m.get(categoryId) ?? 0) + 1)
    by.set(pattern, m)
  }
  return [...by].flatMap(([pattern, m]) => {
    const [categoryId, count] = [...m].sort((a, b) => b[1] - a[1])[0]
    return count >= MIN_SUGGESTION ? [{ pattern, categoryId, count }] : []
  }).sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern))
}

/** Barra de uma categoria: com orçamento (> 0) é quanto do limite já foi; sem, o peso no gasto do mês. */
export function barInfo(cents: Cents, budgetCents: Cents | undefined, totalCents: Cents): { pct: number; over: boolean; caption: string } {
  if (budgetCents) {
    const over = cents > budgetCents
    return { pct: Math.min(100, Math.round((cents / budgetCents) * 100)), over, caption: over ? `passou ${formatCents(cents - budgetCents)} do orçamento` : `${Math.round((cents / budgetCents) * 100)}% do orçamento de ${formatCents(budgetCents)}` }
  }
  const pct = totalCents ? Math.round((cents / totalCents) * 100) : 0
  return { pct, over: false, caption: `${pct}% do gasto do mês` }
}

const MIN_CHANGE = 1000 // menos de R$ 10 de diferença não é mudança que valha mostrar

/** Categorias que mais subiram (até `n`) e mais caíram (até `n`) contra o mês anterior, em centavos. */
export function biggestChanges(cur: Map<string, Cents>, prev: Map<string, Cents>, n: number): { id: string; deltaCents: Cents; pct: number | null }[] {
  const all = [...new Set([...cur.keys(), ...prev.keys()])].map(id => {
    const before = prev.get(id) ?? 0
    const deltaCents = (cur.get(id) ?? 0) - before
    return { id, deltaCents, pct: before ? deltaCents / before : null }
  }).filter(c => Math.abs(c.deltaCents) >= MIN_CHANGE)
  return [
    ...all.filter(c => c.deltaCents > 0).sort((a, b) => b.deltaCents - a.deltaCents).slice(0, n),
    ...all.filter(c => c.deltaCents < 0).sort((a, b) => a.deltaCents - b.deltaCents).slice(0, n),
  ]
}
