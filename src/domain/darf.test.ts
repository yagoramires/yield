import { describe, expect, test } from 'vitest'
import { computeDarfs } from './darf'
import type { PotMonth, TaxMonth } from './tax'
import type { DarfPayment } from './types'

const pot = (payable: number): PotMonth => ({
  resultCents: 0, exemptProfitCents: 0, lossInCents: 0, baseCents: 0, taxDueCents: payable, irrfMonthCents: 0,
  irrfUsedCents: 0, irrfCarryOutCents: 0, lossOutCents: 0, taxPayableCents: payable,
})
const tm = (month: string, comum: number, fii = 0, incomplete = false): TaxMonth =>
  ({ month, stockSalesCents: 0, comum: pot(comum), fii: pot(fii), incomplete })
const base = [tm('2024-01', 600), tm('2024-02', 500)]
const pay = (month: string, principalCents: number): DarfPayment =>
  ({ month, paidAt: '2026-10-20', principalCents, totalPaidCents: principalCents + 200 })
const TODAY = '2026-10-26'

describe('computeDarfs', () => {
  test('abaixo de R$ 10 acumula e a soma vira DARF no mês seguinte', () => {
    const { rows } = computeDarfs(base, [], TODAY)
    expect(rows[0]).toMatchObject({ month: '2024-01', darfCents: 0, status: 'acumulado', accumulatedCents: 600 })
    expect(rows[1]).toMatchObject({ month: '2024-02', accumulatedCents: 1100, darfCents: 1100, dueDate: '2024-03-28', status: 'em_aberto' })
  })
  test('soma comum e FII', () => {
    const { rows } = computeDarfs([tm('2024-02', 800, 300)], [], TODAY)
    expect(rows[0]).toMatchObject({ taxCents: 1100, darfCents: 1100 })
  })
  test('pendente zera após gerar DARF', () => {
    const { rows } = computeDarfs([...base, tm('2024-03', 400)], [], TODAY)
    expect(rows[2]).toMatchObject({ accumulatedCents: 400, darfCents: 0, status: 'acumulado' })
  })
  test('a_vencer até o vencimento (inclusive)', () => {
    expect(computeDarfs(base, [], '2024-03-10').rows[1].status).toBe('a_vencer')
    expect(computeDarfs(base, [], '2024-03-28').rows[1].status).toBe('a_vencer')
    expect(computeDarfs(base, [], '2024-03-29').rows[1].status).toBe('em_aberto')
  })
  test('pago', () => {
    const r = computeDarfs(base, [pay('2024-02', 1100)], TODAY)
    expect(r.rows[1]).toMatchObject({ status: 'pago', complementCents: 0 })
    expect(r.rows[1].payment).toEqual(pay('2024-02', 1100))
    expect(r.openCents).toBe(0)
  })
  test('pago a menor', () => {
    const r = computeDarfs(base, [pay('2024-02', 900)], TODAY)
    expect(r.rows[1]).toMatchObject({ status: 'pago_a_menor', complementCents: 200 })
    expect(r.openCents).toBe(200)
  })
  test('pagamento em mês que só acumulou é órfão', () => {
    const p = pay('2024-01', 600)
    const r = computeDarfs(base, [p], TODAY)
    expect(r.orphanPayments).toEqual([p])
    expect(r.rows[0].payment).toBeNull()
  })
  test('em aberto separa meses incompletos', () => {
    const r = computeDarfs([tm('2024-02', 1500, 0, true), tm('2024-03', 2000)], [], TODAY)
    expect(r.openIncompleteCents).toBe(1500)
    expect(r.openCents).toBe(2000)
  })
  test('a_vencer não conta como em aberto', () => {
    expect(computeDarfs(base, [], '2024-03-10').openCents).toBe(0)
  })
  test('mês sem imposto', () => {
    const { rows } = computeDarfs([tm('2024-01', 0)], [], TODAY)
    expect(rows[0]).toMatchObject({ status: 'sem_imposto', dueDate: null, darfCents: 0, complementCents: 0, payment: null })
  })
})
