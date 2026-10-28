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
  await saveLine(db, { month: '2026-03', kind: 'saida', name: 'Aluguel', amountCents: 180000, recurring: true, position: 0, categoryId: null, installmentCurrent: null, installmentTotal: null, sourceId: null, sourceKey: null })
  expect(await importOrcamentoCsv(db, parseOrcamentoCsv('mes;tipo;nome;valor\n2026-03;fixa;aluguel;1800\n2026-03;variavel;Mercado;50'))).toEqual({ months: 0, lines: 1, skipped: 1 })
  const o = await loadOrcamento(db)
  expect(o.lines.filter(l => l.month === '2026-03').map(l => l.name)).toEqual(['Aluguel', 'Mercado'])
})
