import { describe, expect, it } from 'vitest'
import type { Broker, Issuer } from '../db/irRepo'
import type { TaxMonth } from './tax'
import type { CorporateEvent, DarfPayment, Dividend, Trade } from './types'
import type { RfMove, RfPosition } from '../db/rendaFixaRepo'
import { normalizeBroker } from '../import/parse'
import { BEM_CODES, bensDoAno, discriminacao, discriminacaoRf, lucroIsentoDoAno, pendencias, RF_CODES, rendaFixaDoAno, rendaVariavelDoAno, rendimentosDoAno, rendimentosRfDoAno } from './declaracao'

let seq = 0
const tr = (ticker: string, side: 'C' | 'V', qty: number, priceCents: number, tradeDate: string, o: Partial<Trade> = {}): Trade =>
  ({ id: `t${++seq}`, noteId: `n${seq}`, seq: 1, broker: 'ALFA', tradeDate, settleDate: tradeDate, side, assetType: 'Ação', ticker, qty, priceCents, feesCents: 0, irrfCents: 0, ...o })
const A = '11.222.333/0001-81'

describe('bensDoAno', () => {
  it('entra quem tinha posição em qualquer dos 31/12; vendido no ano fica zerado; ordem por custo', () => {
    const bens = bensDoAno([
      tr('AAAA3', 'C', 100, 1000, '2024-05-10'), tr('AAAA3', 'C', 100, 2000, '2025-03-10'),
      tr('BBBB11', 'C', 10, 10000, '2024-02-01', { assetType: 'FII' }), tr('BBBB11', 'V', 10, 11000, '2025-06-01', { assetType: 'FII' }),
      tr('CCCC3', 'C', 5, 1000, '2023-01-01'), tr('CCCC3', 'V', 5, 1000, '2023-06-01'),
    ], [], 2025)
    expect(bens.map(b => [b.ticker, b.qtyPrev, b.costPrevCents, b.qty, b.costCents])).toEqual([['AAAA3', 100, 100000, 200, 300000], ['BBBB11', 10, 100000, 0, 0]])
  })
  it('compra em 30/12 que liquida em janeiro fica para o ano seguinte (data de liquidação)', () => {
    const [b] = bensDoAno([tr('AAAA3', 'C', 10, 1000, '2024-01-10'), tr('AAAA3', 'C', 10, 1000, '2025-12-30', { settleDate: '2026-01-02' })], [], 2025)
    expect(b.qty).toBe(10)
  })
  it('mudança de ticker vira uma linha só, com o antigo no "era"', () => {
    const ev: CorporateEvent[] = [{ id: 'e1', kind: 'mudanca_ticker', ticker: 'VELH3', newTicker: 'NOVA3', date: '2025-04-01' }]
    const bens = bensDoAno([tr('VELH3', 'C', 50, 1000, '2024-03-01', { broker: 'BETA' })], ev, 2025)
    expect(bens.map(b => [b.ticker, b.oldTickers, b.qtyPrev, b.qty, b.costCents, b.brokers])).toEqual([['NOVA3', ['VELH3'], 50, 50, 50000, ['BETA']]])
  })
  it('desdobramento entra no saldo de cada corretora na proporção', () => {
    const ev: CorporateEvent[] = [{ id: 'e1', kind: 'desdobramento', ticker: 'AAAA3', date: '2025-03-01', qtyDelta: 900 }]
    const bens = bensDoAno([tr('AAAA3', 'C', 100, 1000, '2025-01-10', { broker: 'ALFA' }), tr('AAAA3', 'C', 10, 100, '2025-04-01', { broker: 'BETA' }), tr('AAAA3', 'V', 10, 100, '2025-04-02', { broker: 'BETA' }),
      tr('AAAA3', 'V', 500, 100, '2025-05-10', { broker: 'ALFA' })], ev, 2025)
    expect(bens.map(b => [b.qty, b.brokers])).toEqual([[500, ['ALFA']]])
  })
  it('corretoras pelo saldo de cada uma; sem saldo, as que negociaram', () => {
    const bens = bensDoAno([
      tr('AAAA3', 'C', 10, 1000, '2025-01-10', { broker: 'ALFA' }), tr('AAAA3', 'C', 10, 1000, '2025-01-11', { broker: 'BETA' }), tr('AAAA3', 'V', 10, 1000, '2025-02-11', { broker: 'BETA' }),
      tr('BBBB3', 'C', 10, 1000, '2024-01-10', { broker: 'GAMA' }), tr('BBBB3', 'V', 10, 1000, '2025-02-11', { broker: 'GAMA' }),
    ], [], 2025)
    expect(bens.map(b => [b.ticker, b.brokers])).toEqual([['AAAA3', ['ALFA']], ['BBBB3', ['GAMA']]])
  })
})

describe('discriminacao', () => {
  const issuer: Issuer = { ticker: 'AAAA3', name: 'EMPRESA EXEMPLO S.A.', cnpj: A }
  const brokers = new Map<string, Broker>([['ALFA', { code: 'ALFA', name: 'CORRETORA ALFA S.A.', cnpj: A }]])
  const bem = { ticker: 'AAAA3', oldTickers: [], assetType: 'Ação' as const, qtyPrev: 100, costPrevCents: 100000, qty: 200, costCents: 300000, brokers: ['ALFA'] }
  it('ação com uma corretora', () => {
    expect(discriminacao(bem, 2025, issuer, brokers)).toBe(`200 Ações de EMPRESA EXEMPLO S.A. ao custo de R$ 15,0000 cada - Ticker: AAAA3 - Custodiadas na corretora: CORRETORA ALFA S.A. - CNPJ: ${A}`)
  })
  it('cotas em duas corretoras, uma sem cadastro', () => {
    expect(discriminacao({ ...bem, assetType: 'FII', ticker: 'BBBB11', qty: 3, costCents: 30000, brokers: ['ALFA', 'BETA'] }, 2025, undefined, brokers))
      .toBe(`3 Cotas de [razão social não cadastrada] ao custo de R$ 100,0000 cada - Ticker: BBBB11 - Custodiadas nas corretoras: CORRETORA ALFA S.A. - CNPJ: ${A} e BETA - CNPJ: [CNPJ não cadastrado]`)
  })
  it('zerada no ano', () => {
    expect(discriminacao({ ...bem, qty: 0, costCents: 0 }, 2025, issuer, brokers)).toBe('Posição zerada em 31/12/2025. Em 31/12/2024: 100 Ações de EMPRESA EXEMPLO S.A. - Ticker: AAAA3')
  })
  it('códigos da Receita por classe', () => {
    expect([BEM_CODES['Ação'].grupo, BEM_CODES['Ação'].codigo, BEM_CODES.FII.codigo, BEM_CODES.ETF.codigo, BEM_CODES.BDR.grupo]).toEqual(['03', '01', '03', '09', '04'])
  })
})

describe('rendimentos e renda variável', () => {
  const dv = (ticker: string, kind: Dividend['kind'], payDate: string, amountCents: number): Dividend => ({ id: `${ticker}${payDate}${kind}`, ticker, kind, payDate, amountCents, broker: null, source: 'b3', sourceKey: null })
  it('agrupa por CNPJ da pagadora e mapeia 09/26/10; sem CNPJ agrupa pelo ticker', () => {
    const issuers = new Map<string, Issuer>([['AAAA3', { ticker: 'AAAA3', name: 'EMPRESA EXEMPLO', cnpj: A }], ['AAAA4', { ticker: 'AAAA4', name: 'EMPRESA EXEMPLO', cnpj: A }]])
    const r = rendimentosDoAno([dv('AAAA3', 'Dividendo', '2025-03-01', 1000), dv('AAAA4', 'Dividendo', '2025-04-01', 500), dv('AAAA3', 'JCP', '2025-05-01', 300),
      dv('BBBB11', 'Rendimento', '2025-06-01', 700), dv('AAAA3', 'Dividendo', '2024-12-31', 9999)], 2025, issuers, () => 'Ação')
    expect(r).toEqual([
      { linha: '09', payerKey: A, name: 'EMPRESA EXEMPLO', cnpj: A, tickers: ['AAAA3', 'AAAA4'], cents: 1500 },
      { linha: '26', payerKey: 'BBBB11', name: null, cnpj: null, tickers: ['BBBB11'], cents: 700 },
      { linha: '10', payerKey: A, name: 'EMPRESA EXEMPLO', cnpj: A, tickers: ['AAAA3'], cents: 300 },
    ])
  })
  const pot = (o: Partial<TaxMonth['comum']> = {}): TaxMonth['comum'] => ({ resultCents: 0, exemptProfitCents: 0, lossInCents: 0, baseCents: 0, taxDueCents: 0, irrfMonthCents: 0, irrfUsedCents: 0, irrfCarryOutCents: 0, lossOutCents: 0, taxPayableCents: 0, ...o })
  const tm = (month: string, stockSalesCents: number, comum: Partial<TaxMonth['comum']>, fii: Partial<TaxMonth['comum']> = {}): TaxMonth => ({ month, stockSalesCents, comum: pot(comum), fii: pot(fii), incomplete: false })
  const tax = [tm('2025-01', 0, {}), tm('2025-03', 500000, { resultCents: 182000, taxPayableCents: 27209, irrfMonthCents: 91 }), tm('2025-06', 100000, { resultCents: -64000, exemptProfitCents: 3000 }), tm('2025-07', 0, {}, { resultCents: 5000, taxPayableCents: 1000 }), tm('2024-12', 100, { exemptProfitCents: 999 })]
  it('dividendo de BDR é renda do exterior: sai dos isentos e vai num grupo tributável próprio', () => {
    const r = rendimentosDoAno([dv('FFFF39', 'Dividendo', '2025-03-01', 800), dv('AAAA3', 'Dividendo', '2025-03-01', 1000)], 2025, new Map(), t => (t === 'FFFF39' ? 'BDR' : 'Ação'))
    expect(r.map(x => [x.linha, x.payerKey, x.cents])).toEqual([['09', 'AAAA3', 1000], ['bdr', 'FFFF39', 800]])
  })
  it('lucro isento soma só o ano', () => expect(lucroIsentoDoAno(tax, 2025)).toBe(3000))
  it('só meses com operação; DARF pago pelo mês de competência', () => {
    const pay: DarfPayment[] = [{ month: '2025-03', paidAt: '2025-04-30', principalCents: 27209, totalPaidCents: 27209 }, { month: '2025-07', paidAt: '2026-01-10', principalCents: 1000, totalPaidCents: 1100 }]
    const r = rendaVariavelDoAno(tax, pay, 2025)
    expect(r.comum.map(l => [l.month, l.resultCents, l.taxPayableCents, l.darfPaidCents])).toEqual([['2025-03', 182000, 27209, 27209], ['2025-06', -64000, 0, 0]])
    expect(r.fii.map(l => [l.month, l.resultCents, l.darfPaidCents])).toEqual([['2025-07', 5000, 1000]])
  })
  it('pendências: tickers sem cadastro (bens e rendimentos) e corretoras sem cadastro', () => {
    const bens = bensDoAno([tr('AAAA3', 'C', 1, 100, '2025-01-01', { broker: 'ALFA' })], [], 2025)
    const rend = rendimentosDoAno([dv('BBBB11', 'Rendimento', '2025-06-01', 700)], 2025, new Map(), () => 'FII')
    expect(pendencias(bens, rend, new Map(), new Map())).toEqual({ tickers: ['AAAA3', 'BBBB11'], brokers: ['ALFA'] })
  })
})

describe('renda fixa da B3', () => {
  let k = 0
  const INST = 'CORRETORA TESTE S/A'
  const TD = 'Tesouro IPCA+ 2035', CDB = 'CDB - CDB0000AA00 - BANCO LARANJA S/A', LCI = 'LCI - LCI0000BB00 - BANCO LARANJA S/A'
  const mv = (product: string, kind: RfMove['kind'], date: string, qty: number, valueCents: number | null): RfMove =>
    ({ id: String(++k), key: product.startsWith('Tesouro') ? `td:${product.toLowerCase()}` : `rf:${product.split(' - ')[1]}`, product, date, kind, qty, valueCents, sourceKey: `b3rf:${date}:Mov:${product}:${INST}:${qty}:${valueCents}` })
  const moves = [
    mv(TD, 'aplicacao', '2024-03-01', 2, 600000), mv(TD, 'aplicacao', '2025-02-01', 1, 320000), mv(TD, 'saida', '2025-08-01', 1, 330000), mv(TD, 'juros', '2025-07-15', 3, 9000),
    mv(CDB, 'aplicacao', '2025-04-01', 1, 100000), mv(CDB, 'juros', '2025-10-01', 1, 4000),
    mv(LCI, 'aplicacao', '2024-06-01', 1, 50000), mv(LCI, 'saida', '2025-06-01', 1, 55000), mv(LCI, 'juros', '2025-06-01', 1, 5000),
    mv(CDB, 'aplicacao', '2026-01-10', 1, 100000),
  ]
  it('aplicado em aberto em cada 31/12 por título, com grupo/código pelo tipo', () => {
    const r = rendaFixaDoAno(moves, [], 2025)
    expect(r.map(b => [b.name, b.tipo, b.appliedPrevCents, b.appliedCents, b.qty])).toEqual([
      ['Tesouro IPCA+ 2035', 'tributavel', 600000, 613333, 2],
      ['CDB BANCO LARANJA S/A', 'tributavel', 0, 100000, 1],
      ['LCI BANCO LARANJA S/A', 'isento', 50000, 0, 0],
    ])
    expect(r[0].institutions).toEqual([INST])
    expect([RF_CODES.tributavel.grupo, RF_CODES.tributavel.codigo, RF_CODES.isento.codigo]).toEqual(['04', '02', '03'])
  })
  it('saída sem a compra no período marca o título como parcial', () => {
    const [b] = rendaFixaDoAno([mv(CDB, 'saida', '2025-03-01', 1, 1000)], [], 2025)
    expect(b.partial).toBe(true)
  })
  it('nome e emissor da Posição quando houver', () => {
    const p: RfPosition = { key: 'rf:CDB0000AA00', family: 'rf', product: 'CDB - BANCO LARANJA S/A', issuer: 'BANCO LARANJA S/A', indexer: 'CDI', maturity: null, qty: 1, appliedCents: null, valueCents: 1, asOf: '2026-10-01' }
    expect(rendaFixaDoAno(moves, [p], 2025).find(b => b.key === p.key)?.name).toBe('CDB BANCO LARANJA S/A')
  })
  it('discriminação com a custódia na B3 e o CNPJ da corretora cadastrada', () => {
    const [td, , lci] = rendaFixaDoAno(moves, [], 2025)
    const brokers = new Map([[normalizeBroker(INST), { code: normalizeBroker(INST), name: 'CORRETORA TESTE S/A', cnpj: A }]])
    expect(discriminacaoRf(td, 2025, brokers)).toBe(`Tesouro IPCA+ 2035 - Quantidade: 2 - custodiado na B3 via CORRETORA TESTE S/A - CNPJ: ${A}, valor aplicado`)
    expect(discriminacaoRf(lci, 2025, new Map())).toBe('Resgatado ou vendido em 2025. Em 31/12/2024: LCI BANCO LARANJA S/A - Quantidade: 1 - custodiado na B3 via CORRETORA TESTE S/A - CNPJ: [CNPJ não cadastrado], valor aplicado')
  })
  it('juros do ano por fonte: tributáveis na 06 da exclusiva, LCI/LCA na 12 dos isentos', () => {
    expect(rendimentosRfDoAno(moves, [], 2025).map(r => [r.linha, r.name, r.cnpj, r.cents])).toEqual([
      ['06', 'Tesouro Direto', null, 9000], ['06', 'BANCO LARANJA S/A', null, 4000], ['12', 'BANCO LARANJA S/A', null, 5000],
    ])
  })
})
