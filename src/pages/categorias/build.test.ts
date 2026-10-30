import { describe, expect, it } from 'vitest'
import type { Category, CategoryRule, Txn } from '../../db/gastosRepo'
import type { BudgetLine } from '../../db/orcamentoRepo'
import type { Subscription } from '../../domain/assinaturas'
import { monthTotals } from '../../domain/gastos'
import { barInfo, biggestChanges, budgetByCategory, deleteImpact, monthDelta, nextCharges, rulePreview, ruleSuggestions, ruleUsage, spentByCategory, totalsOfSubscriptions, validateCategoryName } from './build'

const c = (id: string, name: string, countsAsSpending = true): Category => ({ id, name, countsAsSpending, builtin: false, icon: null, color: null })
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
  it('próximas cobranças: só ativas, até 30 dias, por data (a atrasada entra primeiro)', () => {
    const r = nextCharges([
      s({ merchantKey: 'b', nextDate: '2026-11-05', amountCents: 300 }), s({ merchantKey: 'a', nextDate: '2026-10-20', amountCents: 200 }),
      s({ merchantKey: 'c', nextDate: '2026-11-27', amountCents: 400 }), s({ merchantKey: 'd', nextDate: '2026-11-28', amountCents: 999 }),
      s({ merchantKey: 'e', nextDate: '2026-11-01', active: false }),
    ], '2026-10-28')
    expect(r.list.map(x => x.merchantKey)).toEqual(['a', 'b', 'c'])
    expect(r.totalCents).toBe(900)
  })
})

describe('deleteImpact', () => {
  it('conta regras e escolhas manuais da categoria', () => {
    const rules: CategoryRule[] = [{ id: '1', pattern: 'a', categoryId: 'pet' }, { id: '2', pattern: 'b', categoryId: 'mercado' }]
    expect(deleteImpact('pet', rules, { f1: 'pet', f2: 'pet', f3: 'mercado' })).toEqual({ rules: 1, overrides: 2 })
  })
})

describe('tela de categorias', () => {
  const t = (fp: string, description: string, date = '2026-10-10'): Txn => ({ ...txn(description, -1000, date), id: fp, fingerprint: fp })
  it('variação contra o mês anterior; sem gasto antes não tem variação', () => {
    expect([monthDelta(12000, 10000), monthDelta(8000, 10000), monthDelta(500, 0)]).toEqual([20, -20, null])
  })
  it('orçamento por categoria soma só as saídas do mês que têm categoria', () => {
    const l = (month: string, kind: BudgetLine['kind'], categoryId: string | null, amountCents: number): BudgetLine =>
      ({ id: `${month}${kind}${categoryId}${amountCents}`, month, kind, name: 'x', amountCents, recurring: false, position: 0, categoryId, installmentCurrent: null, installmentTotal: null, sourceId: null, grupo: null, sourceKey: null })
    const m = budgetByCategory([l('2026-10', 'saida', 'mercado', 60000), l('2026-10', 'saida', 'mercado', 40000), l('2026-09', 'saida', 'mercado', 1), l('2026-10', 'entrada', 'mercado', 5), l('2026-10', 'saida', null, 7)], new Map([['cat:pet', 500], ['investir', 9]]), '2026-10')
    expect(Object.fromEntries(m)).toEqual({ mercado: 100000, pet: 500 })
  })
  it('contagem por regra só onde ela vence (escolha à mão ganha, a mais específica ganha)', () => {
    const rules: CategoryRule[] = [{ id: 'r1', pattern: 'padaria', categoryId: 'mercado' }, { id: 'r2', pattern: 'padaria sol', categoryId: 'pet' }]
    const u = ruleUsage([t('1', 'PADARIA SOL'), t('2', 'Padaria Lua'), t('3', 'Padaria Lua')], rules, { 3: 'pet' })
    expect([u.get('r1'), u.get('r2')]).toEqual([1, 1])
  })
  it('prévia da regra: ignora o que tem escolha à mão, conta os sem categoria e mostra os 3 mais recentes', () => {
    expect(rulePreview('123', [t('1', 'Loja 123')], {}, cat)).toBeNull()
    const txns = [t('1', 'Padaria Sol', '2026-10-01'), t('2', 'Padaria Sol', '2026-10-05'), t('3', 'Super', '2026-10-06'), t('4', 'Padaria Lua', '2026-10-07'), t('5', 'Padaria Sol', '2026-10-09'), t('6', 'padaria x', '2026-10-08')]
    const p = rulePreview('padaria', txns, { 6: 'pet' }, cat)!
    expect([p.count, p.uncategorized, p.examples.map(x => x.id)]).toEqual([4, 4, ['5', '4', '2']])
  })
  it('sugere regra com 3 escolhas iguais à mão; menos que isso, recusada ou já regra não sugere', () => {
    const txns = ['1', '2', '3', '4', '5', '6', '7'].map(fp => t(fp, Number(fp) <= 3 ? 'PADARIA SOL' : Number(fp) <= 5 ? 'Loja Azul' : '***'))
    const ov = { 1: 'alimentacao', 2: 'alimentacao', 3: 'alimentacao', 4: 'compras', 5: 'compras', 6: 'outros', 7: 'outros' }
    expect(ruleSuggestions(txns, ov, [], [])).toEqual([{ pattern: 'padaria sol', categoryId: 'alimentacao', count: 3 }])
    expect(ruleSuggestions(txns, ov, [], ['padaria sol'])).toEqual([])
    expect(ruleSuggestions(txns, ov, [{ id: 'r', pattern: 'padaria sol', categoryId: 'mercado' }], [])).toEqual([])
  })
})

describe('barInfo', () => {
  it('com orçamento mostra quanto do limite já foi; passou fica vermelho; sem orçamento (ou orçamento 0) é o peso no mês', () => {
    expect(barInfo(82040, 100000, 342230)).toEqual({ pct: 82, over: false, caption: '82% do orçamento de 1.000,00' })
    expect(barInfo(51290, 40000, 342230)).toEqual({ pct: 100, over: true, caption: 'passou 112,90 do orçamento' })
    expect(barInfo(28800, undefined, 342230)).toEqual({ pct: 8, over: false, caption: '8% do gasto do mês' })
    expect(barInfo(500, 0, 1000)).toEqual({ pct: 50, over: false, caption: '50% do gasto do mês' })
    expect(barInfo(0, undefined, 0)).toEqual({ pct: 0, over: false, caption: '0% do gasto do mês' })
  })
})

describe('biggestChanges', () => {
  it('as que mais subiram e as que mais caíram em reais, ignorando variação pequena', () => {
    const cur = new Map([['mercado', 82000], ['transporte', 28800], ['alimentacao', 51300], ['lazer', 0], ['saude', 15000]])
    const prev = new Map([['mercado', 66000], ['transporte', 27400], ['alimentacao', 62500], ['lazer', 8000], ['saude', 14800], ['viagem', 0]])
    expect(biggestChanges(cur, prev, 2)).toEqual([
      { id: 'mercado', deltaCents: 16000, pct: 16000 / 66000 },
      { id: 'transporte', deltaCents: 1400, pct: 1400 / 27400 },
      { id: 'alimentacao', deltaCents: -11200, pct: -11200 / 62500 },
      { id: 'lazer', deltaCents: -8000, pct: -1 },
    ])
  })
  it('categoria nova no mês entra sem percentual', () => {
    expect(biggestChanges(new Map([['pets', 5000]]), new Map(), 2)).toEqual([{ id: 'pets', deltaCents: 5000, pct: null }])
  })
})
