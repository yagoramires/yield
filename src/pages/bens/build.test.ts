import { expect, test } from 'vitest'
import { changeKind, newBemForm, toBemForm, validateBem } from './build'

const base = { ...newBemForm('veiculo'), name: ' Onix ', boughtAt: '2026-03-10', cost: '90.000,00' }

test('à vista: só nome, data e valor; vencimentos sugeridos do veículo vêm junto', () => {
  const v = validateBem(base, '2026-11-02')
  expect(v).toMatchObject({ kind: 'veiculo', name: 'Onix', details: null, costCents: 9_000_000, valueCents: null, installmentCents: null, firstInstallment: null })
  expect(v.reminders.map(r => [r.name, r.day, r.month])).toEqual([['IPVA', 10, 1], ['Licenciamento', 10, 3]])
})

test('financiado: parcela, total e primeira parcela viram o financiamento; erros em pt-BR', () => {
  const f = { ...base, financed: true, down: '30.000', installment: '1.500,00', total: '48', first: '4/2026' }
  expect(validateBem(f, '2026-11-02')).toMatchObject({ downPaymentCents: 3_000_000, installmentCents: 150_000, installmentsTotal: 48, firstInstallment: '2026-04', debtCents: null })
  expect(() => validateBem({ ...f, first: '2026-04' }, '2026-11-02')).toThrow('Primeira parcela')
  expect(() => validateBem({ ...f, total: '4,5' }, '2026-11-02')).toThrow('Número de parcelas')
  expect(() => validateBem({ ...base, name: '' }, '2026-11-02')).toThrow('Nome')
  expect(() => validateBem({ ...base, boughtAt: '2026-12-01' }, '2026-11-02')).toThrow('depois de hoje')
  expect(() => validateBem({ ...base, reminders: [{ name: 'IPVA', date: '32/01', amount: '' }] }, '2026-11-02')).toThrow('IPVA: use dia/mês')
})

test('"vale hoje" guarda a data em que mudou; sem mudar, fica a data antiga', () => {
  const p = { id: 'b1', ...validateBem({ ...base, value: '80.000' }, '2026-06-01') }
  expect(p.valueAt).toBe('2026-06-01')
  expect(validateBem(toBemForm(p), '2026-11-02', p).valueAt).toBe('2026-06-01')
  expect(validateBem({ ...toBemForm(p), value: '78.000' }, '2026-11-02', p).valueAt).toBe('2026-11-02')
})

test('trocar o tipo troca os vencimentos sugeridos só se ninguém mexeu neles', () => {
  expect(changeKind(newBemForm('veiculo'), 'apartamento').reminders.map(r => r.name)).toEqual(['IPTU'])
  const mexido = { ...newBemForm('veiculo'), reminders: [{ name: 'Seguro', date: '05/07', amount: '' }] }
  expect(changeKind(mexido, 'casa').reminders.map(r => r.name)).toEqual(['Seguro'])
})
