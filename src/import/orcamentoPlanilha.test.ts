import { createTestDb } from '../db/testDb'
import { loadOrcamento, saveLine, savePjConfig, DEFAULT_PJ } from '../db/orcamentoRepo'
import { monthSummary } from '../domain/orcamento'
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

test('recorrente = valor em pelo menos 2 meses; sourceKey usa mês e linha', () => {
  const jan = p().months[0].lines
  expect(jan.map(l => l.recurring)).toEqual([true, false, true, true])
  expect(jan[0].sourceKey).toBe('planilha:2024-01:3')
})

test('o saldo de cada mês importado bate com a linha Saldo', async () => {
  const db = createTestDb()
  await importOrcamento(db, p())
  const o = await loadOrcamento(db)
  const saldos = o.months.map(m => monthSummary(o.lines.filter(l => l.month === m)).saldoCents)
  expect(saldos).toEqual([810200 + 30000 - 100000 - 62500, 810200 - 100000 - 15000 - 62500, 810200 - 100000])
})

test('PJ: porcentagens, outros reconstrói o líquido e a linha do líquido guarda o bruto', () => {
  const r = p()
  expect(r.pj).toEqual({ proLaborePct: 28, irpjPct: 6, inssPct: 11, contabilidadeCents: 80000, outrosCents: 19000, grossCents: 1000000 })
  expect(r.months[0].lines[0].pjGrossCents).toBe(1000000)
  expect(r.months[0].lines[1].pjGrossCents).toBeNull()
})

test('sem bloco PJ: pj null com aviso', () => {
  const r = parseOrcamentoPlanilha(makeOrcamento({ semPj: true }))
  expect(r.pj).toBeNull()
  expect(r.warnings.some(w => w.includes('PJ'))).toBe(true)
})

test('importar duas vezes não duplica', async () => {
  const db = createTestDb()
  const a = await importOrcamento(db, p())
  expect(a).toEqual({ months: 3, lines: 10, skipped: 0 })
  expect(await importOrcamento(db, p())).toEqual({ months: 0, lines: 0, skipped: 10 })
  expect((await loadOrcamento(db)).pj.outrosCents).toBe(19000)
})

test('linha editada no app continua como o usuário deixou e config PJ salva não é sobrescrita', async () => {
  const db = createTestDb()
  await importOrcamento(db, p())
  const o = await loadOrcamento(db)
  const l = o.lines.find(x => x.sourceKey === 'planilha:2024-01:6')!
  await saveLine(db, { ...l, amountCents: 123, name: 'Editada' })
  await savePjConfig(db, { ...DEFAULT_PJ, outrosCents: 5 })
  await importOrcamento(db, p())
  const after = await loadOrcamento(db)
  expect(after.lines.find(x => x.id === l.id)).toMatchObject({ amountCents: 123, name: 'Editada' })
  expect(after.lines).toHaveLength(o.lines.length)
  expect(after.pj.outrosCents).toBe(5)
})

test('mês existente recebe só linhas novas', async () => {
  const db = createTestDb()
  await saveLine(db, { month: '2024-01', kind: 'saida', name: 'Minha', amountCents: 1, recurring: false, position: 0, categoryId: null, installmentCurrent: null, installmentTotal: null, pjGrossCents: null, sourceKey: null })
  expect(await importOrcamento(db, p())).toEqual({ months: 2, lines: 10, skipped: 0 })
  expect((await loadOrcamento(db)).lines.filter(l => l.month === '2024-01')).toHaveLength(5)
})

test('erros em pt-BR', () => {
  expect(() => parseOrcamentoPlanilha(makeOrcamento({ semAba: true }))).toThrow('Aba "Finanças" não encontrada')
  expect(() => parseOrcamentoPlanilha(makeOrcamento({ semSaldo: true }))).toThrow('Linha "Saldo" não encontrada')
})
