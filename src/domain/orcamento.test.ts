import { describe, expect, it } from 'vitest'
import type { BudgetLine } from '../db/orcamentoRepo'
import { DEFAULT_PJ } from '../db/orcamentoRepo'
import type { Category, Txn } from '../db/gastosRepo'
import { monthSummary, nextMonthLines, pjNet, planVsReal } from './orcamento'

const line = (o: Partial<BudgetLine>): BudgetLine => ({ id: 'l', month: '2026-03', kind: 'saida', name: 'Item', amountCents: 1000, recurring: true, position: 0, categoryId: null, installmentCurrent: null, installmentTotal: null, pjGrossCents: null, sourceKey: 'k', ...o })
const cat = (id: string, countsAsSpending = true): Category => ({ id, name: id, countsAsSpending, builtin: true })
const cats: Record<string, Category> = { mercado: cat('mercado'), fatura: cat('pagamento-de-fatura', false) }
const txn = (o: Partial<Txn> & { cat?: string }): Txn => ({ id: 't', accountId: 'c1', date: '2026-03-10', description: 'LOJA', amountCents: -1000, pending: false, installment: null, operationType: null, fingerprint: 'fp', sourceKey: 's', ...o })
const catOf = (t: Txn) => cats[t.description] ?? null

describe('pjNet', () => {
  it('divide o bruto e fecha o líquido', () => {
    expect(pjNet(1_000_000, { ...DEFAULT_PJ, contabilidadeCents: 30_000 })).toEqual({ grossCents: 1_000_000, proLaboreCents: 280_000, irpjCents: 60_000, inssCents: 30_800, contabilidadeCents: 30_000, outrosCents: 0, netCents: 879_200 })
  })
  it('bruto ímpar fecha em centavos', () => {
    const b = pjNet(333_333, { ...DEFAULT_PJ, contabilidadeCents: 12_345, outrosCents: 99 })
    expect(b.irpjCents + b.inssCents + b.contabilidadeCents + b.outrosCents + b.netCents).toBe(333_333)
    expect(b.proLaboreCents).toBe(Math.round(333_333 * 0.28))
    expect(b.inssCents).toBe(Math.round(b.proLaboreCents * 0.11))
  })
})

describe('monthSummary', () => {
  it('soma entradas, saídas e saldo', () => {
    expect(monthSummary([line({ kind: 'entrada', amountCents: 5000 }), line({ amountCents: 1200 }), line({ amountCents: 300 })])).toEqual({ entradasCents: 5000, saidasCents: 1500, saldoCents: 3500 })
  })
})

describe('nextMonthLines', () => {
  it('só recorrentes; parcela avança; última sai; sourceKey nulo; posição mantida', () => {
    const out = nextMonthLines([
      line({ name: 'a', position: 0, installmentCurrent: 4, installmentTotal: 5 }),
      line({ name: 'b', position: 1, installmentCurrent: 5, installmentTotal: 5 }),
      line({ name: 'c', position: 2, recurring: false }),
      line({ name: 'd', position: 3 }),
    ], DEFAULT_PJ)
    expect(out.map(l => [l.name, l.position, l.installmentCurrent, l.sourceKey])).toEqual([['a', 0, 5, null], ['d', 3, null, null]])
    expect(out[0]).not.toHaveProperty('id')
    expect(out[0]).not.toHaveProperty('month')
  })
  it('linha PJ usa o cfg atual', () => {
    const l = line({ kind: 'entrada', pjGrossCents: 1_000_000, amountCents: 1 })
    expect(nextMonthLines([l], DEFAULT_PJ)[0].amountCents).toBe(pjNet(1_000_000, DEFAULT_PJ).netCents)
    const cfg = { ...DEFAULT_PJ, irpjPct: 10 }
    expect(nextMonthLines([l], cfg)[0].amountCents).toBe(pjNet(1_000_000, cfg).netCents)
    expect(nextMonthLines([l], cfg)[0].amountCents).not.toBe(pjNet(1_000_000, DEFAULT_PJ).netCents)
  })
})

describe('planVsReal', () => {
  it('compra no cartão + pagamento de fatura contam uma vez', () => {
    const txns = [txn({ amountCents: -10_000 }), txn({ description: 'fatura', amountCents: -10_000 })]
    expect(planVsReal([], txns, catOf, '2026-03').realSpentCents).toBe(10_000)
  })
  it('categoria ligada: planejado x real, só do mês', () => {
    const lines = [
      line({ name: 'Mercado', amountCents: 150_000, categoryId: 'mercado' }),
      line({ name: 'Outro', amountCents: 5000, categoryId: 'mercado', month: '2026-04' }),
      line({ name: 'Sem cat', amountCents: 7000 }),
      line({ name: 'Entrada', kind: 'entrada', amountCents: 9999, categoryId: 'mercado' }),
    ]
    const r = planVsReal(lines, [txn({ description: 'mercado', amountCents: -161_840 })], catOf, '2026-03')
    expect(r.byCategory).toEqual([{ categoryId: 'mercado', plannedCents: 150_000, realCents: 161_840 }])
    expect(r.plannedSaidasCents).toBe(157_000)
  })
  it('categoria sem gasto real tem 0; ordena por planejado desc', () => {
    const r = planVsReal([line({ amountCents: 100, categoryId: 'x' }), line({ amountCents: 900, categoryId: 'mercado' })], [], catOf, '2026-03')
    expect(r.byCategory).toEqual([{ categoryId: 'mercado', plannedCents: 900, realCents: 0 }, { categoryId: 'x', plannedCents: 100, realCents: 0 }])
  })
})
