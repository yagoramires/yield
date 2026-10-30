import { expect, test } from 'vitest'
import { plainBRL, setMasked } from '../domain/money'
import { buildPortfolio } from '../domain/portfolio'
import { buildFacts, factsHash } from './facts'
import { input, TODAY, txn } from './testInput'

const text = (facts: { id: string; text: string }[], id: string) => facts.find(f => f.id === id)?.text ?? ''

test('variação da categoria com o valor, o % e a diferença já calculados', () => {
  const f = buildFacts('2026-10', input())
  const v = f.find(x => x.kind === 'variacao_categoria')!
  expect(v).toMatchObject({ route: 'lancamentos', categoryId: 'delivery' })
  expect(v.text).toContain(plainBRL(39000))
  expect(v.text).toContain('+30,0%')
  expect(v.text).toContain(plainBRL(9000))
})

test('dinheiro parado só das contas da Pluggy, com o rendimento a 100% do CDI', () => {
  const t = text(buildFacts('2026-10', input()), 'saldo_parado')
  expect(t).toContain(plainBRL(500000))
  expect(t).toContain(plainBRL(5000))
  expect(t).not.toContain(plainBRL(600000))
})

test('banco desconectado não entra no dinheiro parado', () => {
  const base = input()
  const semBanco = { ...base, gastos: { ...base.gastos, data: { ...base.gastos.data, pluggyItems: [] } } }
  expect(buildFacts('2026-10', semBanco).map(f => f.kind)).not.toContain('saldo_parado')
})

test('sem gasto no mês anterior não compara (setembro contra um agosto vazio)', () => {
  const kinds = buildFacts('2026-09', input()).map(f => f.kind)
  expect(kinds).not.toContain('vs_anterior')
  expect(kinds).not.toContain('variacao_categoria')
})

test('o que sobrou e o que foi gasto vêm com o % de cada um, sem ambiguidade', () => {
  const t = text(buildFacts('2026-10', input()), 'gasto_mes')
  expect(t).toContain('7,8% das entradas') // 390 de 5.000
  expect(t).toContain('92,2% das entradas')
})

test('mês passado não leva os fatos de agora (carteira, rentabilidade, saldo)', () => {
  const kinds = buildFacts('2026-09', input()).map(f => f.kind)
  expect(kinds).toContain('gasto_mes')
  expect(kinds).not.toContain('carteira')
  expect(kinds).not.toContain('saldo_parado')
  expect(kinds).not.toContain('rentabilidade')
})

test('o olhinho não esconde os valores do que vai para o modelo', () => {
  setMasked(true)
  try { expect(text(buildFacts('2026-10', input()), 'gasto_mes')).toContain(plainBRL(39000)) } finally { setMasked(false) }
})

test('sem dado nenhum, nenhum fato', () => {
  const vazio = input({ portfolio: buildPortfolio([], [], [], [], TODAY), rent: null })
  vazio.gastos = { ...vazio.gastos, data: { ...vazio.gastos.data, txns: [], accounts: [] } }
  expect(buildFacts('2026-10', vazio)).toEqual([])
})

test('cotação nova não muda o hash; gasto novo muda', async () => {
  const base = await factsHash(buildFacts('2026-10', input()))
  expect(await factsHash(buildFacts('2026-10', input({ portfolio: { ...buildPortfolio([], [], [], [], TODAY), totalValueCents: 2_000_000 } })))).toBe(base)
  const mais = input()
  mais.gastos = { ...mais.gastos, data: { ...mais.gastos.data, txns: [...mais.gastos.data.txns, txn('t4', '2026-10-11', -1000)] } }
  expect(await factsHash(buildFacts('2026-10', mais))).not.toBe(base)
})
