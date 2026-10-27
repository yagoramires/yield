import { describe, expect, it } from 'vitest'
import type { Category, Txn } from '../db/gastosRepo'
import type { BudgetLine } from '../db/orcamentoRepo'
import type { Subscription } from './assinaturas'
import { suggestForMonth } from './sugestoes'

const txn = (o: Partial<Txn>): Txn => ({ id: 't', accountId: 'c1', date: '2026-09-10', description: 'LOJA X', amountCents: -10000, pending: false, installment: null, operationType: null, fingerprint: 'fp', sourceKey: 's', ...o })
const sub = (o: Partial<Subscription>): Subscription => ({ merchantKey: 'c1|netflix', name: 'NETFLIX', accountId: 'c1', period: 'mensal', amountCents: 3990, monthlyCents: 3990, yearlyCents: 47880, lastDate: '2026-09-05', nextDate: '2026-10-05', active: true, charges: 3, previousAmountCents: null, ...o })
const line = (o: Partial<BudgetLine>): BudgetLine => ({ id: 'l', month: '2026-10', kind: 'saida', name: 'x', amountCents: 1, recurring: false, position: 0, categoryId: null, installmentCurrent: null, installmentTotal: null, sourceId: null, sourceKey: null, ...o })
const semCat = () => null
const cat = { id: 'lazer', name: 'Lazer', countsAsSpending: true, builtin: false } as Category
const compra = (n: number, date: string) => txn({ date, installment: `${n}/10` })

describe('suggestForMonth', () => {
  it('assinatura mensal ativa aparece com a categoria da última cobrança; parada não', () => {
    const t = [txn({ description: 'Netflix', date: '2026-09-05', amountCents: -3990 })]
    const r = suggestForMonth('2026-10', [sub({}), sub({ merchantKey: 'c1|velha', active: false })], t, () => cat, [], [])
    expect(r).toEqual([{ key: 'sub:c1|netflix@2026-10', reason: 'assinatura', name: 'NETFLIX', amountCents: 3990, categoryId: 'lazer', installmentCurrent: null, installmentTotal: null, recurring: true }])
  })
  it('anual só no mês da próxima cobrança e não é recorrente', () => {
    const s = sub({ period: 'anual', amountCents: 120000, nextDate: '2027-03-12' })
    expect(suggestForMonth('2027-03', [s], [], semCat, [], [])[0]).toMatchObject({ amountCents: 120000, recurring: false })
    expect(suggestForMonth('2027-04', [s], [], semCat, [], [])).toEqual([])
  })
  it('3/10 em setembro sugere 4/10 em outubro e 10/10 em abril, nada em maio', () => {
    const t = [compra(2, '2026-08-10'), compra(3, '2026-09-10')]
    const [o] = suggestForMonth('2026-10', [], t, semCat, [], [])
    expect(o).toEqual({ key: 'parc:c1|loja x|10|10000@2026-10', reason: 'parcela', name: 'LOJA X', amountCents: 10000, categoryId: null, installmentCurrent: 4, installmentTotal: 10, recurring: true })
    expect(suggestForMonth('2027-04', [], t, semCat, [], [])[0].installmentCurrent).toBe(10)
    expect(suggestForMonth('2027-05', [], t, semCat, [], [])).toEqual([])
  })
  it('linha do mesmo mês com o mesmo sourceKey esconde; de outro mês não', () => {
    const t = [compra(3, '2026-09-10')]
    const key = 'parc:c1|loja x|10|10000@2026-10'
    expect(suggestForMonth('2026-10', [sub({})], t, semCat, [line({ sourceKey: key }), line({ sourceKey: 'sub:c1|netflix@2026-10' })], [])).toEqual([])
    expect(suggestForMonth('2026-10', [], t, semCat, [line({ month: '2026-09', sourceKey: key })], [])).toHaveLength(1)
  })
  it('descartada não aparece', () => {
    expect(suggestForMonth('2026-10', [sub({})], [compra(3, '2026-09-10')], semCat, [], ['sub:c1|netflix@2026-10', 'parc:c1|loja x|10|10000@2026-10'])).toEqual([])
  })
  it('compra à vista, receita e 1/1 nunca aparecem', () => {
    const t = [txn({}), txn({ installment: '1/1' }), txn({ installment: '2/10', amountCents: 5000 })]
    expect(suggestForMonth('2026-10', [], t, semCat, [], [])).toEqual([])
  })
  it('ordena por valor desc e depois nome', () => {
    const r = suggestForMonth('2026-10', [sub({ merchantKey: 'c1|b', name: 'B', amountCents: 500 }), sub({ merchantKey: 'c1|a', name: 'A', amountCents: 500 }), sub({})], [], semCat, [], [])
    expect(r.map(s => s.name)).toEqual(['NETFLIX', 'A', 'B'])
  })
  it('total gigante vindo do banco não trava: calcula a parcela do mês direto', () => {
    const t = [txn({ installment: '1/999999999', date: '2026-09-10' })]
    expect(suggestForMonth('2026-10', [], t, semCat, [], [])[0].installmentCurrent).toBe(2)
    expect(suggestForMonth('2026-09', [], t, semCat, [], [])).toEqual([])
  })
  it('parcela malformada (11/10, 0/3) é ignorada sem derrubar as válidas', () => {
    const t = [txn({ installment: '11/10' }), txn({ description: 'OUTRA', installment: '0/3' }), compra(3, '2026-09-10')]
    expect(suggestForMonth('2026-10', [], t, semCat, [], []).map(s => s.name)).toEqual(['LOJA X'])
  })
})
