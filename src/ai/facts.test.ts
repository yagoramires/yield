import { expect, test } from 'vitest'
import { plainBRL, setMasked } from '../domain/money'
import { buildPortfolio } from '../domain/portfolio'
import { buildFacts, factsHash } from './facts'
import { input, TODAY, txn } from './testInput'

const text = (facts: { id: string; text: string }[], id: string) => facts.find(f => f.id === id)?.text ?? ''

test('variação da categoria com o valor, o % e a diferença já calculados', () => {
  const f = buildFacts('2026-10', 'gastos', input())
  const v = f.find(x => x.kind === 'variacao_categoria')!
  expect(v).toMatchObject({ route: 'lancamentos', categoryId: 'delivery' })
  expect(v.text).toContain(plainBRL(39000))
  expect(v.text).toContain('+30,0%')
  expect(v.text).toContain(plainBRL(9000))
})

test('dinheiro parado só das contas da Pluggy, com o rendimento a 100% do CDI', () => {
  const t = text(buildFacts('2026-10', 'gastos', input()), 'saldo_parado')
  expect(t).toContain(plainBRL(500000))
  expect(t).toContain(plainBRL(5000))
  expect(t).not.toContain(plainBRL(600000))
})

test('banco desconectado não entra no dinheiro parado', () => {
  const base = input()
  const semBanco = { ...base, gastos: { ...base.gastos, data: { ...base.gastos.data, pluggyItems: [] } } }
  expect(buildFacts('2026-10', 'gastos', semBanco).map(f => f.kind)).not.toContain('saldo_parado')
})

test('sem gasto no mês anterior não compara (setembro contra um agosto vazio)', () => {
  const kinds = buildFacts('2026-09', 'gastos', input()).map(f => f.kind)
  expect(kinds).not.toContain('vs_anterior')
  expect(kinds).not.toContain('variacao_categoria')
})

test('o que sobrou e o que foi gasto vêm com o % de cada um, sem ambiguidade', () => {
  const t = text(buildFacts('2026-10', 'gastos', input()), 'gasto_mes')
  expect(t).toContain('7,8% das entradas') // 390 de 5.000
  expect(t).toContain('92,2% das entradas')
})

test('mês passado não leva os fatos de agora (carteira, rentabilidade, saldo)', () => {
  const kinds = buildFacts('2026-09', 'gastos', input()).map(f => f.kind)
  expect(kinds).toContain('gasto_mes')
  expect(kinds).not.toContain('carteira')
  expect(kinds).not.toContain('saldo_parado')
  expect(kinds).not.toContain('rentabilidade')
})

test('o olhinho não esconde os valores do que vai para o modelo', () => {
  setMasked(true)
  try { expect(text(buildFacts('2026-10', 'gastos', input()), 'gasto_mes')).toContain(plainBRL(39000)) } finally { setMasked(false) }
})

test('mês vazio com o anterior cheio não vira "caiu 100%"', () => {
  expect(buildFacts('2026-11', 'gastos', { ...input(), today: '2026-12-15' })).toEqual([])
  const kinds = buildFacts('2026-11', 'gastos', { ...input(), today: '2026-11-01' }).map(f => f.kind)
  expect(kinds).not.toContain('vs_anterior')
  expect(kinds).not.toContain('variacao_categoria')
})

test('sem dado nenhum, nenhum fato', () => {
  const vazio = input({ portfolio: buildPortfolio([], [], [], [], TODAY), rent: null })
  vazio.gastos = { ...vazio.gastos, data: { ...vazio.gastos.data, txns: [], accounts: [] } }
  expect(buildFacts('2026-10', 'gastos', vazio)).toEqual([])
})

test('cotação nova não muda o hash; gasto novo muda', async () => {
  const base = await factsHash(buildFacts('2026-10', 'gastos', input()), TODAY)
  expect(await factsHash(buildFacts('2026-10', 'gastos', input({ portfolio: { ...buildPortfolio([], [], [], [], TODAY), totalValueCents: 2_000_000 } })), TODAY)).toBe(base)
  const mais = input()
  mais.gastos = { ...mais.gastos, data: { ...mais.gastos.data, txns: [...mais.gastos.data.txns, txn('t4', '2026-10-11', -1000)] } }
  expect(await factsHash(buildFacts('2026-10', 'gastos', mais), TODAY)).not.toBe(base)
})

test('cada Resumo leva os fatos da sua área', () => {
  const gastos = buildFacts('2026-10', 'gastos', input()).map(f => f.kind)
  expect(gastos).toContain('saldo_parado')
  expect(gastos.some(k => ['carteira', 'rentabilidade', 'renda_passiva'].includes(k))).toBe(false)
  expect(buildFacts('2026-10', 'investimentos', input()).map(f => f.kind)).toEqual(['carteira', 'rentabilidade'])
  expect(buildFacts('2026-09', 'investimentos', input())).toEqual([]) // investimento é o retrato de hoje
})

test('investimentos mudam a cada cotação: o hash muda só com o dia', async () => {
  const facts = (total: number) => buildFacts('2026-10', 'investimentos', input({ portfolio: { ...buildPortfolio([], [], [], [], TODAY), totalValueCents: total } }))
  const base = await factsHash(facts(1_000_000), TODAY)
  expect(await factsHash(facts(1_234_500), TODAY)).toBe(base)
  expect(await factsHash(facts(1_000_000), '2026-10-31')).not.toBe(base)
})

test('Orçamento: plano do mês e metas por categoria contra o gasto, com o quanto passou', () => {
  const base = input()
  const line = (id: string, kind: 'entrada' | 'saida', amountCents: number, grupo: 'fixo' | null) => ({ id, month: '2026-10', kind, name: id, amountCents, recurring: true, position: 0, categoryId: null, installmentCurrent: null, installmentTotal: null, sourceId: null, sourceKey: null, grupo })
  const inp = { ...base, orcamento: { ...base.orcamento, months: ['2026-10'], lines: [line('Salário', 'entrada', 500000, null), line('Aluguel', 'saida', 150000, 'fixo')], goals: [{ month: '2026-10', key: 'cat:delivery', amountCents: 30000 }] } }
  const f = buildFacts('2026-10', 'orcamento', inp)
  expect(f.map(x => x.kind)).toEqual(['plano_mes', 'metas']) // o "planejado" do Resumo de gastos não é o da tela do Orçamento
  expect(text(f, 'plano_mes')).toContain(plainBRL(500000))
  expect(text(f, 'plano_mes')).toContain(plainBRL(350000))
  expect(text(f, 'metas')).toContain(`Delivery ${plainBRL(39000)} de ${plainBRL(30000)} (130,0%, passou ${plainBRL(9000)})`)
  const gastos = buildFacts('2026-10', 'gastos', inp).map(x => x.kind)
  expect(gastos).toContain('orcamento')
  expect(gastos).not.toContain('metas')
})
