// Perfis financeiros inventados para a bateria (repositório público: bancos de mentira, tickers AAAA3/FIIA11).
import type { Account, Category, Txn } from '../../db/gastosRepo'
import { fold } from '../../domain/gastos'
import { replay } from '../../domain/ledger'
import { buildPortfolio } from '../../domain/portfolio'
import type { Dividend, Trade } from '../../domain/types'
import type { AiInput } from '../facts'

export const TODAY = '2026-10-30'
const cat = (id: string, name: string): Category => ({ id, name, countsAsSpending: true, builtin: false, icon: null, color: null })
const CATS = [cat('delivery', 'Delivery'), cat('mercado', 'Mercado'), cat('transporte', 'Transporte'), cat('padaria', 'Padaria')]
// descrição → categoria; entrada (valor positivo) fica sem categoria e conta como receita
const RULES: [string, string][] = [['ifood', 'delivery'], ['mercado', 'mercado'], ['uber', 'transporte'], ['padaria', 'padaria']]
const categorize = (t: Txn) => (t.amountCents > 0 ? null : CATS.find(c => c.id === RULES.find(([k]) => fold(t.description).includes(k))?.[1]) ?? null)

let seq = 0
const t = (date: string, reais: number, description: string): Txn => ({ id: `t${++seq}`, accountId: 'a1', date, description, amountCents: Math.round(reais * 100), pending: false, installment: null, operationType: null, fingerprint: `f${seq}`, sourceKey: 'eval' })
const salario = (m: string, reais: number) => t(`${m}-05`, reais, 'SALARIO EMPRESA FICTICIA')
const conta = (balanceCents: number | null): Account => ({ id: 'a1', source: 'pluggy', externalId: 'a1', institution: 'Banco Laranja', name: 'Conta corrente', kind: 'conta', number: null, itemId: 'i1', lastSyncAt: null, balanceCents, balanceAt: balanceCents === null ? null : '2026-10-29T08:00:00Z' })
const emptyOrc = { months: [], lines: [], dismissed: [], sources: [], goals: [], fixedCategories: [], reservas: [], reservaLinks: {} }
const emptyPortfolio = () => buildPortfolio([], [], [], [], TODAY)

function perfil(txns: Txn[], over: Partial<AiInput> = {}, balanceCents: number | null = null): AiInput {
  return {
    today: TODAY,
    gastos: { data: { accounts: [conta(balanceCents)], txns, categories: CATS, rules: [], overrides: {}, dismissed: [], pluggyItems: [{ itemId: 'i1', label: 'Banco Laranja' }], ownerNames: [], companyNames: [], ruleSuggestionsDismissed: [] }, categorize, subscriptions: [] },
    orcamento: emptyOrc, portfolio: emptyPortfolio(), dividends: [], rfMoves: [], rent: null, ...over,
  }
}

const goal = (categoryId: string, reais: number) => ({ month: '2026-10', key: `cat:${categoryId}`, amountCents: reais * 100 })

const gastador = perfil([
  salario('2026-08', 6000), t('2026-08-03', -120, 'IFOOD *PEDIDO'), t('2026-08-17', -130, 'IFOOD *PEDIDO'), t('2026-08-10', -900, 'MERCADO VERDE'), t('2026-08-12', -200, 'UBER *VIAGEM'),
  salario('2026-09', 6000), t('2026-09-04', -150, 'IFOOD *PEDIDO'), t('2026-09-18', -150, 'IFOOD *PEDIDO'), t('2026-09-10', -880, 'MERCADO VERDE'), t('2026-09-12', -210, 'UBER *VIAGEM'),
  salario('2026-10', 6000), t('2026-10-03', -180, 'IFOOD *PEDIDO'), t('2026-10-11', -160, 'IFOOD *PEDIDO'), t('2026-10-24', -180, 'IFOOD *PEDIDO'), t('2026-10-10', -910, 'MERCADO VERDE'), t('2026-10-12', -190, 'UBER *VIAGEM'),
], {
  // limites por categoria são metas (cat:<id>); linha variável no app é gasto lançado à mão
  orcamento: { ...emptyOrc, months: ['2026-10'], goals: [goal('mercado', 900), goal('delivery', 300), goal('transporte', 250)] },
})
gastador.gastos.subscriptions = [{ merchantKey: 'streaming-azul', name: 'STREAMING AZUL', accountId: 'a1', period: 'mensal', amountCents: 3990, monthlyCents: 3990, yearlyCents: 47880, lastDate: '2026-10-05', nextDate: '2026-11-05', active: true, charges: 6, previousAmountCents: null }]

const tr = (ticker: string, assetType: Trade['assetType'], qty: number, priceCents: number, date: string): Trade =>
  ({ id: ticker, noteId: `n-${ticker}`, seq: 1, broker: 'CORRETORA TESTE', tradeDate: date, settleDate: date, side: 'C', assetType, ticker, qty, priceCents, feesCents: 0, irrfCents: 0 })
const trades = [tr('AAAA3', 'Ação', 100, 2000, '2025-05-10'), tr('FIIA11', 'FII', 50, 10000, '2025-06-10')]
const div = (ticker: string, payDate: string, amountCents: number): Dividend => ({ id: `${ticker}-${payDate}`, ticker, kind: ticker.endsWith('11') ? 'Rendimento' : 'Dividendo', payDate, amountCents, broker: null, source: 'b3', sourceKey: null })
const dividends = [...Array.from({ length: 10 }, (_, i) => div('FIIA11', `2026-${String(i + 1).padStart(2, '0')}-15`, 4000)), div('AAAA3', '2026-08-20', 12000)]
const quotes = [{ symbol: 'AAAA3.SA', priceCents: 2150, fetchedAt: '2026-10-30T15:00:00Z', source: 'yahoo' as const }, { symbol: 'FIIA11.SA', priceCents: 9800, fetchedAt: '2026-10-30T15:00:00Z', source: 'yahoo' as const }]

const investidor = perfil([
  salario('2026-09', 8000), t('2026-09-09', -1000, 'MERCADO VERDE'), salario('2026-10', 8000), t('2026-10-09', -1000, 'MERCADO VERDE'),
], { portfolio: buildPortfolio(replay(trades, []).positions, quotes, [], dividends, TODAY), dividends, rent: { carteiraPct: 4.2, cdiPct: 11.8, ibovPct: 9.1, cdiMonthPct: 0.9 } })

const semOrcamento = perfil([
  salario('2026-10', 3000), t('2026-10-06', -300, 'MERCADO AZUL'), t('2026-10-20', -150, 'MERCADO AZUL'), t('2026-10-08', -120, 'UBER *VIAGEM'),
  t('2026-10-02', -25, 'PADARIA PÃO QUENTE'), t('2026-10-09', -25, 'PADARIA PÃO QUENTE'), t('2026-10-16', -25, 'PADARIA PÃO QUENTE'),
])

const dinheiroParado = perfil([
  salario('2026-09', 5000), t('2026-09-07', -800, 'MERCADO VERDE'), salario('2026-10', 5000), t('2026-10-07', -800, 'MERCADO VERDE'),
], { rent: { carteiraPct: null, cdiPct: 11.8, ibovPct: null, cdiMonthPct: 0.9 } }, 2_000_000)

export const PERFIS: Record<string, AiInput> = { gastador, investidor, semOrcamento, dinheiroParado }
