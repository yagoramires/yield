import { describe, expect, it } from 'vitest'
import type { DarfRow } from '../../domain/darf'
import type { PotMonth, TaxMonth } from '../../domain/tax'
import { buildPayment, dayTradeMonths, exemptSales, groupByYear, irrfToDeclare, isEmptyMonth, lastDayOfMonth, lossCarry, openCounts } from './build'

const pot = (o: Partial<PotMonth> = {}): PotMonth => ({
  resultCents: 0, exemptProfitCents: 0, lossInCents: 0, baseCents: 0, taxDueCents: 0, irrfMonthCents: 0,
  irrfUsedCents: 0, irrfCarryOutCents: 0, lossOutCents: 0, taxPayableCents: 0, ...o,
})
const tax = (month: string, comum: Partial<PotMonth> = {}, fii: Partial<PotMonth> = {}): TaxMonth =>
  ({ month, stockSalesCents: 0, comum: pot(comum), fii: pot(fii), incomplete: false })
const darf = (month: string): DarfRow =>
  ({ month, taxCents: 0, accumulatedCents: 0, darfCents: 0, dueDate: null, status: 'sem_imposto', payment: null, complementCents: 0, incomplete: false })

describe('groupByYear', () => {
  it('agrupa por ano e ordena anos e meses do mais recente ao mais antigo', () => {
    const months = ['2024-12', '2025-01', '2025-02'].map(m => tax(m))
    const g = groupByYear(months, months.map(m => darf(m.month)))
    expect(g.map(x => x.year)).toEqual(['2025', '2024'])
    expect(g[0].rows.map(r => r.tax.month)).toEqual(['2025-02', '2025-01'])
    expect(g[0].rows[0].darf.month).toBe('2025-02')
  })
})

describe('irrfToDeclare', () => {
  it('soma o saldo de IRRF (comum + FII) de dezembro de cada ano, anos desc; ignora ano sem dezembro', () => {
    const m = [tax('2023-12', { irrfCarryOutCents: 30 }, { irrfCarryOutCents: 5 }), tax('2024-11', { irrfCarryOutCents: 99 }), tax('2024-12'), tax('2025-01', { irrfCarryOutCents: 7 })]
    expect(irrfToDeclare(m)).toEqual([{ year: '2024', cents: 0 }, { year: '2023', cents: 35 }])
  })
})

describe('lastDayOfMonth / dayTradeMonths', () => {
  it('último dia corrido, com bissexto', () => {
    expect(lastDayOfMonth('2026-10')).toBe('2026-10-31')
    expect(lastDayOfMonth('2024-02')).toBe('2024-02-29')
    expect(lastDayOfMonth('2025-02')).toBe('2025-02-28')
    expect(lastDayOfMonth('2025-04')).toBe('2025-04-30')
  })
  it('meses com aviso de day trade', () => {
    const w = (kind: 'day_trade' | 'tipo_inconsistente', date: string) => ({ kind, ticker: 'X', date, detail: '' })
    expect([...dayTradeMonths([w('day_trade', '2025-03-10'), w('tipo_inconsistente', '2025-04-01')])]).toEqual(['2025-03'])
  })
})

describe('buildPayment', () => {
  const f = { paidAt: '2026-10-20', principal: '163,44', total: '170,00' }
  it('monta o pagamento', () => {
    expect(buildPayment('2026-09', f)).toEqual({ month: '2026-09', paidAt: '2026-10-20', principalCents: 16344, totalPaidCents: 17000 })
  })
  it('rejeita data inválida, texto, principal zero e total menor que o principal', () => {
    expect(() => buildPayment('2026-09', { ...f, paidAt: '' })).toThrow('Data')
    expect(() => buildPayment('2026-09', { ...f, paidAt: '2026-02-30' })).toThrow('Data')
    expect(() => buildPayment('2026-09', { ...f, principal: 'abc' })).toThrow('Principal')
    expect(() => buildPayment('2026-09', { ...f, principal: '0' })).toThrow('Principal')
    expect(() => buildPayment('2026-09', { ...f, total: '' })).toThrow('Total')
    expect(() => buildPayment('2026-09', { ...f, total: '100,00' })).toThrow('Total pago: não pode ser menor')
  })
})

describe('resumo', () => {
  it('conta meses em aberto separando incompletos', () => {
    const r = (status: DarfRow['status'], incomplete: boolean): DarfRow => ({ ...darf('2026-01'), status, incomplete })
    expect(openCounts([r('em_aberto', false), r('pago_a_menor', false), r('em_aberto', true), r('pago', false), r('a_vencer', false)])).toEqual({ complete: 2, incomplete: 1 })
  })
  it('prejuízo comum e FII separados', () => {
    expect(lossCarry(tax('2026-01', { lossOutCents: -500 }, { lossOutCents: -120 }))).toEqual({ comum: 500, fii: 120 })
    expect(Object.is(lossCarry(tax('2026-01')).comum, 0)).toBe(true) // sem -0 ("-R$ 0,00")
  })
  it('vendas isentas só de meses com lucro isentado no ano', () => {
    const m = [{ ...tax('2026-01', { exemptProfitCents: 10 }), stockSalesCents: 1000 }, { ...tax('2026-02'), stockSalesCents: 5000 }, { ...tax('2025-03', { exemptProfitCents: 10 }), stockSalesCents: 7 }]
    expect(exemptSales(m, '2026')).toBe(1000)
  })
  it('mês vazio', () => {
    expect(isEmptyMonth({ tax: tax('2026-01'), darf: darf('2026-01') })).toBe(true)
    expect(isEmptyMonth({ tax: { ...tax('2026-01'), stockSalesCents: 1 }, darf: darf('2026-01') })).toBe(false)
  })
})
