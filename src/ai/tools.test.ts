import { expect, test } from 'vitest'
import { normalizeDescription } from '../domain/gastos'
import { plainBRL } from '../domain/money'
import { input, txn } from './testInput'
import { runTool, TOOLS } from './tools'

const noRent = async () => null

test('gastos soma os meses pedidos por categoria', async () => {
  expect(await runTool('gastos', { de: '2026-09', ate: '2026-10' }, input(), noRent)).toMatchObject({ total: plainBRL(69000), porCategoria: [{ categoria: 'Delivery', valor: plainBRL(69000) }] })
  expect(await runTool('gastos', { de: '2026-10', ate: '2026-10' }, input(), noRent)).toMatchObject({ total: plainBRL(39000) })
})

test('lancamentos devolve no máximo 30 linhas, mas conta e soma todas', async () => {
  const base = input()
  const many = Array.from({ length: 40 }, (_, i) => txn(`m${i}`, `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, -100))
  const r = await runTool('lancamentos', { de: '2026-10', ate: '2026-10' }, { ...base, gastos: { ...base.gastos, data: { ...base.gastos.data, txns: many } } }, noRent) as { linhas: unknown[]; quantidade: number; total: string }
  expect(r.linhas).toHaveLength(30)
  expect(r.quantidade).toBe(40)
  expect(r.total).toBe(plainBRL(4000))
})

test('busca ignora acento e caixa', async () => {
  const base = input()
  const txns = [txn('p', '2026-10-03', -1250, 'PADARIA PÃO QUENTE'), txn('q', '2026-10-04', -9000, 'MERCADO AZUL')]
  const r = await runTool('lancamentos', { de: '2026-10', ate: '2026-10', busca: 'pao quente' }, { ...base, gastos: { ...base.gastos, data: { ...base.gastos.data, txns } } }, noRent) as { linhas: { descricao: string }[] }
  expect(r.linhas.map(l => l.descricao)).toEqual(['Padaria Pão Quente'])
})

test('argumento inválido vira erro em português, sem exceção', async () => {
  expect(await runTool('gastos', { de: '2026-13', ate: '2026-10' }, input(), noRent)).toHaveProperty('erro')
  expect(await runTool('gastos', null, input(), noRent)).toHaveProperty('erro')
  expect(await runTool('apagar_tudo', {}, input(), noRent)).toHaveProperty('erro')
})

test('orcamento traz planejado e realizado por bloco', async () => {
  const base = input()
  const desc = 'LOJA DE MOVEIS'
  const parcela = { ...txn('pc', '2026-10-08', -5000, desc), installment: '3/10' }
  const aluguel = txn('al', '2026-10-05', -80000, 'ALUGUEL')
  const moradia = { id: 'moradia', name: 'Moradia', countsAsSpending: true, builtin: true, icon: null, color: null }
  const line = (id: string, extra: object) => ({ id, month: '2026-10', kind: 'saida' as const, name: id, amountCents: 5000, recurring: false, position: 0, categoryId: null, installmentCurrent: null, installmentTotal: null, sourceId: null, sourceKey: null, grupo: null, ...extra })
  const r = await runTool('orcamento', { mes: '2026-10' }, {
    ...base,
    gastos: { ...base.gastos, categorize: t => (t.id === 'al' ? moradia : base.gastos.categorize(t)), data: { ...base.gastos.data, categories: [...base.gastos.data.categories, moradia], txns: [...base.gastos.data.txns, parcela, aluguel] } },
    orcamento: { ...base.orcamento, months: ['2026-10'], fixedCategories: ['moradia'], lines: [line('parc', { installmentCurrent: 3, installmentTotal: 10, sourceKey: `parc:a1|${normalizeDescription(desc)}|10|5000@2026-10` })] },
  }, noRent) as { porBloco: { bloco: string; planejado: string; realizado?: string }[] }
  expect(r.porBloco).toEqual(expect.arrayContaining([
    { bloco: 'parcela', planejado: plainBRL(5000), realizado: plainBRL(5000) },
    { bloco: 'fixo', planejado: plainBRL(0), realizado: plainBRL(80000) },
  ]))
})

test('todas as ferramentas descritas para o modelo', () => {
  expect(TOOLS.map(t => t.function.name).sort()).toEqual(['carteira', 'gastos', 'lancamentos', 'orcamento', 'proventos', 'rentabilidade'])
})
