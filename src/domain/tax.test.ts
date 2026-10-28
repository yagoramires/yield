import { describe, expect, test } from 'vitest'
import { computeTax } from './tax'
import type { AssetType, Sale, Warning } from './types'

let n = 0
const s = (o: { date: string; type?: AssetType; gross?: number; result: number; irrf?: number; settle?: string }): Sale => ({
  tradeId: `t${n++}`, tradeDate: o.date, settleDate: o.settle ?? o.date, ticker: 'XXXX3', assetType: o.type ?? 'Ação',
  qty: 1, grossCents: o.gross ?? 0, netCents: 0, costBasisCents: 0, resultCents: o.result, irrfCents: o.irrf ?? 0,
  alienationCents: o.gross ?? 0,
})
const run = (sales: Sale[], from: string, to: string, w: Warning[] = []) => computeTax(sales, w, from, to)

describe('computeTax', () => {
  test('vendas de ações até 20 mil: lucro isento', () => {
    const [m] = run([s({ date: '2024-03-10', gross: 1_500_000, result: 300_000 })], '2024-03', '2024-03')
    expect(m.stockSalesCents).toBe(1_500_000)
    expect(m.comum.exemptProfitCents).toBe(300_000)
    expect(m.comum.baseCents).toBe(0)
    expect(m.comum.taxDueCents).toBe(0)
  })
  test('exatamente 20 mil ainda é isento', () => {
    const [m] = run([s({ date: '2024-03-10', gross: 2_000_000, result: 300_000 })], '2024-03', '2024-03')
    expect(m.comum.exemptProfitCents).toBe(300_000)
    expect(m.comum.taxDueCents).toBe(0)
  })
  test('ETF de renda fixa fica fora da apuração (imposto retido na fonte)', () => {
    const [m] = run([s({ date: '2024-03-10', type: 'ETF RF', gross: 5_000_000, result: 1_000_000 })], '2024-03', '2024-03')
    expect(m.stockSalesCents).toBe(0)
    expect(m.comum.baseCents).toBe(0)
    expect(m.comum.taxPayableCents).toBe(0)
  })

  test('acima de 20 mil: 15% sobre o lucro', () => {
    const [m] = run([s({ date: '2024-03-10', gross: 2_500_000, result: 300_000 })], '2024-03', '2024-03')
    expect(m.comum.exemptProfitCents).toBe(0)
    expect(m.comum.baseCents).toBe(300_000)
    expect(m.comum.taxDueCents).toBe(45_000)
    expect(m.comum.taxPayableCents).toBe(45_000)
  })
  test('prejuízo de ETF compensa no mês seguinte', () => {
    const [jan, fev] = run([
      s({ date: '2024-01-10', type: 'ETF', gross: 500_000, result: -100_000 }),
      s({ date: '2024-02-10', type: 'ETF', gross: 900_000, result: 300_000 }),
    ], '2024-01', '2024-02')
    expect(jan.comum.lossOutCents).toBe(-100_000)
    expect(fev.comum.lossInCents).toBe(-100_000)
    expect(fev.comum.exemptProfitCents).toBe(0)
    expect(fev.comum.baseCents).toBe(200_000)
    expect(fev.comum.taxDueCents).toBe(30_000)
  })
  test('prejuízo em mês isento continua compensável', () => {
    const [jan, fev] = run([
      s({ date: '2024-01-10', gross: 1_000_000, result: -50_000 }),
      s({ date: '2024-02-10', gross: 3_000_000, result: 200_000 }),
    ], '2024-01', '2024-02')
    expect(jan.comum.lossOutCents).toBe(-50_000)
    expect(fev.comum.baseCents).toBe(150_000)
    expect(fev.comum.taxDueCents).toBe(22_500)
  })
  test('FII tem pote próprio a 20%', () => {
    const [m] = run([
      s({ date: '2024-03-10', type: 'ETF', result: -100_000 }),
      s({ date: '2024-03-11', type: 'FII', result: 100_000 }),
    ], '2024-03', '2024-03')
    expect(m.fii.exemptProfitCents).toBe(0)
    expect(m.fii.taxDueCents).toBe(20_000)
    expect(m.comum.lossOutCents).toBe(-100_000)
    expect(m.comum.taxDueCents).toBe(0)
  })
  test('IRRF abate o imposto e sobra passa para o mês seguinte, zerando em janeiro', () => {
    const [nov, dez, jan] = run([
      s({ date: '2024-11-05', type: 'ETF', result: 0, irrf: 1_000 }),
      s({ date: '2024-12-05', type: 'ETF', result: 4_000 }), // 15% = 600
      s({ date: '2025-01-05', type: 'ETF', result: 2_000 }), // 15% = 300
    ], '2024-11', '2025-01')
    expect(nov.comum.irrfCarryOutCents).toBe(1_000)
    expect(dez.comum.taxDueCents).toBe(600)
    expect(dez.comum.irrfUsedCents).toBe(600)
    expect(dez.comum.taxPayableCents).toBe(0)
    expect(dez.comum.irrfCarryOutCents).toBe(400)
    expect(jan.comum.irrfUsedCents).toBe(0)
    expect(jan.comum.taxPayableCents).toBe(300)
  })
  test('IRRF entra no mês da liquidação e dentro do pote do tipo', () => {
    const [dez, jan] = run([s({ date: '2024-12-30', type: 'FII', result: 0, irrf: 500, settle: '2025-01-02' })], '2024-12', '2025-01')
    expect(dez.fii.irrfMonthCents).toBe(0)
    expect(jan.fii.irrfMonthCents).toBe(500)
    expect(jan.comum.irrfMonthCents).toBe(0)
  })
  test('mês com venda maior que a posição fica incompleto', () => {
    const w: Warning = { kind: 'venda_maior_que_posicao', ticker: 'XXXX3', date: '2024-03-15', detail: '' }
    const [fev, mar] = run([], '2024-02', '2024-03', [w])
    expect(fev.incomplete).toBe(false)
    expect(mar.incomplete).toBe(true)
  })
  test('meses sem venda aparecem e carregam o prejuízo', () => {
    const r = run([s({ date: '2024-01-10', type: 'BDR', result: -70_000 })], '2024-01', '2024-04')
    expect(r.map((m) => m.month)).toEqual(['2024-01', '2024-02', '2024-03', '2024-04'])
    expect(r[3].comum.lossInCents).toBe(-70_000)
    expect(r[3].comum.lossOutCents).toBe(-70_000)
  })
  test('vendas fora do intervalo são ignoradas', () => {
    const [m] = run([s({ date: '2023-12-10', type: 'ETF', result: 900_000 })], '2024-01', '2024-01')
    expect(m.comum.resultCents).toBe(0)
  })
  test('mês misto: lucro isento de ação absorve o prejuízo de ETF como perda a compensar', () => {
    const [m] = run([
      s({ date: '2024-03-10', gross: 1_000_000, result: 300_000 }),
      s({ date: '2024-03-11', type: 'ETF', gross: 500_000, result: -100_000 }),
    ], '2024-03', '2024-03')
    expect(m.comum.exemptProfitCents).toBe(300_000)
    expect(m.comum.baseCents).toBe(0)
    expect(m.comum.lossOutCents).toBe(-100_000)
  })
  test('imposto fracionado é truncado (piso)', () => {
    const [m] = run([s({ date: '2024-03-10', type: 'ETF', result: 333 })], '2024-03', '2024-03')
    expect(m.comum.taxDueCents).toBe(49)
  })
  test('prejuízo atravessa a virada do ano', () => {
    const [, jan] = run([
      s({ date: '2024-12-10', type: 'ETF', result: -100_000 }),
      s({ date: '2025-01-10', type: 'ETF', result: 300_000 }),
    ], '2024-12', '2025-01')
    expect(jan.comum.lossInCents).toBe(-100_000)
    expect(jan.comum.baseCents).toBe(200_000)
    expect(jan.comum.taxDueCents).toBe(30_000)
  })

  test('prejuízo inicial informado reduz o imposto do mês e vai sendo consumido', () => {
    const opening = { month: '2024-01', comumCents: 150_000, fiiCents: 0 }
    const [jan, fev, mar] = computeTax([
      s({ date: '2024-01-10', type: 'ETF', result: 100_000 }),
      s({ date: '2024-02-10', type: 'ETF', result: 100_000 }),
      s({ date: '2024-03-10', type: 'ETF', result: 100_000 }),
    ], [], '2024-01', '2024-03', opening)
    expect(jan.comum.lossInCents).toBe(-150_000)
    expect(jan.comum.taxDueCents).toBe(0)
    expect(jan.comum.lossOutCents).toBe(-50_000)
    expect(fev.comum.baseCents).toBe(50_000)
    expect(fev.comum.taxDueCents).toBe(7_500)
    expect(fev.comum.lossOutCents).toBe(0)
    expect(mar.comum.taxDueCents).toBe(15_000)
  })
  test('prejuízo inicial de FII só compensa FII, e o comum só o comum', () => {
    const [m] = computeTax([
      s({ date: '2024-05-10', type: 'ETF', result: 100_000 }),
      s({ date: '2024-05-11', type: 'FII', result: 100_000 }),
    ], [], '2024-05', '2024-05', { month: '2024-05', comumCents: 0, fiiCents: 100_000 })
    expect(m.fii.taxDueCents).toBe(0)
    expect(m.comum.taxDueCents).toBe(15_000)
  })
  test('prejuízo inicial vale a partir do mês informado e substitui o calculado antes dele', () => {
    const [, fev] = computeTax([
      s({ date: '2024-01-10', type: 'ETF', result: -30_000 }),
      s({ date: '2024-02-10', type: 'ETF', result: 100_000 }),
    ], [], '2024-01', '2024-02', { month: '2024-02', comumCents: 80_000, fiiCents: 0 })
    expect(fev.comum.lossInCents).toBe(-80_000)
    expect(fev.comum.baseCents).toBe(20_000)
  })
  test('prejuízo inicial só de FII mantém o comum calculado, e vice-versa', () => {
    const sales = [
      s({ date: '2024-01-10', type: 'ETF', result: -30_000 }),
      s({ date: '2024-01-11', type: 'FII', result: -20_000 }),
      s({ date: '2024-02-10', type: 'ETF', result: 100_000 }),
      s({ date: '2024-02-11', type: 'FII', result: 100_000 }),
    ]
    const [, soFii] = computeTax(sales, [], '2024-01', '2024-02', { month: '2024-02', comumCents: null, fiiCents: 80_000 })
    expect(soFii.comum.lossInCents).toBe(-30_000)
    expect(soFii.fii.lossInCents).toBe(-80_000)
    const [, soComum] = computeTax(sales, [], '2024-01', '2024-02', { month: '2024-02', comumCents: 50_000, fiiCents: null })
    expect(soComum.comum.lossInCents).toBe(-50_000)
    expect(soComum.fii.lossInCents).toBe(-20_000)
    // zero informado substitui de verdade
    const [, zero] = computeTax(sales, [], '2024-01', '2024-02', { month: '2024-02', comumCents: 0, fiiCents: 80_000 })
    expect(zero.comum.lossInCents).toBe(-0)
  })
})
