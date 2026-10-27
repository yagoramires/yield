import { describe, expect, it } from 'vitest'
import type { Category, CategoryRule, Txn } from '../../db/gastosRepo'
import type { Subscription } from '../../domain/assinaturas'
import { monthTotals } from '../../domain/gastos'
import { deleteImpact, spentByCategory, totalsOfSubscriptions, validateCategoryName } from './build'

const c = (id: string, name: string, countsAsSpending = true): Category => ({ id, name, countsAsSpending, builtin: false })
const cats = [c('mercado', 'Mercado'), c('pet', 'Pet'), c('fatura', 'Pagamento de fatura', false)]
const txn = (description: string, amountCents: number, date = '2026-10-10'): Txn => ({ id: description, accountId: 'a', date, description, amountCents, pending: false, installment: null, operationType: null, fingerprint: description, sourceKey: 's' })
const byDesc: Record<string, Category> = { Super: cats[0], Fatura: cats[2] }
const cat = (t: Txn) => byDesc[t.description] ?? null

describe('spentByCategory', () => {
  const txns = [txn('Super', -1000), txn('Super', -500), txn('Fatura', -3000), txn('Fatura', 300), txn('Outro', -250), txn('Super', -999, '2026-09-10')]
  const rows = spentByCategory(txns, [], cat, cats, '2026-10')
  it('uma linha por categoria, mais Sem categoria, inclusive zeradas', () => {
    expect(rows.map(r => r.category?.id ?? null).sort()).toEqual([null, 'fatura', 'mercado', 'pet'].sort())
    expect(rows.find(r => r.category?.id === 'pet')!.cents).toBe(0)
  })
  it('as que contam como gasto batem com monthTotals', () => {
    const t = monthTotals(txns, [], cat, '2026-10')
    for (const b of t.byCategory) expect(rows.find(r => r.category?.id === b.category?.id)!.cents).toBe(b.cents)
    expect(rows.filter(r => r.countsAsSpending).reduce((s, r) => s + r.cents, 0)).toBe(t.spentCents)
  })
  it('categoria que não conta mostra a soma absoluta das saídas', () => {
    const f = rows.find(r => r.category?.id === 'fatura')!
    expect(f.cents).toBe(3000)
    expect(f.countsAsSpending).toBe(false)
  })
})

describe('validateCategoryName', () => {
  it('vazio', () => expect(() => validateCategoryName('  ', cats)).toThrow('Digite um nome para a categoria'))
  it('repetido ignorando acento e caixa', () => {
    expect(() => validateCategoryName(' MERCADO ', cats)).toThrow('Já existe uma categoria com esse nome')
    expect(() => validateCategoryName('pagamento de fatúra', cats)).toThrow('Já existe uma categoria com esse nome')
  })
  it('devolve aparado; permite o próprio nome', () => {
    expect(validateCategoryName('  Lazer ', cats)).toBe('Lazer')
    expect(validateCategoryName('Pet', cats, 'pet')).toBe('Pet')
  })
})

describe('totalsOfSubscriptions', () => {
  const s = (o: Partial<Subscription>): Subscription => ({ merchantKey: 'k', name: 'N', accountId: 'a', period: 'mensal', amountCents: 1000, monthlyCents: 1000, yearlyCents: 12000, lastDate: '2026-10-01', nextDate: '2026-11-01', active: true, charges: 3, previousAmountCents: null, ...o })
  it('soma só as ativas', () => {
    expect(totalsOfSubscriptions([s({}), s({ monthlyCents: 500, yearlyCents: 6000 }), s({ active: false })])).toEqual({ monthlyCents: 1500, yearlyCents: 18000, active: 2, stopped: 1 })
  })
})

describe('deleteImpact', () => {
  it('conta regras e escolhas manuais da categoria', () => {
    const rules: CategoryRule[] = [{ id: '1', pattern: 'a', categoryId: 'pet' }, { id: '2', pattern: 'b', categoryId: 'mercado' }]
    expect(deleteImpact('pet', rules, { f1: 'pet', f2: 'pet', f3: 'mercado' })).toEqual({ rules: 1, overrides: 2 })
  })
})
