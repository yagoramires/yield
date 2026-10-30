import { describe, expect, it } from 'vitest'
import type { Account, Category, CategoryRule, Txn } from '../db/gastosRepo'
import { categorize, displayName, fingerprint, monthTotals, normalizeDescription, withFingerprints } from './gastos'

const cat = (id: string, countsAsSpending = true): Category => ({ id, name: id, countsAsSpending, builtin: true, icon: null, color: null })
const categories = [
  cat('pagamento-de-fatura', false), cat('investimento', false), cat('receita', false), cat('transferencia', false),
  cat('transporte'), cat('alimentacao'),
]
const conta: Account = { id: 'c1', source: 'arquivo', externalId: 'x', institution: 'Banco', name: 'Conta', kind: 'conta', number: null, itemId: null, lastSyncAt: null }
const cartao: Account = { ...conta, id: 'k1', kind: 'cartao' }
const txn = (o: Partial<Txn>): Txn => ({ id: 't', accountId: 'c1', date: '2026-03-10', description: 'LOJA', amountCents: -1000, pending: false, installment: null, operationType: null, fingerprint: 'fp', sourceKey: 's', ...o })
const rule = (pattern: string, categoryId: string): CategoryRule => ({ id: pattern, pattern, categoryId })

describe('normalizeDescription', () => {
  it('tira prefixo, dígitos, acento e pontuação', () => {
    expect(normalizeDescription('PG *NETFLIX.COM 1234')).toBe('netflix com')
    expect(normalizeDescription('Pão de Açúcar  #12')).toBe('pao de acucar')
    expect(normalizeDescription('IFD*Pizzaria')).toBe('pizzaria')
  })
})

describe('displayName', () => {
  it('tira o prefixo da maquininha, a parcela do fim e o caixa alta do extrato; nome digitado fica como está', () => {
    expect(['MP*LOJAEXEMPLO', 'Pg *Barbearia', 'IFD*IFOOD', 'MERCADOLIVRE*MERCADOLIVRE', 'LOJAMKTPLC*CASA', 'Pag*Jogos 1/3', 'BANDA LARGA - INTERNET', 'PLANO DE SAUDE', 'Transferência enviada pelo Pix|Ana Teste', 'Aluguel do apê', 'MP3 Player'].map(displayName))
      .toEqual(['Lojaexemplo', 'Barbearia', 'Ifood', 'Mercadolivre', 'Lojamktplc · Casa', 'Jogos', 'Banda Larga - Internet', 'Plano de Saude', 'Pix para Ana Teste', 'Aluguel do apê', 'MP3 Player'])
  })
})

describe('fingerprints', () => {
  it('compras iguais no mesmo dia ganham #0 e #1', () => {
    const rows = withFingerprints('a', [
      { date: '2026-03-01', amountCents: -500, description: 'Padaria 1' },
      { date: '2026-03-01', amountCents: -500, description: 'PADARIA' },
      { date: '2026-03-02', amountCents: -500, description: 'Padaria' },
    ])
    expect(rows.map(r => r.fingerprint)).toEqual(['a|2026-03-01|-500|padaria|#0', 'a|2026-03-01|-500|padaria|#1', 'a|2026-03-02|-500|padaria|#0'])
    expect(fingerprint('a', '2026-03-01', -500, 'Padaria', 0)).toBe(rows[0].fingerprint)
  })
})

describe('categorize', () => {
  const rules = [rule('uber', 'transporte'), rule('uber eats', 'alimentacao')]
  it('a regra mais longa ganha', () => {
    expect(categorize(txn({ description: 'UBER *EATS' }), conta, rules, {}, categories)?.id).toBe('alimentacao')
    expect(categorize(txn({ description: 'UBER TRIP' }), conta, rules, {}, categories)?.id).toBe('transporte')
  })
  it('ajuste do fingerprint ganha da regra; categoria inexistente cai adiante', () => {
    expect(categorize(txn({ description: 'UBER', fingerprint: 'f' }), conta, rules, { f: 'alimentacao' }, categories)?.id).toBe('alimentacao')
    expect(categorize(txn({ description: 'UBER', fingerprint: 'f' }), conta, rules, { f: 'sumiu' }, categories)?.id).toBe('transporte')
  })
  it('automáticos', () => {
    const id = (t: Partial<Txn>, a = conta) => categorize(txn(t), a, [], {}, categories)?.id ?? null
    expect(id({ operationType: 'PAGAMENTO_FATURA' })).toBe('pagamento-de-fatura')
    expect(id({ description: 'PAGAMENTO FATURA CARTÃO' })).toBe('pagamento-de-fatura')
    expect(id({ description: 'PAGAMENTO FATURA CARTÃO' }, cartao)).toBeNull()
    expect(id({ operationType: 'RESGATE_APLIC_FINANCEIRA' })).toBe('investimento')
    expect(id({ operationType: 'RENDIMENTO_APLIC_FINANCEIRA', amountCents: 5 })).toBe('investimento')
    expect(id({ amountCents: -1000 }, cartao)).toBeNull()
  })
  it('no cartão, entrada só é fatura se parece pagamento; estorno fica sem categoria', () => {
    const id = (t: Partial<Txn>) => categorize(txn(t), cartao, [], {}, categories)?.id ?? null
    expect(id({ description: 'Pagamento recebido', amountCents: 150000 })).toBe('pagamento-de-fatura')
    expect(id({ description: 'PGTO DEBITO AUTOMATICO', amountCents: 150000 })).toBe('pagamento-de-fatura')
    expect(id({ description: 'ESTORNO LOJA X', amountCents: 11900 })).toBeNull()
  })
  it('pagamento de fatura na conta pelas variações do texto', () => {
    const id = (description: string) => categorize(txn({ description, amountCents: -90000 }), conta, [], {}, categories)?.id ?? null
    for (const d of ['PAGTO CARTAO CREDITO', 'PAG FAT CARTAO', 'PAGAMENTO DE FATURA', 'PAG CARTAO', 'Pagamento fatura cartão'])
      expect(id(d), d).toBe('pagamento-de-fatura')
    expect(id('pagamento aluguel')).toBeNull()
    expect(id('PAG FATIMA SILVA')).toBeNull()
  })
  it('aplicação saindo da conta é investimento', () => {
    const id = (description: string, amountCents = -50000, a = conta) => categorize(txn({ description, amountCents }), a, [], {}, categories)?.id ?? null
    for (const d of ['APLICACAO CDB', 'Dinheiro guardado na caixinha', 'APLIC RDB', 'INVESTIMENTO TESOURO'])
      expect(id(d), d).toBe('investimento')
    expect(id('IFOOD')).toBeNull()
    expect(id('APLICACAO CDB', 50000)).toBeNull() // entrada não é aplicação
    expect(id('APLICACAO CDB', -50000, cartao)).toBeNull()
  })
})

describe('monthTotals', () => {
  it('fatura não conta duas vezes', () => {
    const txns = [
      txn({ id: '1', accountId: 'k1', amountCents: -10000, description: 'LOJA' }),
      txn({ id: '2', accountId: 'c1', amountCents: -10000, description: 'PAGAMENTO FATURA' }),
      txn({ id: '3', accountId: 'k1', amountCents: 10000, description: 'PAGAMENTO RECEBIDO' }),
      txn({ id: '4', accountId: 'c1', date: '2026-04-01', amountCents: -999 }),
    ]
    const acc = new Map([conta, cartao].map(a => [a.id, a]))
    const t = monthTotals(txns, [conta, cartao], x => categorize(x, acc.get(x.accountId)!, [], {}, categories), '2026-03')
    expect(t.spentCents).toBe(10000)
    expect(t.incomeCents).toBe(0)
    expect(t.byCategory).toEqual([{ category: null, cents: 10000 }])
  })
  it('entradas, estorno e ordenação', () => {
    const c = (id: string) => categories.find(x => x.id === id)!
    const m: Record<string, Category | null> = { a: c('transporte'), b: c('alimentacao'), r: c('receita'), e: c('alimentacao'), n: null }
    const t = monthTotals([
      txn({ id: 'a', amountCents: -300 }), txn({ id: 'b', amountCents: -700 }), txn({ id: 'r', amountCents: 5000 }),
      txn({ id: 'e', amountCents: 200 }), txn({ id: 'n', amountCents: 50 }),
    ], [conta], x => m[x.id], '2026-03')
    expect(t.spentCents).toBe(1000)
    expect(t.incomeCents).toBe(5250)
    expect(t.byCategory.map(b => b.cents)).toEqual([700, 300])
  })
  it('estorno no cartão entra como receita', () => {
    const t = monthTotals([
      txn({ accountId: 'k1', amountCents: -11900, description: 'LOJA X' }),
      txn({ accountId: 'k1', amountCents: 11900, description: 'ESTORNO LOJA X' }),
    ], [cartao], x => categorize(x, cartao, [], {}, categories), '2026-03')
    expect(t.spentCents).toBe(11900)
    expect(t.incomeCents).toBe(11900)
  })
})

describe('categorize com transferências', () => {
  it('par entre contas e Pix com o seu nome viram Transferência; escolha manual e regra vencem', () => {
    expect(categorize(txn({}), conta, [], {}, categories, { paired: true })?.id).toBe('transferencia')
    expect(categorize(txn({ description: 'PIX ENVIADO ANA TESTE' }), conta, [], {}, categories, { ownerNames: ['Ana Teste'] })?.id).toBe('transferencia')
    expect(categorize(txn({ description: 'PIX ENVIADO ANA TESTE' }), cartao, [], {}, categories, { ownerNames: ['Ana Teste'] })).toBeNull()
    expect(categorize(txn({ description: 'PIX RECEBIDO ANA TESTE TECNOLOGIA LTDA', amountCents: 500000 }), conta, [], {}, categories, { ownerNames: ['Ana Teste'], companyNames: ['Ana Teste Tecnologia'] })?.id).toBe('receita')
    expect(categorize(txn({ description: 'PIX RECEBIDO ANA TESTE TECNOLOGIA LTDA', amountCents: 500000 }), conta, [], {}, categories, { companyNames: ['Ana Teste Tecnologia'] })?.id).toBe('receita')
    // dinheiro que você manda para a sua própria empresa é transferência, não gasto
    expect(categorize(txn({ description: 'PIX ENVIADO ANA TESTE TECNOLOGIA LTDA', amountCents: -300000 }), conta, [], {}, categories, { ownerNames: ['Ana Teste'], companyNames: ['Ana Teste Tecnologia'] })?.id).toBe('transferencia')
    expect(categorize(txn({}), conta, [], { fp: 'alimentacao' }, categories, { paired: true })?.id).toBe('alimentacao')
    expect(categorize(txn({ description: 'UBER' }), conta, [rule('uber', 'transporte')], {}, categories, { paired: true })?.id).toBe('transporte')
  })
})

describe('categorize com a categoria da Pluggy', () => {
  it('usa a da Pluggy por último: regra e heurística de fatura vencem', () => {
    expect(categorize(txn({ pluggyCategory: 'Groceries' }), conta, [], {}, [...categories, cat('mercado')])?.id).toBe('mercado')
    expect(categorize(txn({ description: 'UBER', pluggyCategory: 'Groceries' }), conta, [rule('uber', 'transporte')], {}, [...categories, cat('mercado')])?.id).toBe('transporte')
    expect(categorize(txn({ operationType: 'PAGAMENTO_FATURA', pluggyCategory: 'Groceries' }), conta, [], {}, [...categories, cat('mercado')])?.id).toBe('pagamento-de-fatura')
    expect(categorize(txn({ pluggyCategory: 'Same person transfer' }), conta, [], {}, categories)?.id).toBe('transferencia')
  })
})
