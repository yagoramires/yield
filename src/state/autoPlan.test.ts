import { expect, test } from 'vitest'
import type { GastosData, Txn } from '../db/gastosRepo'
import { createMonth, deleteLine, deleteMonth, dismissSuggestion, loadOrcamento, type BudgetLine } from '../db/orcamentoRepo'
import { createTestDb } from '../db/testDb'
import type { Subscription } from '../domain/assinaturas'
import { autoPlan, dismissedFor, MES_APAGADO } from './autoPlan'

const txn = (id: string, date: string, installment: string, amountCents: number): Txn =>
  ({ id, accountId: 'xp', date, description: 'MP*LOJA AZUL', amountCents: -amountCents, pending: false, installment, operationType: null, fingerprint: id, sourceKey: id })
const g = { txns: [txn('a', '2026-08-16', '1/10', 14066), txn('b', '2026-08-17', '2/10', 14059)] } as GastosData
const sub: Subscription = { merchantKey: 'xp|streaming', name: 'STREAMING', accountId: 'xp', period: 'mensal', amountCents: 3990, monthlyCents: 3990, yearlyCents: 47880,
  lastDate: '2026-10-05', nextDate: '2026-11-05', active: true, canceledAt: null, charges: 4, previousAmountCents: null }
const aluguel: Omit<BudgetLine, 'id' | 'month'> = { kind: 'saida', name: 'Aluguel', amountCents: 200000, recurring: true, position: 0, categoryId: 'moradia', installmentCurrent: null, installmentTotal: null, sourceId: null, sourceKey: null, grupo: 'fixo' }

test('mês novo nasce do anterior com o que foi detectado; rodar de novo não muda nada; o que a pessoa apagou não volta', async () => {
  const db = createTestDb()
  await createMonth(db, '2026-10', [aluguel])
  const run = async () => autoPlan(db, await loadOrcamento(db), g, () => null, [sub], [], '2026-11-03')

  expect(await run()).toMatchObject({ changed: true })
  const nov = (await loadOrcamento(db)).lines.filter(l => l.month === '2026-11')
  expect(nov.map(l => [l.name, l.installmentCurrent]).sort()).toEqual([['Aluguel', null], ['Loja Azul', 4], ['Streaming', null]])

  expect(await run()).toEqual({ changed: false, removed: [] })
  expect((await loadOrcamento(db)).lines.filter(l => l.month === '2026-11')).toHaveLength(3)

  const streaming = nov.find(l => l.name === 'Streaming')!
  await deleteLine(db, streaming.id)
  await dismissSuggestion(db, '*', streaming.sourceKey!.replace(/@\d{4}-\d{2}$/, ''))
  expect(await run()).toEqual({ changed: false, removed: [] })
  expect((await loadOrcamento(db)).lines.some(l => l.month === '2026-11' && l.name === 'Streaming')).toBe(false)
})

test('dispensa de "nunca mais" vale em qualquer mês', () => {
  expect(dismissedFor([{ month: '2026-11', key: 'a@2026-11' }, { month: '*', key: 'sub:x' }, { month: '2026-10', key: 'b@2026-10' }], '2026-11')).toEqual(['a@2026-11', 'sub:x@2026-11'])
})

test('mês atual excluído pela pessoa não volta sozinho', async () => {
  const db = createTestDb()
  await createMonth(db, '2026-10', [aluguel])
  await deleteMonth(db, '2026-11')
  await dismissSuggestion(db, '2026-11', MES_APAGADO)
  await autoPlan(db, await loadOrcamento(db), g, () => null, [], [], '2026-11-03')
  expect((await loadOrcamento(db)).months).toEqual(['2026-10'])
})

test('assinatura cancelada sai dos meses depois do cancelamento', async () => {
  const db = createTestDb()
  const line = { ...aluguel, name: 'Streaming', amountCents: 3990 }
  await createMonth(db, '2026-11', [{ ...line, sourceKey: 'sub:xp|streaming@2026-11' }])
  await createMonth(db, '2026-12', [{ ...line, sourceKey: 'sub:xp|streaming@2026-12' }])
  await autoPlan(db, await loadOrcamento(db), { txns: [] } as unknown as GastosData, () => null, [{ ...sub, active: false, canceledAt: '2026-11-02' }], [], '2026-11-03')
  expect((await loadOrcamento(db)).lines.map(l => l.month)).toEqual(['2026-11'])
})

test('linha automática apagada sai também dos meses seguintes que já existiam (o próximo mês não a copia de volta)', async () => {
  const db = createTestDb()
  const line = { ...aluguel, name: 'Streaming', amountCents: 3990 }
  await createMonth(db, '2026-11', [{ ...line, sourceKey: 'sub:xp|streaming@2026-11' }])
  await createMonth(db, '2026-12', [{ ...line, sourceKey: 'sub:xp|streaming@2026-12' }])
  const nov = (await loadOrcamento(db)).lines.find(l => l.month === '2026-11')!
  await deleteLine(db, nov.id)
  await dismissSuggestion(db, '*', 'sub:xp|streaming')
  await autoPlan(db, await loadOrcamento(db), { txns: [] } as unknown as GastosData, () => null, [sub], [], '2026-11-03')
  expect((await loadOrcamento(db)).lines).toEqual([])
})

test('assinatura que já está escrita à mão no mês não entra de novo', async () => {
  const db = createTestDb()
  await createMonth(db, '2026-11', [{ ...aluguel, name: 'streaming premium', amountCents: 3990, categoryId: null }])
  await autoPlan(db, await loadOrcamento(db), { txns: [] } as unknown as GastosData, () => null, [sub], [], '2026-11-03')
  expect((await loadOrcamento(db)).lines.map(l => l.name)).toEqual(['streaming premium'])
})
