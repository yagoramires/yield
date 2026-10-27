import { createTestDb } from '../db/testDb'
import { loadOrcamento, saveLine, saveSource } from '../db/orcamentoRepo'
import { monthSummary, sourceNet } from '../domain/orcamento'
import { makeOrcamento } from '../../tests/fixtures/makeOrcamento'
import { importOrcamento, parseOrcamentoPlanilha } from './orcamentoPlanilha'

const p = () => parseOrcamentoPlanilha(makeOrcamento())

test('meses saem das datas da linha 2 e meses sem valores são pulados', () => {
  expect(p().months.map(m => m.month)).toEqual(['2024-01', '2024-02', '2024-03'])
})

test('entradas e saídas separadas pela fórmula do Saldo; negativo vira aviso', () => {
  const r = p()
  const jan = r.months[0].lines
  expect(jan.map(l => [l.kind, l.amountCents])).toEqual([['entrada', 810200], ['entrada', 30000], ['saida', 100000], ['saida', 62500]])
  expect(r.warnings).toHaveLength(1)
})

test('recorrente = valor em pelo menos 2 meses; sourceKey usa mês, tipo e rótulo', () => {
  const jan = p().months[0].lines
  expect(jan.map(l => l.recurring)).toEqual([true, false, true, true])
  expect(jan.map(l => l.sourceKey)).toEqual(['planilha:2024-01:entrada:renda pj', 'planilha:2024-01:entrada:bico', 'planilha:2024-01:saida:aluguel', 'planilha:2024-01:saida:mercado'])
})

test('o saldo de cada mês importado bate com a linha Saldo', async () => {
  const db = createTestDb()
  await importOrcamento(db, p())
  const o = await loadOrcamento(db)
  const saldos = o.months.map(m => monthSummary(o.lines.filter(l => l.month === m)).saldoCents)
  expect(saldos).toEqual([810200 + 30000 - 100000 - 62500, 810200 - 100000 - 15000 - 62500, 810200 - 100000])
})

test('PJ: fonte com porcentagens e nome do rótulo acima; linha do líquido é marcada', () => {
  const r = p()
  expect(r.source).toEqual({ name: 'Empresa Teste', kind: 'pj', grossCents: 1000000, proLaborePct: 28, irpjPct: 6, inssPct: 11, contabilidadeCents: 80000, outrosCents: 19000, netCents: null, sourceKey: 'planilha:pj' })
  expect(r.months[0].lines.map(l => l.usesImportedSource)).toEqual([true, false, false, false])
  expect(parseOrcamentoPlanilha(makeOrcamento({ semRotuloPj: true })).source?.name).toBe('Salário PJ')
})

test('PJ: o líquido calculado da fonte importada bate exatamente com o da planilha', () => {
  // INSS da célula 1 centavo acima do recalculado (arredondamento do pró-labore na planilha).
  const r = parseOrcamentoPlanilha(makeOrcamento({ inssCelula: 308.01 }))
  expect(sourceNet({ ...r.source!, id: 'x' })).toBe(810200)
})

test('sem bloco PJ: source null com aviso', () => {
  const r = parseOrcamentoPlanilha(makeOrcamento({ semPj: true }))
  expect(r.source).toBeNull()
  expect(r.warnings.some(w => w.includes('PJ'))).toBe(true)
})

test('importar duas vezes não duplica', async () => {
  const db = createTestDb()
  const a = await importOrcamento(db, p())
  expect(a).toEqual({ months: 3, lines: 10, skipped: 0, sourceCreated: true, warnings: [] })
  expect(await importOrcamento(db, p())).toEqual({ months: 0, lines: 0, skipped: 10, sourceCreated: false, warnings: [] })
  const o = await loadOrcamento(db)
  expect(o.sources).toHaveLength(1)
  const fonte = o.sources[0]
  expect(o.lines.filter(l => l.sourceId === fonte.id).map(l => l.sourceKey)).toEqual(['planilha:2024-01:entrada:renda pj', 'planilha:2024-02:entrada:renda pj', 'planilha:2024-03:entrada:renda pj'])
  expect(o.lines.filter(l => l.sourceId === null)).toHaveLength(7)
})

test('linha editada no app continua como o usuário deixou e fonte PJ já existente não é sobrescrita', async () => {
  const db = createTestDb()
  await importOrcamento(db, p())
  const o = await loadOrcamento(db)
  const l = o.lines.find(x => x.sourceKey === 'planilha:2024-01:saida:aluguel')!
  await saveLine(db, { ...l, amountCents: 123, name: 'Editada' })
  await saveSource(db, { ...o.sources[0], outrosCents: 5 })
  await importOrcamento(db, p())
  const after = await loadOrcamento(db)
  expect(after.lines.find(x => x.id === l.id)).toMatchObject({ amountCents: 123, name: 'Editada' })
  expect(after.lines).toHaveLength(o.lines.length)
  expect(after.sources).toHaveLength(1)
  expect(after.sources[0].outrosCents).toBe(5)
})

test('mês criado no app não é importado de novo', async () => {
  const db = createTestDb()
  await saveLine(db, { month: '2024-01', kind: 'saida', name: 'Minha', amountCents: 1, recurring: false, position: 0, categoryId: null, installmentCurrent: null, installmentTotal: null, sourceId: null, sourceKey: null })
  expect(await importOrcamento(db, p())).toMatchObject({ months: 2, lines: 6, skipped: 4, warnings: ['2024-01 já foi criado no app e não foi importado de novo'] })
  expect((await loadOrcamento(db)).lines.filter(l => l.month === '2024-01')).toHaveLength(1)
})

test('linha nova no meio da planilha entra sozinha na reimportação', async () => {
  const db = createTestDb()
  await importOrcamento(db, p())
  expect(await importOrcamento(db, parseOrcamentoPlanilha(makeOrcamento({ novaLinha: true })))).toMatchObject({ months: 0, lines: 3, skipped: 10 })
  const o = await loadOrcamento(db)
  expect(o.lines).toHaveLength(13)
  expect(o.lines.filter(l => l.name === 'Academia').map(l => l.month)).toEqual(['2024-01', '2024-02', '2024-03'])
  expect(new Set(o.lines.map(l => l.sourceKey)).size).toBe(13)
})

test('mesmo rótulo duas vezes no mês: duas linhas e reimportação idempotente', async () => {
  const r = parseOrcamentoPlanilha(makeOrcamento({ rotuloRepetido: true }))
  expect(r.months[0].lines.filter(l => l.kind === 'saida').map(l => l.sourceKey)).toEqual(['planilha:2024-01:saida:aluguel', 'planilha:2024-01:saida:aluguel#1'])
  const db = createTestDb()
  expect(await importOrcamento(db, r)).toMatchObject({ lines: 10 })
  expect(await importOrcamento(db, r)).toMatchObject({ lines: 0, skipped: 10 })
  expect((await loadOrcamento(db)).lines).toHaveLength(10)
})

test('erros em pt-BR', () => {
  expect(() => parseOrcamentoPlanilha(makeOrcamento({ semAba: true }))).toThrow('Aba "Finanças" não encontrada')
  expect(() => parseOrcamentoPlanilha(makeOrcamento({ semSaldo: true }))).toThrow('Linha "Saldo" não encontrada')
})
