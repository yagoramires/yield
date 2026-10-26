import { createTestDb } from '../db/testDb'
import { loadAll, upsertDividends } from '../db/repo'
import { makeB3, type B3Row } from '../../tests/fixtures/makeB3'
import { importB3, parseB3Movimentacao } from './b3'

const CLEAR = 'CLEAR CORRETORA - GRUPO XP'
const row = (io: string, data: string, mov: string, produto: string, qtd: string, preco = '-', valor = '-'): B3Row => [io, data, mov, produto, CLEAR, qtd, preco, valor]

test('proventos, bonificação e desdobro', () => {
  const p = parseB3Movimentacao(makeB3([
    row('Credito', '14/03/2024', 'Rendimento', 'HGLG11 - CSHG LOGISTICA FII', '10', '1,10', '11,00'),
    row('Credito', '20/04/2024', 'Bonificação em Ativos', 'ITSA4 - ITAUSA S.A.', '5'),
    row('Credito', '02/05/2024', 'Desdobro', 'BBAS3 - BANCO DO BRASIL S.A.', '100'),
    row('Debito', '05/01/2024', 'Transferência - Liquidação', 'ITSA4 - ITAUSA S.A.', '100', '10,00', '1.000,00'),
  ]))
  expect(p.dividends[0]).toMatchObject({ ticker: 'HGLG11', kind: 'Rendimento', payDate: '2024-03-14', amountCents: 1100, source: 'b3', broker: 'CLEAR' })
  expect(p.events.map(e => e.kind)).toEqual(['bonificacao', 'desdobramento'])
  expect(p.events[0]).toMatchObject({ ticker: 'ITSA4', date: '2024-04-20', qtyDelta: 5, unitCostCents: null })
  expect(p.events[0].sourceKey).toBe(`b3:2024-04-20:Bonificação em Ativos:ITSA4 - ITAUSA S.A.:${CLEAR}:5:-`)
  expect(p.events[1]).toMatchObject({ ticker: 'BBAS3', qtyDelta: 100 })
  expect(p.ignored).toBe(1)
})

test('grupamento com Debito reduz a quantidade e 1.000 vira mil', () => {
  const p = parseB3Movimentacao(makeB3([row('Debito', '10/06/2024', 'Grupamento', 'MGLU3 - MAGAZINE LUIZA S.A.', '1.000')]))
  expect(p.events).toHaveLength(1)
  expect(p.events[0]).toMatchObject({ kind: 'grupamento', ticker: 'MGLU3', qtyDelta: -1000 })
})

test('JCP e Dividendo viram proventos', () => {
  const p = parseB3Movimentacao(makeB3([
    row('Credito', '01/07/2024', 'Juros Sobre Capital Próprio', 'ITSA4 - ITAUSA S.A.', '100', '0,05', '5,00'),
    row('Credito', '01/07/2024', 'Dividendo', 'BBAS3 - BANCO DO BRASIL S.A.', '100', '0,10', '10,00'),
  ]))
  expect(p.dividends.map(d => [d.kind, d.amountCents])).toEqual([['JCP', 500], ['Dividendo', 1000]])
})

test('Atualização e Amortização vão para revisão', () => {
  const p = parseB3Movimentacao(makeB3([
    row('Credito', '03/03/2024', 'Atualização', 'HGLG11 - CSHG LOGISTICA FII', '10'),
    row('Credito', '04/03/2024', 'Amortização', 'XPLG11 - XP LOG FII', '10', '1,00', '10,00'),
  ]))
  expect(p.toReview).toEqual([
    { date: '2024-03-03', movimentacao: 'Atualização', produto: 'HGLG11 - CSHG LOGISTICA FII' },
    { date: '2024-03-04', movimentacao: 'Amortização', produto: 'XPLG11 - XP LOG FII' },
  ])
  expect(p.dividends).toHaveLength(0)
  expect(p.events).toHaveLength(0)
  expect(p.ignored).toBe(0)
})

test('importar o mesmo extrato duas vezes não duplica', async () => {
  const db = await createTestDb()
  const data = makeB3([
    row('Credito', '14/03/2024', 'Rendimento', 'HGLG11 - CSHG LOGISTICA FII', '10', '1,10', '11,00'),
    row('Credito', '20/04/2024', 'Bonificação em Ativos', 'ITSA4 - ITAUSA S.A.', '5'),
  ])
  expect(await importB3(db, parseB3Movimentacao(data))).toEqual({ dividends: 1, dividendsSkipped: 0, replaced: 0, events: 1, eventsSkipped: 0 })
  expect(await importB3(db, parseB3Movimentacao(data))).toEqual({ dividends: 0, dividendsSkipped: 1, replaced: 0, events: 0, eventsSkipped: 1 })
  const all = await loadAll(db)
  expect(all.dividends).toHaveLength(1)
  expect(all.events).toHaveLength(1)
})

test('provento da B3 substitui o da planilha do mesmo ticker e mês', async () => {
  const db = await createTestDb()
  await upsertDividends(db, [{ ticker: 'HGLG11', kind: 'Rendimento', payDate: '2024-03-01', amountCents: 1000, broker: null, source: 'planilha', sourceKey: 'planilha:HGLG11:2024-03:Rendimento' }])
  const r = await importB3(db, parseB3Movimentacao(makeB3([row('Credito', '14/03/2024', 'Rendimento', 'HGLG11 - CSHG LOGISTICA FII', '10', '1,10', '11,00')])))
  expect(r).toMatchObject({ dividends: 1, replaced: 1 })
  expect((await loadAll(db)).dividends.map(d => d.source)).toEqual(['b3'])
})
