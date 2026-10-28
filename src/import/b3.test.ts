import { utils, write } from 'xlsx'
import { createTestDb } from '../db/testDb'
import { loadAll, saveNote, upsertDividends } from '../db/repo'
import { makeB3, makeNegociacao, makeProventos, type B3Row } from '../../tests/fixtures/makeB3'
import { assetTypeOf, importB3, parseB3, typeFromName } from './b3'

const CLEAR = 'CLEAR CORRETORA - GRUPO XP'
const row = (io: string, data: string, mov: string, produto: string, qtd: string, preco = '-', valor = '-'): B3Row => [io, data, mov, produto, CLEAR, qtd, preco, valor]

test('proventos, bonificação e desdobro', () => {
  const p = parseB3(makeB3([
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
  const p = parseB3(makeB3([row('Debito', '10/06/2024', 'Grupamento', 'MGLU3 - MAGAZINE LUIZA S.A.', '1.000')]))
  expect(p.events).toHaveLength(1)
  expect(p.events[0]).toMatchObject({ kind: 'grupamento', ticker: 'MGLU3', qtyDelta: -1000 })
})

test('JCP e Dividendo viram proventos', () => {
  const p = parseB3(makeB3([
    row('Credito', '01/07/2024', 'Juros Sobre Capital Próprio', 'ITSA4 - ITAUSA S.A.', '100', '0,05', '5,00'),
    row('Credito', '01/07/2024', 'Dividendo', 'BBAS3 - BANCO DO BRASIL S.A.', '100', '0,10', '10,00'),
  ]))
  expect(p.dividends.map(d => [d.kind, d.amountCents])).toEqual([['JCP', 500], ['Dividendo', 1000]])
})

test('Atualização vira conferência, leilão de fração vira venda, fração em ativos é informativa; Amortização vai para revisão', () => {
  const p = parseB3(makeB3([
    row('Credito', '03/03/2024', 'Atualização', 'HGLG11 - CSHG LOGISTICA FII', '10'),
    row('Credito', '04/03/2024', 'Amortização', 'XPLG11 - XP LOG FII', '10', '1,00', '10,00'),
    row('Debito', '05/03/2024', 'Fração em Ativos', 'ITSA4 - ITAUSA S.A.', '0,9'),
    row('Credito', '06/03/2024', 'Leilão de Fração', 'ITSA4 - ITAUSA S.A.', '0,9', '8,56', '7,70'),
  ]))
  expect(p.toReview).toEqual([{ date: '2024-03-04', movimentacao: 'Amortização', produto: 'XPLG11 - XP LOG FII' }])
  expect(p.checks).toEqual([{ date: '2024-03-03', ticker: 'HGLG11', qty: 10, produto: 'HGLG11 - CSHG LOGISTICA FII' }])
  expect(p.sales).toEqual([{ kind: 'Leilão de Fração', date: '2024-03-06', ticker: 'ITSA4', qty: 0.9, valueCents: 770, broker: 'CLEAR', produto: 'ITSA4 - ITAUSA S.A.' }])
  expect(p.ignored).toBe(1)
})

test('na importação, o leilão vende a fração e a Atualização confere a posição', async () => {
  const db = await createTestDb()
  await importB3(db, parseB3(makeNegociacao([neg('05/01/2024', 'Compra', 'ITSA4', 10, 10)])))
  const mov = makeB3([
    row('Credito', '10/02/2024', 'Bonificação em Ativos', 'ITSA4 - ITAUSA S.A.', '0,9'),
    row('Debito', '05/03/2024', 'Fração em Ativos', 'ITSA4 - ITAUSA S.A.', '0,9'),
    row('Credito', '06/03/2024', 'Leilão de Fração', 'ITSA4 - ITAUSA S.A.', '0,9', '8,56', '7,70'),
    row('Credito', '20/03/2024', 'Atualização', 'ITSA4 - ITAUSA S.A.', '10'),
    row('Credito', '20/03/2024', 'Atualização', 'HGLG11 - CSHG LOGISTICA FII', '5'),
    row('Credito', '21/03/2024', 'Leilão de Fração', 'BBBB4 - EMPRESA EXEMPLO S.A.', '0,5', '10,00', '5,00'),
  ])
  const r = await importB3(db, parseB3(mov))
  expect(r).toMatchObject({ sales: 1, checked: 1 })
  expect(r.review).toEqual([
    { date: '2024-03-21', movimentacao: 'Leilão de Fração', produto: 'BBBB4 - EMPRESA EXEMPLO S.A.', nota: 'o Yield não tem essa posição' },
    { date: '2024-03-20', movimentacao: 'Atualização', produto: 'HGLG11 - CSHG LOGISTICA FII', nota: 'B3: 5, Yield: 0' },
  ])
  const sale = (await loadAll(db)).trades.find(t => t.side === 'V')!
  expect([sale.ticker, sale.qty, sale.priceCents, sale.tradeDate, sale.assetType]).toEqual(['ITSA4', 0.9, 856, '2024-03-06', 'Ação'])
  expect(await importB3(db, parseB3(mov))).toMatchObject({ sales: 0 }) // reimportar não vende de novo
})

test('importar o mesmo extrato duas vezes não duplica', async () => {
  const db = await createTestDb()
  const data = makeB3([
    row('Credito', '14/03/2024', 'Rendimento', 'HGLG11 - CSHG LOGISTICA FII', '10', '1,10', '11,00'),
    row('Credito', '20/04/2024', 'Bonificação em Ativos', 'ITSA4 - ITAUSA S.A.', '5'),
  ])
  expect(await importB3(db, parseB3(data))).toMatchObject({ dividends: 1, dividendsSkipped: 0, replaced: 0, applied: [{ kind: 'bonificacao', ticker: 'ITSA4' }], eventsSkipped: 0 })
  expect(await importB3(db, parseB3(data))).toMatchObject({ dividends: 0, dividendsSkipped: 1, replaced: 0, applied: [], eventsSkipped: 1 })
  const all = await loadAll(db)
  expect(all.dividends).toHaveLength(1)
  expect(all.events).toHaveLength(1)
})

test('provento da B3 substitui o da planilha do mesmo ticker e mês', async () => {
  const db = await createTestDb()
  await upsertDividends(db, [{ ticker: 'HGLG11', kind: 'Rendimento', payDate: '2024-03-01', amountCents: 1000, broker: null, source: 'planilha', sourceKey: 'planilha:HGLG11:2024-03:Rendimento' }])
  const r = await importB3(db, parseB3(makeB3([row('Credito', '14/03/2024', 'Rendimento', 'HGLG11 - CSHG LOGISTICA FII', '10', '1,10', '11,00')])))
  expect(r).toMatchObject({ dividends: 1, replaced: 1 })
  expect((await loadAll(db)).dividends.map(d => d.source)).toEqual(['b3'])
})

test('grupamento com Credito vai para revisão', () => {
  const p = parseB3(makeB3([row('Credito', '10/06/2024', 'Grupamento', 'MGLU3 - MAGAZINE LUIZA S.A.', '10')]))
  expect(p.events).toHaveLength(0)
  expect(p.toReview).toEqual([{ date: '2024-06-10', movimentacao: 'Grupamento', produto: 'MGLU3 - MAGAZINE LUIZA S.A.' }])
})

test('provento sem valor vai para revisão e não apaga o da planilha', async () => {
  const p = parseB3(makeB3([
    row('Credito', '14/03/2024', 'Rendimento', 'HGLG11 - CSHG LOGISTICA FII', '10', '-', '-'),
    row('Credito', '15/03/2024', 'Dividendo', 'BBAS3 - BANCO DO BRASIL S.A.', '10', '-', ''),
  ]))
  expect(p.dividends).toHaveLength(0)
  expect(p.toReview.map(r => r.movimentacao)).toEqual(['Rendimento', 'Dividendo'])
  const db = await createTestDb()
  await upsertDividends(db, [{ ticker: 'HGLG11', kind: 'Rendimento', payDate: '2024-03-01', amountCents: 1000, broker: null, source: 'planilha', sourceKey: 'planilha:HGLG11:2024-03:Rendimento' }])
  expect(await importB3(db, p)).toMatchObject({ dividends: 0, replaced: 0 })
  expect((await loadAll(db)).dividends.map(d => d.amountCents)).toEqual([1000])
})

test('linhas idênticas no mesmo extrato viram proventos distintos; reimportar não duplica', async () => {
  const jcp = row('Credito', '01/07/2024', 'Juros Sobre Capital Próprio', 'ITSA4 - ITAUSA S.A.', '100', '0,05', '5,00')
  const data = makeB3([jcp, jcp, jcp])
  const p = parseB3(data)
  expect(p.dividends.map(d => d.sourceKey!.replace(/^.*:5,00/, ''))).toEqual(['', ':#1', ':#2'])
  const db = await createTestDb()
  expect(await importB3(db, p)).toMatchObject({ dividends: 3, dividendsSkipped: 0 })
  expect(await importB3(db, parseB3(data))).toMatchObject({ dividends: 0, dividendsSkipped: 3 })
  expect((await loadAll(db)).dividends).toHaveLength(3)
})

const XP = 'XP INVESTIMENTOS CCTVM S/A'
const neg = (data: string, tipo: string, codigo: string, qtd: number, preco: number, mercado = 'Mercado à Vista', prazo = '-', inst = CLEAR) =>
  [data, tipo, mercado, prazo, inst, codigo, qtd, preco, qtd * preco]

test('Negociação vira operações; fracionário perde o F; ETF de renda fixa entra com o tipo; o resto vai para revisão', () => {
  const p = parseB3(makeNegociacao([
    neg('05/01/2024', 'Compra', 'HGLG11', 10, 160.5),
    neg('05/01/2024', 'Compra', 'ITSA4F', 7, 10.12, 'Mercado Fracionário'),
    neg('08/01/2024', 'Venda', 'HGLG11', 4, 162),
    neg('09/01/2024', 'Compra', 'IMAB11', 3, 90, 'Renda Fixa'),
    neg('10/01/2024', 'Venda', 'HGLG12', 2, 1.5, 'Mercado à Vista', '15/01/2024'),
    neg('11/01/2024', 'Compra', 'DEBX29', 1, 1000, 'Renda Fixa'),
  ]))
  expect(p.trades).toEqual([
    { date: '2024-01-05', broker: 'CLEAR', side: 'C', ticker: 'HGLG11', qty: 10, priceCents: 16050 },
    { date: '2024-01-05', broker: 'CLEAR', side: 'C', ticker: 'ITSA4', qty: 7, priceCents: 1012 },
    { date: '2024-01-08', broker: 'CLEAR', side: 'V', ticker: 'HGLG11', qty: 4, priceCents: 16200 },
    { date: '2024-01-09', broker: 'CLEAR', side: 'C', ticker: 'IMAB11', qty: 3, priceCents: 9000, assetType: 'ETF RF' },
  ])
  expect(p.toReview).toEqual([
    { date: '2024-01-10', movimentacao: 'Venda com vencimento', produto: 'HGLG12' },
    { date: '2024-01-11', movimentacao: 'Compra em Renda Fixa', produto: 'DEBX29' },
  ])
})

test('assetTypeOf: 11 é FII até o usuário dizer outra coisa, 34 é BDR, resto é ação', () => {
  expect(['HGLG11', 'AAPL34', 'ITSA4', 'B3SA3'].map(t => assetTypeOf(t))).toEqual(['FII', 'BDR', 'Ação', 'Ação'])
})

test('resgate vai para revisão (pode ser incorporação); Atualização depois de subscrição exercida ganha a dica', async () => {
  const db = await createTestDb()
  await importB3(db, parseB3(makeNegociacao([neg('05/01/2024', 'Compra', 'FUND11', 100, 10), neg('05/01/2024', 'Compra', 'OUTR11', 10, 10)])))
  const r = await importB3(db, parseB3(makeB3([
    row('Debito', '11/02/2024', 'Direitos de Subscrição - Exercido', 'OUTR12 - FUNDO OUTRO FII', '2'),
    row('Credito', '20/03/2024', 'Atualização', 'OUTR11 - FUNDO OUTRO FII', '2'),
    row('Credito', '10/04/2024', 'Resgate', 'FUND11 - FUNDO EXEMPLO FII', '100', '4,31', '431,00'),
  ])))
  expect(r).toMatchObject({ sales: 0, checked: 0 })
  expect(r.review).toEqual([{ date: '2024-03-20', movimentacao: 'Atualização', produto: 'OUTR11 - FUNDO OUTRO FII', nota: 'provável crédito de subscrição (+2): lance a compra em Notas com o preço pago' }])
  const p = parseB3(makeB3([row('Credito', '10/04/2024', 'Resgate', 'FUND11 - FUNDO EXEMPLO FII', '100', '4,31', '431,00')]))
  expect(p.toReview).toEqual([{ date: '2024-04-10', movimentacao: 'Resgate', produto: 'FUND11 - FUNDO EXEMPLO FII', nota: 'R$ 431,00: se o fundo foi liquidado, lance a venda; se foi incorporado por outro, lance a troca em Notas › Evento' }])
  expect((await loadAll(db)).trades.filter(t => t.side === 'V')).toEqual([])
})

test('operações viram uma nota sem taxa por dia e corretora; reimportar não duplica', async () => {
  const db = await createTestDb()
  const data = makeNegociacao([
    neg('05/01/2024', 'Compra', 'HGLG11', 10, 160.5),
    neg('05/01/2024', 'Compra', 'BOVA11', 2, 120),
    neg('05/01/2024', 'Compra', 'ITSA4', 100, 10, 'Mercado à Vista', '-', XP),
    neg('08/01/2024', 'Venda', 'HGLG11', 4, 162),
  ])
  const types = new Map([['BOVA11', 'ETF' as const]])
  expect(await importB3(db, parseB3(data), types)).toMatchObject({ notes: 3, trades: 4, tradesSkipped: 0 })
  expect(await importB3(db, parseB3(data), types)).toMatchObject({ notes: 0, trades: 0, notesSkipped: 3 })
  const all = await loadAll(db)
  expect(all.notes.map(n => [n.tradeDate, n.broker, n.source, n.settleDate]).sort()).toEqual([
    ['2024-01-05', 'CLEAR', 'sem_nota', '2024-01-09'], ['2024-01-05', 'XP', 'sem_nota', '2024-01-09'], ['2024-01-08', 'CLEAR', 'sem_nota', '2024-01-10'],
  ])
  expect(all.trades.map(t => [t.ticker, t.assetType, t.feesCents]).sort()).toEqual([['BOVA11', 'ETF', 0], ['HGLG11', 'FII', 0], ['HGLG11', 'FII', 0], ['ITSA4', 'Ação', 0]])
})

test('operação que já está numa nota (PDF ou manual) é pulada', async () => {
  const db = await createTestDb()
  await saveNote(db, { number: '123', broker: 'CLEAR', tradeDate: '2024-01-05', settleDate: '2024-01-09', source: 'pdf', sourceKey: null, label: null },
    [{ seq: 1, side: 'C', assetType: 'FII', ticker: 'HGLG11', qty: 10, priceCents: 16050, feesCents: 3, irrfCents: 0 }])
  const r = await importB3(db, parseB3(makeNegociacao([neg('05/01/2024', 'Compra', 'HGLG11', 10, 160.5), neg('05/01/2024', 'Compra', 'ITSA4', 1, 10)])))
  expect(r).toMatchObject({ notes: 1, trades: 1, tradesSkipped: 1 })
  expect((await loadAll(db)).trades.map(t => t.ticker).sort()).toEqual(['HGLG11', 'ITSA4'])
})

test('Proventos Recebidos: ignora a linha de total, Juros e Reembolso vão para revisão', () => {
  const p = parseB3(makeProventos([
    ['HGLG11 - CSHG LOGISTICA FII', '14/03/2024', 'Rendimento', CLEAR, '10', 1.1, 11],
    ['ITSA4 - ITAUSA S.A.', '01/07/2024', 'Juros Sobre Capital Próprio', CLEAR, '100', 0.05, 4.25],
    ['Tesouro Prefixado 2035', '01/07/2024', 'Juros', CLEAR, '1,5', 30, 45],
    ['BBAS3 - BANCO DO BRASIL S.A.', '02/07/2024', 'Reembolso', CLEAR, '10', 0.1, 1],
    ['', '', '', '', '', '', 61.25],
  ]))
  expect(p.dividends.map(d => [d.ticker, d.kind, d.payDate, d.amountCents, d.broker])).toEqual([
    ['HGLG11', 'Rendimento', '2024-03-14', 1100, 'CLEAR'], ['ITSA4', 'JCP', '2024-07-01', 425, 'CLEAR'],
  ])
  expect(p.toReview.map(r => r.movimentacao)).toEqual(['Juros', 'Reembolso'])
})

test('o mesmo provento vindo da Movimentação e de Proventos Recebidos entra uma vez só', async () => {
  const db = await createTestDb()
  await importB3(db, parseB3(makeB3([row('Credito', '14/03/2024', 'Rendimento', 'HGLG11 - CSHG LOGISTICA FII', '10', '1,10', '11,00')])))
  const r = await importB3(db, parseB3(makeProventos([['HGLG11 - CSHG LOGISTICA FII', '14/03/2024', 'Rendimento', CLEAR, '10', 1.1, 11]])))
  expect(r).toMatchObject({ dividends: 0, dividendsSkipped: 1 })
  expect((await loadAll(db)).dividends).toHaveLength(1)
})

test('arquivo que não é da B3 dá erro claro', () => {
  const wb = utils.book_new()
  utils.book_append_sheet(wb, utils.aoa_to_sheet([['Data', 'Valor'], ['01/01/2024', 1]]), 'Planilha1')
  expect(() => parseB3(write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)).toThrow('não parece um relatório da B3')
})

test('typeFromName lê os nomes que a B3 usa', () => {
  expect([
    'ALFA FDO INV IMOB - FII', 'BETA CE - FDO INV IMOB', 'GAMA RECEBÍVEIS IMOBILIÁRIOS FDO DE INV IMOB', 'DELTA OFFICES FUNDO DE INVESTIMENTO IMOBILIARIO',
    'ISHARES BOVA FDO INV COTAS FDO INDICE', 'IT NOW IBOVESPA FUNDO DE ÍNDICE', 'COMPANHIA TESTE DE ENERGIA S/A', 'KLABIN S.A. UNT', 'CRIPTO NASDAQ TESTE',
  ].map(typeFromName)).toEqual(['FII', 'FII', 'FII', 'FII', 'ETF', 'ETF', 'Ação', 'Ação', null])
})

test('Proventos e Movimentação guardam o nome do produto por ticker', () => {
  const p = parseB3(makeProventos([['HGLG11 - CSHG LOGISTICA FDO INV IMOB - FII', '14/03/2024', 'Rendimento', CLEAR, '10', 1.1, 11]]))
  expect(p.names).toEqual({ HGLG11: 'CSHG LOGISTICA FDO INV IMOB - FII' })
})

test('dia já importado: a Negociação nova completa a nota do dia com o que faltava', async () => {
  const db = createTestDb()
  await importB3(db, parseB3(makeNegociacao([neg('05/01/2024', 'Compra', 'ITSA4', 10, 10)])))
  const r = await importB3(db, parseB3(makeNegociacao([neg('05/01/2024', 'Compra', 'ITSA4', 10, 10), neg('05/01/2024', 'Compra', 'IMAB11', 3, 90, 'Renda Fixa')])), new Map([['IMAB11', 'ETF RF']]))
  const { notes, trades } = await loadAll(db)
  expect(notes).toHaveLength(1)
  expect(trades.map(t => [t.ticker, t.assetType])).toEqual([['ITSA4', 'Ação'], ['IMAB11', 'ETF RF']])
  expect(r.trades).toBe(1)
  // de novo: nada muda
  await importB3(db, parseB3(makeNegociacao([neg('05/01/2024', 'Compra', 'IMAB11', 3, 90, 'Renda Fixa')])), new Map([['IMAB11', 'ETF RF']]))
  expect((await loadAll(db)).trades).toHaveLength(2)
})

test('reimportar não devolve operação da B3 que o usuário editou na nota do dia', async () => {
  const db = createTestDb()
  await importB3(db, parseB3(makeNegociacao([neg('05/01/2024', 'Compra', 'ITSA4', 10, 10)])))
  await db.execute("UPDATE trades SET qty = 11 WHERE ticker = 'ITSA4'")
  await importB3(db, parseB3(makeNegociacao([neg('05/01/2024', 'Compra', 'ITSA4', 10, 10)])))
  expect((await loadAll(db)).trades.map(t => t.qty)).toEqual([11])
})

test('operação já trazida pela Pluggy não volta pela Negociação da B3', async () => {
  const db = createTestDb()
  await saveNote(db, { number: 'Pluggy 2024-01-05', broker: 'CLEAR', tradeDate: '2024-01-05', settleDate: '2024-01-09', source: 'sem_nota', sourceKey: 'pluggy:2024-01-05:CLEAR', label: 'Pluggy (sem nota)' },
    [{ seq: 1, side: 'C', assetType: 'Ação', ticker: 'AAAA3', qty: 10, priceCents: 1000, feesCents: 12, irrfCents: 0 }])
  const r = await importB3(db, parseB3(makeNegociacao([neg('05/01/2024', 'Compra', 'AAAA3', 10, 10), neg('05/01/2024', 'Compra', 'BBBB4', 1, 10)])))
  expect(r).toMatchObject({ notes: 1, trades: 1, tradesSkipped: 1 })
  expect((await loadAll(db)).trades.map(t => [t.ticker, t.feesCents])).toEqual([['BBBB4', 0], ['AAAA3', 12]])
})

test('Pluggy trouxe só parte do dia: a Negociação da B3 completa com a sobra, a preço médio, e reimportar não duplica', async () => {
  const db = createTestDb()
  await saveNote(db, { number: 'Pluggy 2024-01-05', broker: 'CLEAR', tradeDate: '2024-01-05', settleDate: '2024-01-09', source: 'sem_nota', sourceKey: 'pluggy:2024-01-05:CLEAR', label: 'Pluggy (sem nota)' },
    [{ seq: 1, side: 'C', assetType: 'Ação', ticker: 'AAAA3', qty: 100, priceCents: 1000, feesCents: 12, irrfCents: 0 }])
  const file = makeNegociacao([neg('05/01/2024', 'Compra', 'AAAA3', 100, 10), neg('05/01/2024', 'Compra', 'AAAA3', 50, 13)])
  expect(await importB3(db, parseB3(file))).toMatchObject({ notes: 1, trades: 1 })
  const rows = async () => (await loadAll(db)).trades.map(t => [t.ticker, t.qty, t.priceCents]).sort()
  expect(await rows()).toEqual([['AAAA3', 100, 1000], ['AAAA3', 50, 1100]])
  await importB3(db, parseB3(file))
  expect(await rows()).toEqual([['AAAA3', 100, 1000], ['AAAA3', 50, 1100]])
})
