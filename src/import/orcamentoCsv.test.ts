import { createTestDb } from '../db/testDb'
import { loadOrcamento, saveLine } from '../db/orcamentoRepo'
import { importOrcamentoCsv, ORCAMENTO_CSV_EXEMPLO, parseOrcamentoCsv } from './orcamentoCsv'

const csv = 'mes;tipo;nome;valor\n2026-01;receita;Salário;5.000,00\n2026-01;fixa;Aluguel;1800\n2026-02;Receita;Salário;5000.50\n2026-02;variável;Mercado;R$ 900,00\n2026-02;variavel;Mercado;100,00\n2026-02;meta;Reserva;0\n'

test('o exemplo da tela é lido', () => {
  expect(parseOrcamentoCsv(ORCAMENTO_CSV_EXEMPLO).length).toBeGreaterThan(0)
})

test('tipos com apelidos, valores pt-BR ou com ponto, recorrente quando o nome aparece em 2+ meses, zero é pulado', () => {
  const m = parseOrcamentoCsv(csv)
  expect(m.map(x => x.month)).toEqual(['2026-01', '2026-02'])
  expect(m[0].lines.map(l => [l.kind, l.name, l.amountCents, l.recurring, l.sourceKey])).toEqual([
    ['entrada', 'Salário', 500000, true, 'csv:2026-01:entrada:salario'],
    ['saida', 'Aluguel', 180000, false, 'csv:2026-01:saida:aluguel'],
  ])
  expect(m[1].lines.map(l => [l.kind, l.amountCents, l.sourceKey])).toEqual([
    ['entrada', 500050, 'csv:2026-02:entrada:salario'], ['saida', 90000, 'csv:2026-02:saida:mercado'], ['saida', 10000, 'csv:2026-02:saida:mercado#1'],
  ])
})

test('separador por vírgula ou tabulação e colunas em outra ordem', () => {
  expect(parseOrcamentoCsv('nome,valor,mes,tipo\nAluguel,1800,2026-01,despesa')[0].lines[0]).toMatchObject({ kind: 'saida', name: 'Aluguel', amountCents: 180000 })
  expect(parseOrcamentoCsv('mes\ttipo\tnome\tvalor\n2026-01\tentrada\tBico\t300,00')[0].lines[0]).toMatchObject({ kind: 'entrada', amountCents: 30000 })
})

test('erros em pt-BR com o número da linha', () => {
  expect(() => parseOrcamentoCsv('a;b\n1;2')).toThrow(/mes;tipo;nome;valor/)
  expect(() => parseOrcamentoCsv('mes;tipo;nome;valor\n01/2026;fixa;Aluguel;10')).toThrow(/Linha 2.*AAAA-MM/)
  expect(() => parseOrcamentoCsv('mes;tipo;nome;valor\n2026-01;outro;Aluguel;10')).toThrow(/Linha 2.*tipo/)
  expect(() => parseOrcamentoCsv('mes;tipo;nome;valor\n2026-01;fixa;;10')).toThrow(/Linha 2.*nome/)
  expect(() => parseOrcamentoCsv('mes;tipo;nome;valor\n2026-01;fixa;Aluguel;-10')).toThrow(/Linha 2.*negativo/)
})

test('reimportar pula o que já existe e não duplica o que foi digitado no app', async () => {
  const db = createTestDb()
  expect(await importOrcamentoCsv(db, parseOrcamentoCsv(csv))).toEqual({ months: 2, lines: 5, skipped: 0 })
  expect(await importOrcamentoCsv(db, parseOrcamentoCsv(csv))).toEqual({ months: 0, lines: 0, skipped: 5 })
  await saveLine(db, { month: '2026-03', kind: 'saida', name: 'Aluguel', amountCents: 180000, recurring: true, position: 0, categoryId: null, installmentCurrent: null, installmentTotal: null, sourceId: null, grupo: null, sourceKey: null })
  expect(await importOrcamentoCsv(db, parseOrcamentoCsv('mes;tipo;nome;valor\n2026-03;fixa;aluguel;1800\n2026-03;variavel;Mercado;50'))).toEqual({ months: 0, lines: 1, skipped: 1 })
  const o = await loadOrcamento(db)
  expect(o.lines.filter(l => l.month === '2026-03').map(l => l.name)).toEqual(['Aluguel', 'Mercado'])
})

test('números no nome contam: cartões e parcelas diferentes não se misturam', async () => {
  const m = parseOrcamentoCsv('mes;tipo;nome;valor\n2026-01;fixa;Cartão 1234;100\n2026-01;fixa;Cartão 5678;200\n2026-01;fixa;Parcela 1;50\n2026-02;fixa;Parcela 2;50\n2026-02;fixa;Cartão 1234;100')
  expect(m[0].lines.map(l => [l.name, l.recurring, l.sourceKey])).toEqual([
    ['Cartão 1234', true, 'csv:2026-01:saida:cartao 1234'], ['Cartão 5678', false, 'csv:2026-01:saida:cartao 5678'], ['Parcela 1', false, 'csv:2026-01:saida:parcela 1'],
  ])
  expect(m[1].lines.find(l => l.name === 'Parcela 2')?.recurring).toBe(false)
  const db = createTestDb()
  await importOrcamentoCsv(db, m)
  expect(await importOrcamentoCsv(db, parseOrcamentoCsv('mes;tipo;nome;valor\n2026-02;fixa;Cartão 5678;200'))).toEqual({ months: 0, lines: 1, skipped: 0 })
})

test('o tipo da saída escolhe o bloco: fixa, variável, meta; despesa genérica vira custo fixo', () => {
  const m = parseOrcamentoCsv('mes;tipo;nome;valor\n2026-01;receita;S;1\n2026-01;fixa;A;1\n2026-01;variável;M;1\n2026-01;investimento;I;1\n2026-01;despesa;D;1')
  expect(m[0].lines.map(l => l.grupo)).toEqual([null, 'fixo', 'variavel', 'meta', 'fixo'])
})
