import { expect, test } from 'vitest'
import type { Txn } from '../db/gastosRepo'
import type { BudgetLine } from '../db/orcamentoRepo'
import { installmentIn, purchaseOfKey, purchases, staleInstallmentLines } from './parcelas'

let seq = 0
const t = (date: string, installment: string, amountCents: number, description: string, accountId = 'xp'): Txn =>
  ({ id: `t${seq++}`, accountId, date, description, amountCents: -amountCents, pending: false, installment, operationType: null, fingerprint: `f${seq}`, sourceKey: `s${seq}` })
const TODAY = '2026-11-03'

test('XP: 1ª com centavos a mais e as outras com a data do dia seguinte são uma compra só, ainda em aberto', () => {
  const [p, ...rest] = purchases([t('2026-08-16', '1/10', 14066, 'MP*LOJA AZUL'), t('2026-08-17', '2/10', 14059, 'MP*LOJA AZUL')], TODAY)
  expect(rest).toEqual([])
  expect(p).toMatchObject({ total: 10, maxN: 2, open: true, amountCents: 14059 })
  expect(installmentIn(p, '2026-11')).toBe(4) // datas coladas: conta da 1ª (agosto) até novembro
  expect(purchaseOfKey([p], 'parc:xp|loja azul|10|14066@2026-11')).toBe(p)
  expect(purchaseOfKey([p], 'parc:xp|loja azul|10|14059@2026-11')).toBe(p)
})

test('XP antecipada: as parcelas que faltavam chegam todas no mesmo dia e a compra fecha', () => {
  const rest = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => t('2026-07-12', `${n}/12`, 29583, 'AMAZONMKTPLC*CASA'))
  const [p] = purchases([t('2026-07-11', '1/12', 29584, 'AMAZONMKTPLC*CASA'), ...rest], TODAY)
  expect(p).toMatchObject({ maxN: 12, open: false })
})

test('Nubank: terminou (3/3 na fatura) fecha; antecipação com as últimas no mesmo dia também', () => {
  const steam = purchases([t('2026-09-13', '1/3', 4001, 'Pag*Jogos 1/3', 'nu'), t('2026-09-30', '2/3', 3999, 'Pag*Jogos 2/3', 'nu'), t('2026-10-01', '3/3', 3999, 'Pag*Jogos 3/3', 'nu')], TODAY)
  expect(steam).toHaveLength(1)
  expect(steam[0].open).toBe(false)
  const loja = purchases([7, 8, 9].map(n => t('2026-01-04', `${n}/9`, 6327, 'Shopee *Colchao', 'nu')), TODAY)
  expect(loja[0].open).toBe(false)
})

test('Mercado Pago: descrição que encurta no meio e parcela do mês seguinte pendente continuam a mesma compra', () => {
  const ts = [t('2026-03-31', '1/11', 3894, 'MERCADOLIVRE*MERCADOLIVRE', 'mp'), ...[2, 3, 4, 5, 6, 7].map(n => t(`2026-${String(n + 3).padStart(2, '0')}-05`, `${n}/11`, 3891, 'MERCADOLIVRE*MERCADOLIVRE', 'mp')),
    t('2026-11-03', '8/11', 3891, 'MERCADOLIVRE*MERC', 'mp'), t('2026-12-03', '9/11', 3891, 'MERCADOLIVRE*MERC', 'mp')]
  const [p, ...rest] = purchases(ts, TODAY)
  expect(rest).toEqual([])
  expect(p).toMatchObject({ maxN: 9, open: true })
  expect(installmentIn(p, '2026-11')).toBe(8) // datas de fatura: conta da mais recente até o mês
  expect(installmentIn(p, '2027-01')).toBe(10)
})

test('duas compras iguais no mesmo lugar não se misturam; última parcela com data futura ainda está em aberto', () => {
  const ps = purchases([t('2026-10-05', '1/2', 5000, 'LOJA'), t('2026-10-06', '1/2', 5000, 'LOJA'), t('2026-12-05', '2/2', 5000, 'LOJA')], TODAY)
  expect(ps).toHaveLength(2)
  expect(ps[0]).toMatchObject({ maxN: 2, open: true })
})

test('parcela repetida sozinha de uma compra que já teria terminado pelo calendário não fica em aberto', () => {
  const ps = purchases([t('2026-04-05', '1/3', 40522, 'LOJA X'), t('2026-04-06', '1/3', 40622, 'LOJA X'), t('2026-04-07', '2/3', 40622, 'LOJA X'), t('2026-04-07', '3/3', 40622, 'LOJA X')], TODAY)
  expect(ps.map(p => p.open)).toEqual([false, false])
})

test('limpeza do plano: tira quitada e repetida, deixa a aberta e a última parcela de verdade', () => {
  const line = (id: string, month: string, current: number, total: number, sourceKey: string): BudgetLine =>
    ({ id, month, kind: 'saida', name: id, amountCents: 1, recurring: true, position: 0, categoryId: null, installmentCurrent: current, installmentTotal: total, sourceId: null, sourceKey, grupo: 'fixo' })
  const ps = purchases([
    t('2026-08-16', '1/10', 14066, 'MP*LOJA AZUL'), t('2026-08-17', '2/10', 14059, 'MP*LOJA AZUL'), // XP em aberto
    t('2026-07-11', '1/12', 29584, 'CASA', 'xp'), ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => t('2026-07-12', `${n}/12`, 29583, 'CASA')), // XP antecipada
    t('2026-09-05', '1/2', 5000, 'FIM', 'mp'), t('2026-10-05', '2/2', 5000, 'FIM', 'mp'), // terminou em outubro
  ], TODAY)
  const lines = [
    line('azul4', '2026-11', 4, 10, 'parc:xp|loja azul|10|14066@2026-11'), line('azul5', '2026-11', 5, 10, 'parc:xp|loja azul|10|14059@2026-11'),
    line('casa', '2026-11', 5, 12, 'parc:xp|casa|12|29584@2026-11'),
    line('fim-out', '2026-10', 2, 2, 'parc:mp|fim|2|5000@2026-10'),
    line('mao', '2026-11', 3, 6, null as unknown as string), line('passado', '2026-09', 2, 12, 'parc:xp|casa|12|29584@2026-09'),
  ]
  expect(staleInstallmentLines(lines, ps, '2026-10').map(l => l.id).sort()).toEqual(['azul5', 'casa'])
})
