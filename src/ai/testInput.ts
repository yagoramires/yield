// Dados inventados para os testes da IA (repositório público: nada real aqui).
import type { Account, Category, Txn } from '../db/gastosRepo'
import { buildPortfolio } from '../domain/portfolio'
import type { AiInput } from './facts'

export const TODAY = '2026-10-30'
export const cats: Category[] = [{ id: 'delivery', name: 'Delivery', countsAsSpending: true, builtin: false, icon: null, color: null }]
export const conta = (id: string, source: Account['source'], balanceCents: number | null): Account => ({ id, source, externalId: id, institution: 'Banco Laranja', name: 'Conta corrente', kind: 'conta', number: null, itemId: source === 'pluggy' ? 'i1' : null, lastSyncAt: null, balanceCents, balanceAt: balanceCents === null ? null : '2026-10-30T09:00:00Z' })
export const txn = (id: string, date: string, amountCents: number, description = 'IFOOD *PEDIDO'): Txn => ({ id, accountId: 'a1', date, description, amountCents, pending: false, installment: null, operationType: null, fingerprint: id, sourceKey: 'teste' })

export function input(over: Partial<AiInput> = {}): AiInput {
  const txns = [txn('t1', '2026-09-10', -30000), txn('t2', '2026-10-10', -39000), txn('t3', '2026-10-05', 500000, 'SALARIO')]
  return {
    today: TODAY,
    gastos: {
      data: { accounts: [conta('a1', 'pluggy', 500000), conta('a2', 'arquivo', 100000)], txns, categories: cats, rules: [], overrides: {}, dismissed: [], pluggyItems: [{ itemId: 'i1', label: 'Banco Laranja' }], ownerNames: [], companyNames: [], ruleSuggestionsDismissed: [] },
      categorize: t => (t.amountCents < 0 ? cats[0] : null),
      subscriptions: [],
    },
    orcamento: { months: [], lines: [], dismissed: [], sources: [], goals: [], fixedCategories: [], reservas: [], reservaLinks: {} },
    portfolio: { ...buildPortfolio([], [], [], [], TODAY), totalValueCents: 1_000_000 },
    dividends: [],
    rfMoves: [],
    rent: { carteiraPct: 8, cdiPct: 12.5, ibovPct: null, cdiMonthPct: 1 },
    ...over,
  }
}

