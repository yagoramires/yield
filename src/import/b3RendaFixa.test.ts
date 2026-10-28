import { createTestDb } from '../db/testDb'
import { loadAll } from '../db/repo'
import { loadCadastro, saveIssuer } from '../db/irRepo'
import { b3Summary } from '../pages/configuracoes/build'
import { makeB3, makePosicao, type B3Row } from '../../tests/fixtures/makeB3'
import { importB3, parseB3 } from './b3'
import { posicaoDate, rfKey, rfMoveKind } from './b3RendaFixa'

const INST = 'CORRETORA TESTE S/A'
const TD = 'Tesouro Prefixado 2099'
const CDB_A = 'CDB - CDB0000AA00 - BANCO LARANJA S/A'
const CDB_B = 'CDB - CDB1111BB11'
const row = (io: string, data: string, mov: string, produto: string, qtd: string, preco: string, valor: string): B3Row => [io, data, mov, produto, INST, qtd, preco, valor]
const MOV = [
  row('Credito', '10/01/2025', 'Compra', TD, '2', '500,00', '1.000,00'),
  row('Debito', '10/06/2025', 'Venda', TD, '1', '520,00', '520,00'),
  row('Credito', '01/07/2025', 'Juros', TD, '1', '30,00', '30,00'),
  row('Credito', '05/02/2025', 'COMPRA / VENDA', CDB_A, '1', '1.000,00', '1.000,00'),
  row('Credito', '05/08/2025', 'PAGAMENTO DE JUROS', CDB_A, '1', '40,00', '40,00'),
  row('Debito', '05/02/2026', 'VENCIMENTO/RESGATE SALDO EM CONTA', CDB_A, '1', '1.100,00', '1.100,00'),
  row('Debito', '05/02/2023', 'VENCIMENTO', CDB_B, '3', '0', '0'),
  row('Credito', '14/03/2025', 'Rendimento', 'HGLG11 - CSHG LOGISTICA FII', '10', '1,10', '11,00'),
]

test('linhas de renda fixa da Movimentação viram movimentações próprias', () => {
  const p = parseB3(makeB3(MOV))
  expect(p.rfMoves.map(m => m.kind)).toEqual(['aplicacao', 'saida', 'juros', 'aplicacao', 'juros', 'saida', 'saida'])
  expect(p.rfMoves[0]).toMatchObject({ key: rfKey(TD), product: TD, date: '2025-01-10', qty: 2, valueCents: 100000 })
  expect(p.rfMoves[3].key).toBe('rf:CDB0000AA00')
  expect(p.rfMoves[6]).toMatchObject({ key: 'rf:CDB1111BB11', qty: 3, valueCents: null })
  expect(p.dividends).toHaveLength(1)
  expect(p.ignored).toBe(0)
})

test('tipo de renda fixa desconhecido vai para revisão', () => {
  const p = parseB3(makeB3([row('Credito', '05/02/2025', 'Amortização', CDB_A, '1', '10,00', '10,00')]))
  expect(p.rfMoves).toHaveLength(0)
  expect(p.toReview[0].nota).toContain('renda fixa')
})

test('a chave casa o produto da Movimentação com o da Posição', () => {
  expect(rfKey(CDB_A)).toBe(rfKey('CDB - BANCO LARANJA S/A', 'CDB0000AA00'))
  expect(rfKey(TD)).toBe(rfKey('TESOURO  PREFIXADO 2099'))
})

const POS = makePosicao(
  [[TD, INST, 'BRSTNCLTN0Z9', 'Prefixado', '01/01/2099', 1, 1, 0, '-', 500, 560, 550, 555.55],
    ['Tesouro IPCA+ com Juros Semestrais 2098', 'OUTRA CORRETORA', 'BRSTNCNTB0Z9', 'IPCA', '15/08/2098', 2, 2, 0, '-', 2000, 2100, 2080, 2090]],
  [['CDB - BANCO LARANJA S/A', INST, 'BANCO LARANJA S/A', 'CDB0000AA00', 'CDI', 'Depositado', '05/02/2025', '05/02/2099', 1, 1, '-', '-', '-', '-', '-', 1050.1, 1050.1, '-', '-']],
)

test('Posição: valores do Tesouro e da curva, sem as linhas de total', () => {
  const p = parseB3(POS, 'posicao-2026-10-27-22-28-51.xlsx')
  expect(p.rfPositions).toHaveLength(3)
  const byKey = new Map(p.rfPositions.map(x => [x.key, x]))
  expect(byKey.get(rfKey(TD))).toMatchObject({ family: 'tesouro', product: TD, issuer: null, indexer: 'Prefixado', maturity: '2099-01-01', qty: 1, appliedCents: 50000, valueCents: 55555, asOf: '2026-10-27' })
  expect(byKey.get('rf:CDB0000AA00')).toMatchObject({ family: 'rf', issuer: 'BANCO LARANJA S/A', indexer: 'CDI', appliedCents: null, valueCents: 105010 })
})

test('data da Posição vem do nome do arquivo ou do dia do import', () => {
  expect(posicaoDate('posicao-2026-10-27-22-28-51.xlsx')).toBe('2026-10-27')
  expect(posicaoDate('minha posicao.xlsx')).toBeNull()
  expect(parseB3(POS, 'minha posicao.xlsx', '2026-10-28').rfPositions[0].asOf).toBe('2026-10-28')
})

test('reimportar não duplica a renda fixa', async () => {
  const db = createTestDb()
  const first = await importB3(db, parseB3(makeB3(MOV)))
  expect(first.rfMoves).toEqual({ inserted: 7, skipped: 0 })
  const again = await importB3(db, parseB3(makeB3(MOV)))
  expect(again.rfMoves).toEqual({ inserted: 0, skipped: 7 })
  expect((await importB3(db, parseB3(POS, 'posicao-2026-10-27.xlsx'))).rfPositions).toEqual({ updated: 3, older: 0 })
  expect((await importB3(db, parseB3(POS, 'posicao-2026-10-01.xlsx'))).rfPositions).toEqual({ updated: 0, older: 3 })
  expect((await loadAll(db)).rfMoves).toHaveLength(7)
})

test('mesmo Tesouro em duas corretoras na Posição: soma as linhas', () => {
  const p = parseB3(makePosicao([[TD, INST, 'X', 'Prefixado', '01/01/2099', 1, 1, 0, '-', 500, 560, 550, 555.55], [TD, 'OUTRA CORRETORA', 'X', 'Prefixado', '01/01/2099', 2, 2, 0, '-', 1000, 1100, 1090, 1111.1]], []), 'posicao-2026-10-27.xlsx')
  expect(p.rfPositions).toHaveLength(1)
  expect(p.rfPositions[0]).toMatchObject({ qty: 3, appliedCents: 150000, valueCents: 166665 })
})

test('COMPRA / VENDA a débito é saída; Código "-" não junta títulos diferentes', () => {
  expect(rfMoveKind('COMPRA / VENDA', false)).toBe('saida')
  expect(rfKey('LCA - BANCO A S/A', '-')).not.toBe(rfKey('LCA - BANCO B S/A', '-'))
})

const A = '11.222.333/0001-81', B = '11.444.777/0001-61'
const ACOES = [['Produto', 'Instituição', 'Conta', 'Código de Negociação', 'CNPJ da Empresa', 'Quantidade'],
  ['AAAA3 - EMPRESA TESTE S/A', INST, '1', 'AAAA3', '11222333000181', 10],
  ['AAAA3 - EMPRESA TESTE S/A', 'OUTRA CORRETORA', '2', 'AAAA3', '11222333000181', 5], // mesma empresa em duas corretoras
  ['CCCC4 - OUTRA EMPRESA S/A', INST, '1', 'CCCC4', '123', 1], // CNPJ inválido fica de fora
  ['Total', '', '', '', '', 16]]
const FUNDOS = { Acoes: ACOES, ETF: [['Produto', 'Instituição', 'Código de Negociação', 'CNPJ do Fundo', 'Quantidade'], ['BBBB11 - FUNDO DE ÍNDICE TESTE', INST, 'BBBB11', B, 3]],
  'Fundo de Investimento': [['Produto', 'Instituição', 'Código de Negociação', 'CNPJ do Fundo', 'Quantidade'], ['DDDD11 - FII TESTE', INST, 'DDDD11', A, 2]] }

test('Posição só com renda variável: empresas e fundos com o CNPJ vão para o cadastro do IR', () => {
  const p = parseB3(makePosicao(null, null, FUNDOS), 'posicao-2026-10-27.xlsx')
  expect(p.rfPositions).toEqual([])
  expect(p.issuers).toEqual([
    { ticker: 'AAAA3', name: 'EMPRESA TESTE S/A', cnpj: A }, { ticker: 'BBBB11', name: 'FUNDO DE ÍNDICE TESTE', cnpj: B }, { ticker: 'DDDD11', name: 'FII TESTE', cnpj: A },
  ])
})

test('importar a Posição só preenche o que falta no cadastro: o que foi digitado à mão fica', async () => {
  const db = createTestDb()
  await saveIssuer(db, { ticker: 'AAAA3', name: 'Digitada à mão', cnpj: B })
  const p = parseB3(makePosicao(null, null, FUNDOS), 'posicao-2026-10-27.xlsx')
  const r = await importB3(db, p)
  expect(r.issuers).toBe(2)
  expect(b3Summary(r, p).counts).toContain('2 empresas no cadastro do IR')
  expect((await loadCadastro(db)).issuers.map(i => [i.ticker, i.name, i.cnpj])).toEqual([['AAAA3', 'Digitada à mão', B], ['BBBB11', 'FUNDO DE ÍNDICE TESTE', B], ['DDDD11', 'FII TESTE', A]])
  expect((await importB3(db, p)).issuers).toBe(0)
})
