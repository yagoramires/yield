import { expect, test } from 'vitest'
import type { Account, Category, Txn } from '../db/gastosRepo'
import { plainBRL, setMasked } from '../domain/money'
import { buildPortfolio } from '../domain/portfolio'
import { buildFacts, factsHash, type AiInput } from './facts'

const TODAY = '2026-10-30'
const cats: Category[] = [{ id: 'delivery', name: 'Delivery', countsAsSpending: true, builtin: false, icon: null, color: null }]
const conta = (id: string, source: Account['source'], balanceCents: number | null): Account => ({ id, source, externalId: id, institution: 'Banco Laranja', name: 'Conta corrente', kind: 'conta', number: null, itemId: null, lastSyncAt: null, balanceCents, balanceAt: balanceCents === null ? null : '2026-10-30T09:00:00Z' })
const txn = (id: string, date: string, amountCents: number, description = 'IFOOD *PEDIDO'): Txn => ({ id, accountId: 'a1', date, description, amountCents, pending: false, installment: null, operationType: null, fingerprint: id, sourceKey: 'teste' })

function input(over: Partial<AiInput> = {}): AiInput {
  const txns = [txn('t1', '2026-09-10', -30000), txn('t2', '2026-10-10', -39000), txn('t3', '2026-10-05', 500000, 'SALARIO')]
  return {
    today: TODAY,
    gastos: {
      data: { accounts: [conta('a1', 'pluggy', 500000), conta('a2', 'arquivo', 100000)], txns, categories: cats, rules: [], overrides: {}, dismissed: [], pluggyItems: [], ownerNames: [], companyNames: [], ruleSuggestionsDismissed: [] },
      categorize: t => (t.amountCents < 0 ? cats[0] : null),
      subscriptions: [],
    },
    orcamento: { months: [], lines: [], dismissed: [], sources: [], goals: [], fixedCategories: [], reservas: [] },
    portfolio: { ...buildPortfolio([], [], [], [], TODAY), totalValueCents: 1_000_000 },
    dividends: [],
    rfMoves: [],
    rent: { carteiraPct: 8, cdiPct: 12.5, ibovPct: null, cdiMonthPct: 1 },
    ...over,
  }
}

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
