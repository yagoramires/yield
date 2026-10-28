import { readFileSync } from 'node:fs'
import { createTestDb } from '../db/testDb'
import { loadGastos } from '../db/gastosRepo'
import { importStatement, parseInstallment } from './extrato'
import { decodeStatement, parseOfx, type ParsedStatement } from './ofx'
import { parseExtratoCsv } from './extratoCsv'

const sgml = () => { const b = readFileSync('tests/fixtures/extrato-sgml.ofx'); return parseOfx(decodeStatement(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)) }

test('mesmo OFX duas vezes: nada novo na segunda', async () => {
  const db = await createTestDb()
  const a = await importStatement(db, sgml())
  expect(a).toMatchObject({ inserted: 3, skipped: 0 })
  expect(await importStatement(db, sgml())).toEqual({ accountId: a.accountId, inserted: 0, skipped: 3 })
  const g = await loadGastos(db)
  expect(g.accounts).toHaveLength(1)
  expect(g.accounts[0]).toMatchObject({ source: 'arquivo', itemId: null, lastSyncAt: null, kind: 'conta' })
  expect(g.txns[0]).toMatchObject({ pending: false, installment: null, operationType: null, sourceKey: 'ofx:0999:123456-7:f1' })
})

test('OFX sobrepostos somam só as linhas novas', async () => {
  const db = await createTestDb()
  const mk = (days: number[]): ParsedStatement => ({ institution: 'X', externalId: 'ofx:1:2', kind: 'conta', number: '0002',
    rows: days.map(d => ({ date: `2025-03-${String(d).padStart(2, '0')}`, description: `Loja ${d}`, amountCents: -100 * d, fitid: `f${d}` })) })
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
  expect((await importStatement(db, mk(range(1, 20)))).inserted).toBe(20)
  const r = await importStatement(db, mk(range(10, 31)))
  expect(r).toMatchObject({ inserted: 11, skipped: 11 })
  expect((await loadGastos(db)).txns).toHaveLength(31)
})

test('FITID repetido no mesmo arquivo não perde a linha e reimportar pula todas', async () => {
  const db = await createTestDb()
  const s: ParsedStatement = { institution: 'X', externalId: 'ofx:1:2', kind: 'conta', number: '0002',
    rows: [-500, -700, -900].map(amountCents => ({ date: '2025-03-01', description: 'Loja', amountCents, fitid: 'dup' })) }
  expect(await importStatement(db, s)).toMatchObject({ inserted: 3, skipped: 0 })
  expect(await importStatement(db, s)).toMatchObject({ inserted: 0, skipped: 3 })
  expect((await loadGastos(db)).txns.map(t => t.sourceKey).sort()).toEqual(['ofx:1:2:dup', 'ofx:1:2:dup#1', 'ofx:1:2:dup#2'])
})

test('sem FITID usa o fingerprint e reimportar não duplica', async () => {
  const db = await createTestDb()
  const s: ParsedStatement = { institution: 'X', externalId: 'ofx:1:2', kind: 'conta', number: null,
    rows: [1, 2].map(() => ({ date: '2025-03-01', description: 'Café', amountCents: -500, fitid: null })) }
  expect((await importStatement(db, s)).inserted).toBe(2)
  expect((await importStatement(db, s))).toMatchObject({ inserted: 0, skipped: 2 })
})

test('CSV Nubank importa com chave csv:nubank:<id>', async () => {
  const db = await createTestDb()
  const s = parseExtratoCsv(readFileSync('tests/fixtures/nubank-conta.csv', 'utf8'), 'nubank-conta', 'Nu')
  await importStatement(db, s)
  expect((await loadGastos(db)).txns.map(t => t.sourceKey)[0]).toBe('csv:nubank:aaaa1111-0000-4000-8000-000000000001')
})

test('CSV: conta leva o nome do rótulo', async () => {
  const db = await createTestDb()
  await importStatement(db, parseExtratoCsv(readFileSync('tests/fixtures/nubank-conta.csv', 'utf8'), 'nubank-conta', 'Minha Nu'))
  expect((await loadGastos(db)).accounts[0].name).toBe('Minha Nu')
})

test('Mercado Pago: REFERENCE_ID repetido não perde linhas e reimportar pula todas', async () => {
  const db = await createTestDb()
  const csv = 'RELEASE_DATE;TRANSACTION_TYPE;REFERENCE_ID;TRANSACTION_NET_AMOUNT;PARTIAL_BALANCE\n01/03/2025;Pagamento;77;-50,00;1\n01/03/2025;Tarifa;77;-1,50;1\n01/03/2025;Tarifa;77;-1,50;1\n'
  const s = () => parseExtratoCsv(csv, 'mercadopago', 'MP')
  expect(await importStatement(db, s())).toMatchObject({ inserted: 3, skipped: 0 })
  expect(await importStatement(db, s())).toMatchObject({ inserted: 0, skipped: 3 })
})

test.each([
  ['LOJA TESTE 03/10', '3/10'],
  ['PARC 3/10 LOJA', '3/10'],
  ['LOJA PARCELA 2 DE 12', '2/12'],
  ['LOJA 3 de 10', '3/10'],
  ['LOJA 12/48', '12/48'],
  ['LOJA 7/36', '7/36'],
  ['COMPRA 05/11/2024 LOJA', null], // data com ano
  ['COMPRA 05/11/24', null],
  ['PAG 2024/03/10', null],
  ['PIX 10/12 14:32', null], // data e hora
  ['LOJA 25/10', null], // parcela maior que o total
  ['LOJA 1/60', null], // total acima de 48
  ['LOJA 1/1', null],
  ['LOJA 123/456', null],
  ['SUPERMERCADO', null],
])('parcela em "%s" → %s', (description, installment) => {
  expect(parseInstallment(description)).toBe(installment)
})

test('importStatement grava a parcela lida da descrição', async () => {
  const db = await createTestDb()
  await importStatement(db, { institution: 'Banco Laranja', name: 'Cartão', externalId: 'csv:x', kind: 'cartao', number: null, rows: [{ date: '2024-03-01', description: 'LOJA 03/10', amountCents: -1000, fitid: null }] })
  expect((await loadGastos(db)).txns[0].installment).toBe('3/10')
})
