import { describe, expect, it } from 'vitest'
import type { BudgetLine, IncomeSource } from '../db/orcamentoRepo'
import { DEFAULT_PJ } from '../db/orcamentoRepo'
import type { Category, Txn } from '../db/gastosRepo'
import type { Subscription } from './assinaturas'
import { copyLines, monthSummary, nextMonthLines, pjNet, planVsReal, sourceNet } from './orcamento'
import { suggestForMonth } from './sugestoes'

const line = (o: Partial<BudgetLine>): BudgetLine => ({ id: 'l', month: '2026-03', kind: 'saida', name: 'Item', amountCents: 1000, recurring: true, position: 0, categoryId: null, installmentCurrent: null, installmentTotal: null, sourceId: null, sourceKey: 'k', ...o })
const src = (o: Partial<IncomeSource> = {}): IncomeSource => ({ id: 's1', name: 'F', kind: 'pj', grossCents: 1_000_000, ...DEFAULT_PJ, contabilidadeCents: 30_000, netCents: null, sourceKey: null, ...o })
const cat = (id: string, countsAsSpending = true): Category => ({ id, name: id, countsAsSpending, builtin: true, icon: null, color: null })
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

describe('sourceNet', () => {
  it('pj usa pjNet; fixo usa o líquido informado', () => {
    expect(sourceNet(src())).toBe(879_200)
    expect(sourceNet(src({ kind: 'fixo', grossCents: null, netCents: 400_000 }))).toBe(400_000)
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
    ], [])
    expect(out.map(l => [l.name, l.position, l.installmentCurrent, l.sourceKey])).toEqual([['a', 0, 5, null], ['d', 3, null, null]])
    expect(out[0]).not.toHaveProperty('id')
    expect(out[0]).not.toHaveProperty('month')
  })
  it('linha ligada a fonte recalcula pela fonte atual', () => {
    const l = line({ kind: 'entrada', sourceId: 's1', amountCents: 1 })
    expect(nextMonthLines([l], [src()])[0]).toMatchObject({ amountCents: 879_200, sourceId: 's1' })
    expect(nextMonthLines([l], [src({ irpjPct: 10 })])[0].amountCents).toBe(sourceNet(src({ irpjPct: 10 })))
    expect(nextMonthLines([l], [src({ kind: 'fixo', netCents: 123 })])[0].amountCents).toBe(123)
  })
  it('fonte que sumiu: mantém o valor e solta o vínculo', () => {
    const l = line({ kind: 'entrada', sourceId: 'x', amountCents: 555 })
    expect(nextMonthLines([l], [src()])[0]).toMatchObject({ amountCents: 555, sourceId: null })
  })
  it('chave de sugestão vai junto com o mês novo; chave da planilha vira nula', () => {
    const out = nextMonthLines([line({ sourceKey: 'sub:c1|netflix@2026-03' }), line({ sourceKey: 'parc:c1|loja|10|100@2026-03' }), line({ sourceKey: 'planilha:2026-03:3' })], [])
    expect(out.map(l => l.sourceKey)).toEqual(['sub:c1|netflix@2026-04', 'parc:c1|loja|10|100@2026-04', null])
  })
  it('assinatura copiada esconde a sugestão no mês novo', () => {
    const s: Subscription = { merchantKey: 'c1|netflix', name: 'NETFLIX', accountId: 'c1', period: 'mensal', amountCents: 3990, monthlyCents: 3990, yearlyCents: 47880, lastDate: '2026-03-05', nextDate: '2026-04-05', active: true, charges: 3, previousAmountCents: null }
    const [copied] = nextMonthLines([line({ sourceKey: suggestForMonth('2026-03', [s], [], () => null, [], [])[0].key })], [])
    expect(suggestForMonth('2026-04', [s], [], () => null, [{ ...copied, id: 'n', month: '2026-04' }], [])).toEqual([])
  })
  it('parcela 4/10 aceita vira 5/10 no mês seguinte e esconde a sugestão 5/10', () => {
    const t = [txn({ date: '2026-02-10', description: 'LOJA X', amountCents: -10000, installment: '3/10' })]
    const [sug] = suggestForMonth('2026-03', [], t, () => null, [], [])
    expect(sug.installmentCurrent).toBe(4)
    const [copied] = nextMonthLines([line({ sourceKey: sug.key, installmentCurrent: 4, installmentTotal: 10 })], [])
    expect(copied.installmentCurrent).toBe(5)
    expect(suggestForMonth('2026-04', [], t, () => null, [{ ...copied, id: 'n', month: '2026-04' }], [])).toEqual([])
    expect(suggestForMonth('2026-04', [], t, () => null, [], [])[0].installmentCurrent).toBe(5)
  })
})

describe('copyLines', () => {
  it('copiar de 3 meses antes avança a parcela 3 vezes e larga as que já acabaram', () => {
    const out = copyLines([
      line({ name: 'a', installmentCurrent: 2, installmentTotal: 10, sourceKey: 'parc:k@2026-03' }),
      line({ name: 'b', installmentCurrent: 8, installmentTotal: 10 }),
      line({ name: 'c' }),
    ], [], '2026-06')
    expect(out.map(l => [l.name, l.installmentCurrent, l.sourceKey])).toEqual([['a', 5, 'parc:k@2026-06'], ['c', null, null]])
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
