import { describe, expect, it } from 'vitest'
import type { Account, Category, GastosData, Txn } from '../../db/gastosRepo'
import {
  categoryBars, categoryStrip, cleanDescription, comparePreviousMonth, cumulativeByDay, duplicateAccountWarning, filterTxns, groupByDay, needsSync, ruleFor,
  shortAccountLabel, spentByMonth, suggestRulePattern, topSpending, type TxnFilter,
} from './build'

const cat = (id: string, countsAsSpending = true): Category => ({ id, name: id, countsAsSpending, builtin: true, icon: null, color: null })
const fatura = cat('pagamento-de-fatura', false)
const mercado = cat('mercado')
const conta: Account = { id: 'c1', source: 'arquivo', externalId: 'x', institution: 'Banco Laranja', name: 'Conta', kind: 'conta', number: '4821', itemId: null, lastSyncAt: null }
const cartao: Account = { ...conta, id: 'k1', externalId: 'y', kind: 'cartao', number: null }
const txn = (o: Partial<Txn>): Txn => ({ id: o.description ?? 't', accountId: 'c1', date: '2026-10-10', description: 'LOJA', amountCents: -1000, pending: false, installment: null, operationType: null, fingerprint: o.description ?? 'fp', sourceKey: 's', ...o })
// categoria por descrição, para os testes não dependerem das regras
const byDesc: Record<string, Category> = { 'Pag Fatura': fatura, 'Mercado Bom': mercado }
const catOf = (t: Txn) => byDesc[t.description] ?? null
const ALL: TxnFilter = { accountKind: 'todas', categoryId: null, search: '' }

describe('filterTxns', () => {
  const txns = [
    txn({ description: 'Mercado Bom', date: '2026-10-02' }),
    txn({ description: 'Pão de Açúcar', date: '2026-10-03', accountId: 'k1' }),
    txn({ description: 'Pag Fatura', date: '2026-10-04' }),
    txn({ description: 'Setembro', date: '2026-09-30' }),
    txn({ description: 'Pix recebido 123', date: '2026-10-05', amountCents: 5000 }),
  ]
  const run = (f: Partial<TxnFilter>) => filterTxns(txns, [conta, cartao], catOf, '2026-10', { ...ALL, ...f }).map(t => t.description)

  it('fica só no mês', () => expect(run({})).toEqual(['Mercado Bom', 'Pão de Açúcar', 'Pag Fatura', 'Pix recebido 123']))
  it('por tipo de conta', () => {
    expect(run({ accountKind: 'cartao' })).toEqual(['Pão de Açúcar'])
    expect(run({ accountKind: 'conta' })).toEqual(['Mercado Bom', 'Pag Fatura', 'Pix recebido 123'])
  })
  it('por categoria e sem categoria', () => {
    expect(run({ categoryId: 'mercado' })).toEqual(['Mercado Bom'])
    expect(run({ categoryId: 'sem' })).toEqual(['Pão de Açúcar']) // só gasto sem categoria, como a barra do Resumo
  })
  it('busca que normaliza para vazio cai na busca literal', () => {
    expect(run({ search: '123' })).toEqual(['Pix recebido 123'])
    expect(run({ search: '  ' })).toHaveLength(4)
  })
  it('busca sem acento nem caixa', () => expect(run({ search: 'PAO de acu' })).toEqual(['Pão de Açúcar']))
})

describe('groupByDay', () => {
  it('mais recente primeiro, total só do que conta como gasto ou entrada', () => {
    const g = groupByDay([
      txn({ description: 'a', date: '2026-10-01', amountCents: -500 }),
      txn({ description: 'Pag Fatura', date: '2026-10-02', amountCents: -150000 }),
      txn({ description: 'b', date: '2026-10-02', amountCents: -1000 }),
      txn({ description: 'estorno', date: '2026-10-02', amountCents: 300 }),
    ], catOf)
    expect(g.map(d => [d.date, d.totalCents, d.txns.length])).toEqual([['2026-10-02', -700, 3], ['2026-10-01', -500, 1]])
  })
})

it('suggestRulePattern normaliza a descrição', () => expect(suggestRulePattern('PG *Padaria Central 123')).toBe('padaria central'))

describe('duplicateAccountWarning', () => {
  it('mesmo tipo e mesmo final de número, origens diferentes, ignorando a instituição', () => {
    const pluggy: Account = { ...conta, id: 'p1', source: 'pluggy', externalId: 'pluggy:1', institution: 'Laranja S.A.', name: 'Conta Corrente', number: '0001234821' }
    expect(duplicateAccountWarning([conta, pluggy, cartao], [])).toEqual(['"Conta ···4821" (extrato) e "Conta Corrente ···4821" (Pluggy) podem ser a mesma conta, contada em dobro'])
    expect(duplicateAccountWarning([conta, { ...conta, id: 'c2', externalId: 'z' }], [])).toEqual([])
  })
  it('dois cartões com finais diferentes não avisam', () => {
    const k2: Account = { ...cartao, id: 'k2', source: 'pluggy', externalId: 'pluggy:k2', number: '9999' }
    expect(duplicateAccountWarning([{ ...cartao, number: '1111' }, k2], [])).toEqual([])
  })
  it('extrato sem número com as mesmas linhas de uma conta da Pluggy', () => {
    const nu: Account = { ...conta, id: 'n1', externalId: 'csv:nubank-conta:minha nu', institution: 'Nubank', name: 'Minha Nu', number: null }
    const pl: Account = { ...conta, id: 'p1', source: 'pluggy', externalId: 'pluggy:1', institution: 'Nubank', name: 'NuConta', number: '77' }
    const rows = (accountId: string, descs: string[]) => descs.map((d, i) => txn({ accountId, description: d, date: `2026-10-0${i + 1}`, amountCents: -100 * (i + 1) }))
    const txns = [...rows('n1', ['PIX MERCADO', 'Padaria 12', 'Loja']), ...rows('p1', ['Pix mercado', 'PADARIA', 'Outra'])]
    expect(duplicateAccountWarning([nu, pl], txns)).toEqual(['"Minha Nu" (extrato) e "NuConta ···77" (Pluggy) podem ser a mesma conta, contada em dobro'])
    expect(duplicateAccountWarning([nu, pl], [...rows('n1', ['A', 'B', 'C']), ...rows('p1', ['A', 'X', 'Y'])])).toEqual([])
  })
})

describe('cumulativeByDay', () => {
  it('um valor por dia do mês, crescente, sem pagamento de fatura', () => {
    const c = cumulativeByDay([
      txn({ description: 'a', date: '2026-09-02', amountCents: -500 }),
      txn({ description: 'Pag Fatura', date: '2026-09-03', amountCents: -90000 }),
      txn({ description: 'b', date: '2026-09-03', amountCents: -1000 }),
      txn({ description: 'entrada', date: '2026-09-04', amountCents: 5000 }),
    ], catOf, '2026-09')
    expect(c).toHaveLength(30)
    expect(c.slice(0, 4)).toEqual([0, 500, 1500, 1500])
    expect(c[29]).toBe(1500)
    expect(c.every((v, i) => i === 0 || v >= c[i - 1])).toBe(true)
  })
})

it('spentByMonth devolve n meses em ordem, com zero quando não houve gasto', () => {
  const r = spentByMonth([
    txn({ description: 'a', date: '2026-08-05', amountCents: -500 }),
    txn({ description: 'b', date: '2026-10-05', amountCents: -700 }),
    txn({ description: 'Pag Fatura', date: '2026-10-06', amountCents: -9000 }),
  ], catOf, '2026-10', 4)
  expect(r).toEqual([{ month: '2026-07', cents: 0 }, { month: '2026-08', cents: 500 }, { month: '2026-09', cents: 0 }, { month: '2026-10', cents: 700 }])
})

it('topSpending ordena pelo maior gasto do mês', () => {
  const r = topSpending([
    txn({ description: 'pequeno', amountCents: -100 }),
    txn({ description: 'grande', amountCents: -9000 }),
    txn({ description: 'Pag Fatura', amountCents: -99000 }),
    txn({ description: 'medio', amountCents: -500 }),
    txn({ description: 'fora', date: '2026-09-01', amountCents: -99999 }),
  ], catOf, '2026-10', 2)
  expect(r.map(t => t.description)).toEqual(['grande', 'medio'])
})

describe('comparePreviousMonth', () => {
  const txns = [
    txn({ description: 'a', date: '2026-10-05', amountCents: -1000 }),
    txn({ description: 'b', date: '2026-10-20', amountCents: -2000 }),
    txn({ description: 'c', date: '2026-09-04', amountCents: -300 }),
    txn({ description: 'd', date: '2026-09-15', amountCents: -400 }),
  ]
  it('compara até o mesmo dia do mês anterior', () => {
    expect(comparePreviousMonth(txns, catOf, '2026-10', '2026-10-10')).toEqual({ currentCents: 1000, previousSameDayCents: 300, day: 10 })
  })
  it('no dia 31 com mês anterior de 30 dias usa o mês anterior inteiro', () => {
    expect(comparePreviousMonth([...txns, txn({ description: 'e', date: '2026-09-30', amountCents: -50 })], catOf, '2026-10', '2026-10-31'))
      .toEqual({ currentCents: 3000, previousSameDayCents: 750, day: 31 })
  })
  it('mês passado compara o mês inteiro', () => {
    expect(comparePreviousMonth(txns, catOf, '2026-09', '2026-10-10').day).toBe(30)
  })
})

describe('categoryBars', () => {
  it('mostra as maiores, junta o resto em Outras (n) e põe Sem categoria no fim', () => {
    const by = [
      { category: cat('a'), cents: 900 }, { category: null, cents: 800 }, { category: cat('b'), cents: 500 },
      { category: cat('c'), cents: 300 }, { category: cat('d'), cents: 100 },
    ]
    expect(categoryBars(by, 2).map(r => [r.label, r.cents, r.categoryId])).toEqual([
      ['a', 900, 'a'], ['b', 500, 'b'], ['Outras (2)', 400, null], ['Sem categoria', 800, 'sem'],
    ])
    expect(categoryBars(by.slice(0, 3), 2).map(r => r.label)).toEqual(['a', 'b', 'Sem categoria'])
  })
})

it('ruleFor devolve a regra que categorizou, nunca quando há escolha manual', () => {
  const rules = [{ id: '1', pattern: 'uber', categoryId: 'transporte' }, { id: '2', pattern: 'uber eats', categoryId: 'alimentacao' }]
  const t = txn({ description: 'UBER EATS 123' })
  expect(ruleFor(t, rules, {})?.pattern).toBe('uber eats')
  expect(ruleFor(t, rules, { [t.fingerprint]: 'mercado' })).toBeNull()
  expect(ruleFor(txn({ description: 'Padaria' }), rules, {})).toBeNull()
})

describe('needsSync', () => {
  const now = Date.parse('2026-10-26T12:00:00Z')
  const pluggy: Account = { ...conta, id: 'p1', source: 'pluggy', externalId: 'pluggy:1', itemId: 'it1', lastSyncAt: '2026-10-26T10:00:00Z' }
  const g = (o: Partial<GastosData>): GastosData => ({ accounts: [pluggy], txns: [], categories: [], rules: [], overrides: {}, dismissed: [], pluggyItems: [{ itemId: 'it1', label: 'Banco' }], ownerNames: [], ruleSuggestionsDismissed: [], ...o })
  it('não sincroniza sem item salvo nem com tudo recente', () => {
    expect(needsSync(g({ pluggyItems: [] }), now)).toBe(false)
    expect(needsSync(g({}), now)).toBe(false)
  })
  it('sincroniza com conta velha, nunca sincronizada ou item sem conta', () => {
    expect(needsSync(g({ accounts: [{ ...pluggy, lastSyncAt: '2026-10-26T05:00:00Z' }] }), now)).toBe(true)
    expect(needsSync(g({ accounts: [{ ...pluggy, lastSyncAt: null }] }), now)).toBe(true)
    expect(needsSync(g({ pluggyItems: [{ itemId: 'it1', label: 'Banco' }, { itemId: 'it2', label: 'Outro' }] }), now)).toBe(true)
  })
  it('ignora contas de item removido', () => {
    const old: Account = { ...pluggy, id: 'p2', externalId: 'pluggy:2', itemId: 'removido', lastSyncAt: null }
    expect(needsSync(g({ accounts: [pluggy, old] }), now)).toBe(false)
  })
})

describe('cleanDescription', () => {
  it('separa o tipo de operação do nome, antes do |', () => {
    expect(cleanDescription('Transferência enviada pelo Pix|PADARIA SOL NASCENTE LTDA')).toEqual({ name: 'Padaria Sol Nascente', via: 'Pix enviado' })
    expect(cleanDescription('Compra no débito via NuPay|Loja Azul')).toEqual({ name: 'Loja Azul', via: 'Débito via NuPay' })
    expect(cleanDescription('Tipo Novo Qualquer|Ana Teste')).toEqual({ name: 'Ana Teste', via: 'Tipo Novo Qualquer' })
    expect(cleanDescription('Cashback da Carteira |')).toEqual({ name: 'Cashback da Carteira', via: null })
  })
  it('caixa alta vira título; texto misto fica como veio, sem o sufixo da empresa', () => {
    expect(cleanDescription('SUPERMERCADO DO BAIRRO E CIA')).toEqual({ name: 'Supermercado do Bairro e Cia', via: null })
    expect(cleanDescription('Loja Bonita Comercio De Roupas S/a').name).toBe('Loja Bonita Comercio De Roupas')
    expect(cleanDescription('LOJA DE ESPORTES S A').name).toBe('Loja de Esportes')
    expect(cleanDescription('Pix recebido de Ana Teste').name).toBe('Pix recebido de Ana Teste')
  })
  it('descritor de cartão: tira o código curto e a repetição', () => {
    expect(cleanDescription('XY*TAXIRAPIDO').name).toBe('Taxirapido')
    expect(cleanDescription('LOJAX*LOJAX').name).toBe('Lojax')
    expect(cleanDescription('PG*AB').name).toBe('Ab')
    expect(cleanDescription('Lojinha *Casa Azul 7/9').name).toBe('Lojinha Casa Azul 7/9')
    expect(cleanDescription('TAXA RFB/*-123 - DOC').name).toBe('Taxa Rfb/*-123 - Doc')
  })
})

describe('shortAccountLabel', () => {
  const a = (o: Partial<Account>): Account => ({ ...conta, number: null, ...o })
  it('nome longo ou que não cita o banco vira o nome do banco; cartão ganha o prefixo', () => {
    expect(shortAccountLabel(a({ institution: 'Banco Laranja', name: 'Banco Laranja S.A. - Instituição de Pagamento (Conta)', number: '0001-1234' }))).toBe('Banco Laranja ···1234')
    expect(shortAccountLabel(a({ institution: 'Banco Laranja', name: 'gold', kind: 'cartao' }))).toBe('Cartão Banco Laranja')
    expect(shortAccountLabel(a({ institution: 'Laranja', name: 'Laranja Investimentos' }))).toBe('Laranja Investimentos')
    expect(shortAccountLabel(a({ institution: 'Laranja', name: 'Cartão Laranja Black', kind: 'cartao' }))).toBe('Cartão Laranja Black')
    expect(shortAccountLabel(undefined)).toBe('—')
  })
})

describe('categoryStrip', () => {
  it('sem categoria primeiro, depois gasto por valor; o que não é gasto vai no fim', () => {
    const receita = { ...cat('receita', false), name: 'Receita' }
    const by: Record<string, Category> = { m1: mercado, m2: mercado, f: fatura, r: receita }
    const strip = categoryStrip([
      txn({ description: 'm1', amountCents: -3000 }), txn({ description: 'm2', amountCents: 500 }),
      txn({ description: 'x', amountCents: -200 }), txn({ description: 'y', amountCents: 900 }),
      txn({ description: 'f', amountCents: -90000 }), txn({ description: 'r', amountCents: 100000 }),
      txn({ description: 'm1', amountCents: -7000, date: '2026-09-01' }),
    ], t => by[t.description] ?? null, '2026-10')
    expect(strip).toEqual([
      { id: 'sem', name: 'Sem categoria', cents: 200, count: 1, spending: true },
      { id: 'mercado', name: 'mercado', cents: 3000, count: 2, spending: true },
      { id: 'receita', name: 'Receita', cents: 100000, count: 1, spending: false },
      { id: 'pagamento-de-fatura', name: 'pagamento-de-fatura', cents: 90000, count: 1, spending: false },
    ])
  })
})
