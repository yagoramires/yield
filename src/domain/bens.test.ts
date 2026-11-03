import { expect, test } from 'vitest'
import type { Category, Txn } from '../db/gastosRepo'
import type { Possession } from '../db/bensRepo'
import { costsOf, debtOf, installmentOf, irDiscriminacao, irSituacao, patrimonio, remaining, upcoming } from './bens'

const bem = (over: Partial<Possession> = {}): Possession => ({
  id: 'b1', kind: 'veiculo', name: 'Onix', details: null, boughtAt: '2026-03-10', costCents: 9_000_000, valueCents: null, valueAt: null,
  downPaymentCents: null, installmentCents: null, installmentsTotal: null, firstInstallment: null, debtCents: null, categoryIds: [], reminders: [], ...over,
})
const fin = bem({ downPaymentCents: 3_000_000, installmentCents: 150_000, installmentsTotal: 48, firstInstallment: '2026-04' })

test('parcela do mês e quantas faltam, contando a do mês', () => {
  expect(installmentOf(fin, '2026-03')).toBeNull()
  expect(installmentOf(fin, '2026-04')).toBe(1)
  expect(installmentOf(fin, '2026-10')).toBe(7)
  expect(installmentOf(fin, '2030-03')).toBe(48)
  expect(installmentOf(fin, '2030-04')).toBeNull()
  expect(remaining(fin, '2026-10')).toBe(42)
  expect(remaining(fin, '2026-01')).toBe(48)
  expect(remaining(fin, '2031-01')).toBe(0)
  expect(remaining(bem(), '2026-10')).toBe(0)
})

test('quanto falta: saldo informado ganha da estimativa; quitado não deve nada', () => {
  expect(debtOf(fin, '2026-10')).toEqual({ cents: 150_000 * 42, estimated: true })
  expect(debtOf({ ...fin, debtCents: 5_500_000 }, '2026-10')).toEqual({ cents: 5_500_000, estimated: false })
  expect(debtOf({ ...fin, debtCents: 5_500_000 }, '2031-01')).toEqual({ cents: 0, estimated: false })
})

test('patrimônio soma investimentos, contas e bens (valor de hoje ou o da compra) e tira as dívidas', () => {
  const p = patrimonio([fin, bem({ id: 'b2', costCents: 100_000, valueCents: 80_000 })], 1_000_000, 200_000, '2026-10')
  expect(p).toEqual({ investCents: 1_000_000, contasCents: 200_000, bensCents: 9_080_000, dividasCents: 6_300_000, totalCents: 1_000_000 + 200_000 + 9_080_000 - 6_300_000 })
})

test('custo do bem: média dos meses fechados com lançamento, só das categorias dele', () => {
  const carro: Category = { id: 'carro', name: 'Carro', countsAsSpending: true, builtin: false, icon: null, color: null }
  const t = (id: string, date: string, amountCents: number, c: Category | null = carro) => ({ txn: { id, accountId: 'a', date, description: id, amountCents, pending: false, installment: null, operationType: null, fingerprint: id, sourceKey: id } as Txn, c })
  const list = [t('ipva', '2026-08-05', -300_000), t('posto', '2026-09-02', -20_000), t('estorno', '2026-09-03', 5_000), t('mercado', '2026-09-04', -40_000, null), t('posto2', '2026-10-02', -25_000)]
  const cat = (x: Txn) => list.find(l => l.txn.id === x.id)!.c
  const c = costsOf(bem({ categoryIds: ['carro'] }), list.map(l => l.txn), cat, '2026-10-20')
  expect(c).toEqual({ totalCents: 320_000, months: 2, avgCents: 160_000, thisMonthCents: 25_000 })
  expect(costsOf(bem(), list.map(l => l.txn), cat, '2026-10-20').totalCents).toBe(0)
})

test('vencimentos: o de hoje entra, o que já passou vai para o ano seguinte, fora da janela some', () => {
  const b = bem({ reminders: [{ name: 'IPVA', day: 10, month: 1, amountCents: null }, { name: 'Seguro', day: 2, month: 11, amountCents: 250_000 }, { name: 'Revisão', day: 31, month: 2, amountCents: null }] })
  expect(upcoming([b], '2026-11-02').map(u => [u.reminder.name, u.date, u.inDays])).toEqual([['Seguro', '2026-11-02', 0]])
  expect(upcoming([b], '2026-11-03', 90).map(u => [u.reminder.name, u.date])).toEqual([['IPVA', '2027-01-10']])
  expect(upcoming([b], '2027-01-15', 60).map(u => u.date)).toEqual(['2027-02-28']) // dia 31 em fevereiro cai no último dia
})

test('IR: à vista pelo custo; financiado pela entrada mais as parcelas pagas até dezembro; antes da compra não entra', () => {
  expect(irSituacao(bem(), 2025)).toBeNull()
  expect(irSituacao(bem(), 2026)).toEqual({ cents: 9_000_000, paid: 0 })
  expect(irSituacao(fin, 2026)).toEqual({ cents: 3_000_000 + 9 * 150_000, paid: 9 })
  expect(irSituacao(fin, 2031)).toEqual({ cents: 3_000_000 + 48 * 150_000, paid: 48 })
  expect(irDiscriminacao({ ...fin, details: 'placa ABC1D23' }, 2026)).toBe(
    'Veículo Onix - placa ABC1D23. Adquirido em 10/03/2026 por R$ 90.000,00, com entrada de R$ 30.000,00 e financiamento em 48 parcelas de R$ 1.500,00 a partir de 04/2026. Valor pago até 31/12/2026: R$ 43.500,00 (entrada e 9 parcelas).'.replace(/R\$ /g, 'R$ '),
  )
  expect(irDiscriminacao(bem(), 2026)).toBe('Veículo Onix. Adquirido em 10/03/2026 por R$ 90.000,00, à vista.')
})
