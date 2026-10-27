import { describe, expect, it } from 'vitest'
import type { Category } from '../../db/gastosRepo'
import type { BudgetLine } from '../../db/orcamentoRepo'
import { defaultMonth, monthProgress, spendingPlan, validateLine } from './build'

describe('validateLine', () => {
  it('exige nome', () => {
    expect(() => validateLine({ name: '  ', amount: '10,00', installment: '', recurring: false })).toThrow('Informe o nome')
  })
  it('recusa valor inválido', () => {
    expect(() => validateLine({ name: 'Aluguel', amount: 'abc', installment: '', recurring: false })).toThrow('valor inválido')
  })
  it('recusa parcela fora de n/total', () => {
    for (const installment of ['3/2', '0/5', '2', 'a/b']) expect(() => validateLine({ name: 'Sofá', amount: '100', installment, recurring: false })).toThrow('Parcela')
  })
  it('aceita parcela e devolve centavos', () => {
    expect(validateLine({ name: ' Sofá ', amount: '1.234,56', installment: ' 2/5 ', recurring: true })).toEqual({ name: 'Sofá', amountCents: 123456, installmentCurrent: 2, installmentTotal: 5, recurring: true })
  })
  it('linha com parcela é sempre recorrente; sem parcela segue a caixa', () => {
    expect(validateLine({ name: 'Sofá', amount: '100', installment: '2/5', recurring: false }).recurring).toBe(true)
    expect(validateLine({ name: 'Mercado', amount: '500', installment: '', recurring: false }).recurring).toBe(false)
  })
  it('sem parcela fica nulo', () => {
    expect(validateLine({ name: 'Mercado', amount: '500', installment: '', recurring: false })).toMatchObject({ installmentCurrent: null, installmentTotal: null })
  })
})

describe('monthProgress', () => {
  it('dia 15 de um mês de 30 é metade', () => expect(monthProgress('2026-09', '2026-09-15')).toBeCloseTo(0.5))
  it('mês passado é 1 e futuro é 0', () => {
    expect(monthProgress('2026-08', '2026-09-15')).toBe(1)
    expect(monthProgress('2026-10', '2026-09-15')).toBe(0)
  })
})

describe('defaultMonth', () => {
  it('prefere o mês de hoje, senão o último criado, senão hoje', () => {
    expect(defaultMonth(['2026-09', '2026-10', '2026-11'], '2026-10-27')).toBe('2026-10')
    expect(defaultMonth(['2026-08', '2026-09'], '2026-10-27')).toBe('2026-09')
    expect(defaultMonth([], '2026-10-27')).toBe('2026-10')
  })
})

describe('spendingPlan', () => {
  const cats: Category[] = [
    { id: 'moradia', name: 'Moradia', countsAsSpending: true, builtin: true, icon: null, color: null },
    { id: 'investimento', name: 'Investimento', countsAsSpending: false, builtin: true, icon: null, color: null },
  ]
  const line = (o: Partial<BudgetLine>): BudgetLine => ({ id: 'x', month: '2026-10', kind: 'saida', name: 'x', amountCents: 0, recurring: true, position: 0, categoryId: null, installmentCurrent: null, installmentTotal: null, sourceId: null, sourceKey: null, ...o })
  it('tira do planejado as saídas em categorias que não contam como gasto', () => {
    const lines = [
      line({ amountCents: 280000, categoryId: 'moradia' }),
      line({ amountCents: 300000, categoryId: 'investimento' }),
      line({ amountCents: 80000 }),
      line({ kind: 'entrada', amountCents: 999900 }),
    ]
    expect(spendingPlan(lines, cats)).toEqual({ plannedCents: 360000, reservedCents: 300000 })
  })
})
