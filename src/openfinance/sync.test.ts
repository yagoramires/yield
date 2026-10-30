import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadGastos, savePluggyItem, setLastSync, setOverride } from '../db/gastosRepo'
import { loadAll, saveNote } from '../db/repo'
import { createTestDb } from '../db/testDb'
import type { PluggyInvestment } from './pluggy'
import { syncPluggy } from './sync'

const fx = (n: string) => JSON.parse(readFileSync(new URL(`../../tests/fixtures/pluggy/${n}.json`, import.meta.url), 'utf8'))
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const creds = { clientId: 'cid', clientSecret: 'sec' }
const ITEM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BANK = '11111111-1111-4111-8111-111111111111'
const CARD = '22222222-2222-4222-8222-222222222222'

function fake(over: (url: URL) => Response | null = () => null) {
  const calls: { method: string; url: string }[] = []
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ method: init?.method ?? 'GET', url: String(input) })
    const o = over(url)
    if (o) return o
    if (url.pathname === '/auth') return json({ apiKey: 'K' })
    if (url.pathname === '/accounts') return json(fx('accounts'))
    if (url.pathname.startsWith('/investments')) return json({ page: 1, total: 0, totalPages: 0, results: [] })
    return json(url.searchParams.get('accountId') === BANK ? fx('transactions-banco') : fx('transactions-cartao'))
  }) as typeof fetch
  return { fn, calls }
}
async function setup() {
  const db = createTestDb()
  await savePluggyItem(db, ITEM, 'Banco Exemplo')
  return db
}
const today = '2026-10-26'

describe('syncPluggy', () => {
  it('grava contas e transações; só POST /auth e GETs; 1ª janela = 365 dias', async () => {
    const db = await setup(); const f = fake()
    const r = await syncPluggy(db, creds, f.fn, today)
    expect(r).toMatchObject({ accounts: 2, inserted: 3, errors: [] })
    expect(f.calls.every(c => (c.method === 'POST' && c.url.endsWith('/auth')) || (c.method === 'GET' && /\/accounts\?itemId=|\/v2\/transactions\?|\/investments\?itemId=/.test(c.url)))).toBe(true)
    expect(f.calls.find(c => c.url.includes('/v2/'))!.url).toContain('dateFrom=2025-10-26&dateTo=2026-11-26')
    const g = await loadGastos(db)
    expect(g.accounts.map(a => [a.externalId, a.kind, a.name, a.institution]).sort()).toEqual([
      [`pluggy:${BANK}`, 'conta', 'Conta Exemplo', 'Banco Exemplo'], [`pluggy:${CARD}`, 'cartao', 'Cartão Exemplo', 'Banco Exemplo']])
    expect(g.accounts.every(a => a.lastSyncAt)).toBe(true)
    // saldo vem da Pluggy em reais; conta sem saldo informado fica sem
    expect(g.accounts.map(a => [a.kind, a.balanceCents]).sort()).toEqual([['cartao', null], ['conta', 123456]])
    expect(g.txns.find(t => t.description === 'Salario Ficticio')).toMatchObject({ date: '2026-10-05', pending: true, amountCents: 500000 })
    expect(g.txns.find(t => t.description === 'Loja Inventada')).toMatchObject({ amountCents: -7500, installment: '2/3' })
    expect(await syncPluggy(db, creds, fake().fn, today)).toMatchObject({ accounts: 2, inserted: 0, removed: 0, errors: [] })
  })

  it('2ª sincronização não duplica e usa lastSyncAt − 35 dias, nunca além de hoje − 365', async () => {
    const db = await setup()
    await syncPluggy(db, creds, fake().fn, today, () => new Date('2026-09-01T12:00:00.000Z'))
    const before = (await loadGastos(db)).txns.length
    const f = fake()
    await syncPluggy(db, creds, f.fn, today)
    expect((await loadGastos(db)).txns).toHaveLength(before)
    expect(f.calls.find(c => c.url.includes('/v2/'))!.url).toContain('dateFrom=2026-07-28')
    for (const a of (await loadGastos(db)).accounts) await setLastSync(db, a.id, '2024-01-01T00:00:00.000Z')
    const g = fake()
    await syncPluggy(db, creds, g.fn, today)
    expect(g.calls.find(c => c.url.includes('/v2/'))!.url).toContain('dateFrom=2025-10-26')
  })

  it('compra de cartão reemitida com outro id continua uma linha e mantém o ajuste', async () => {
    const db = await setup()
    await syncPluggy(db, creds, fake().fn, today)
    const g = await loadGastos(db)
    const cat = g.categories[0].id
    const t = g.txns.find(x => x.description === 'Loja Inventada')!
    await setOverride(db, t.fingerprint, cat)
    const re = fx('transactions-cartao'); re.results[0].id = 'c-NOVO'
    await syncPluggy(db, creds, fake(u => u.pathname === '/v2/transactions' && u.searchParams.get('accountId') === CARD ? json(re) : null).fn, today)
    const g2 = await loadGastos(db)
    const rows = g2.txns.filter(x => x.description === 'Loja Inventada')
    expect(rows).toHaveLength(1)
    expect(rows[0].sourceKey).toBe('pluggy:' + rows[0].fingerprint)
    expect(g2.overrides[rows[0].fingerprint]).toBe(cat)
  })

  it('401 vira erro de credenciais e os dados salvos ficam', async () => {
    const db = await setup()
    await syncPluggy(db, creds, fake().fn, today)
    const before = (await loadGastos(db)).txns.length
    const r = await syncPluggy(db, creds, fake(u => u.pathname === '/auth' ? json({}, 401) : null).fn, today)
    expect(r.errors[0]).toMatchObject({ itemId: ITEM, label: 'Banco Exemplo', message: 'Client ID ou Client Secret inválidos' })
    expect((await loadGastos(db)).txns).toHaveLength(before)
  })

  it('item 404 aparece em errors e o outro sincroniza; erro no meio do item não grava nada dele', async () => {
    const db = await setup()
    await savePluggyItem(db, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Item Ruim')
    const r = await syncPluggy(db, creds, fake(u => u.pathname === '/accounts' && u.searchParams.get('itemId')!.startsWith('bbbb') ? json({}, 404) : null).fn, today)
    expect(r.accounts).toBe(2)
    expect(r.errors).toEqual([{ itemId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', label: 'Item Ruim', message: 'Item bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb não encontrado: confira o itemId' }])
    const db2 = await setup()
    const r2 = await syncPluggy(db2, creds, fake(u => u.pathname === '/v2/transactions' && u.searchParams.get('accountId') === CARD ? json({}, 500) : null).fn, today)
    expect(r2.errors).toHaveLength(1)
    expect((await loadGastos(db2)).txns).toHaveLength(0)
  })

  it('resposta fora do formato e `next` repetido viram erro resposta sem tocar nos dados', async () => {
    const db = await setup()
    await syncPluggy(db, creds, fake().fn, today)
    const before = (await loadGastos(db)).txns
    const bad = fx('transactions-cartao'); delete bad.results[0].description
    const r = await syncPluggy(db, creds, fake(u => u.pathname === '/v2/transactions' && u.searchParams.get('accountId') === CARD ? json(bad) : null).fn, today)
    expect(r.errors[0].message).toBe('A Pluggy devolveu dados fora do formato esperado')
    const loop = fx('transactions-banco'); loop.next = '?accountId=x&after=1'
    const r2 = await syncPluggy(db, creds, fake(u => u.pathname === '/v2/transactions' ? json(loop) : null).fn, today)
    expect(r2.errors[0].message).toBe('A Pluggy devolveu dados fora do formato esperado')
    expect((await loadGastos(db)).txns).toEqual(before)
  })
})

const INV = { acao: '33333333-3333-4333-8333-333333333331', fii: '33333333-3333-4333-8333-333333333332', opcao: '33333333-3333-4333-8333-333333333333', cdb: '33333333-3333-4333-8333-333333333334', semTipo: '33333333-3333-4333-8333-333333333335' }
const page = (results: unknown[]) => json({ page: 1, total: results.length, totalPages: 1, results })
const op = (id: string, type: string, tradeDate: string, quantity: number, value: number, expenses: Record<string, number | null> = {}) =>
  ({ id, type, movementType: type === 'BUY' ? 'DEBIT' : 'CREDIT', quantity, value, amount: quantity * value, tradeDate: `${tradeDate}T00:00:00.000Z`, date: `${tradeDate}T00:00:00.000Z`, expenses })
const INVESTMENTS: PluggyInvestment[] = [
  { id: INV.acao, code: 'AAAA3', name: 'AAAA3 ON NM', type: 'EQUITY', subtype: 'STOCK' },
  { id: INV.fii, code: null, name: 'FIIA11 Fundo Imobiliário Exemplo', type: 'EQUITY', subtype: 'REAL_ESTATE_FUND' },
  { id: INV.opcao, code: 'AAAAC150', name: 'Opção AAAA', type: 'EQUITY', subtype: 'OPTION' },
  { id: INV.cdb, code: null, name: 'CDB Banco Exemplo', type: 'FIXED_INCOME', subtype: 'CDB' },
]
const OPS: Record<string, unknown[]> = {
  [INV.acao]: [
    op('t1', 'BUY', '2026-03-10', 100, 12.34, { brokerageFee: 4.9, settlementFee: 0.31, stockExchangeFee: 0.06, incomeTax: null }),
    op('t2', 'SELL', '2026-04-07', 50, 13, { brokerageFee: 4.9, incomeTax: 0.03 }),
    op('t3', 'TAX', '2026-04-07', 1, 0.5),
  ],
  [INV.fii]: [op('t4', 'BUY', '2026-03-10', 10, 100, { settlementFee: 0.25, stockExchangeFee: 0.05 })],
}
function invFake(over: (url: URL) => Response | null = () => null, investments = INVESTMENTS, ops = OPS) {
  return fake(u => {
    const o = over(u)
    if (o) return o
    if (u.pathname === '/investments') return page(investments)
    const m = /^\/investments\/([^/]+)\/transactions$/.exec(u.pathname)
    return m ? page(ops[m[1]] ?? []) : null
  })
}
async function broker() {
  const db = createTestDb()
  await savePluggyItem(db, ITEM, 'Corretora Azul')
  return db
}
const tradesOf = async (db: ReturnType<typeof createTestDb>) => {
  const d = await loadAll(db)
  return d.trades.map(t => ({ ...t, note: d.notes.find(n => n.id === t.noteId)! }))
}

describe('syncPluggy — renda variável', () => {
  it('compras e vendas viram notas da Pluggy por dia; opção e renda fixa ficam de fora; 2ª vez não muda nada', async () => {
    const db = await broker(); const f = invFake()
    const r = await syncPluggy(db, creds, f.fn, today)
    expect(r.errors).toEqual([])
    expect(r.investments).toEqual([{ itemId: ITEM, label: 'Corretora Azul', found: 2, inserted: 3, updated: 0, existing: 0 }])
    expect(f.calls.every(c => (c.method === 'POST' && c.url.endsWith('/auth')) || c.method === 'GET')).toBe(true)
    expect(f.calls.some(c => c.url.includes(INV.opcao) || c.url.includes(INV.cdb))).toBe(false)
    const d = await loadAll(db)
    expect(d.notes).toEqual([
      { id: expect.any(String), number: 'Pluggy 2026-03-10', broker: 'AZUL', tradeDate: '2026-03-10', settleDate: '2026-03-12', source: 'sem_nota', sourceKey: 'pluggy:2026-03-10:AZUL', label: 'Pluggy (sem nota)' },
      { id: expect.any(String), number: 'Pluggy 2026-04-07', broker: 'AZUL', tradeDate: '2026-04-07', settleDate: '2026-04-09', source: 'sem_nota', sourceKey: 'pluggy:2026-04-07:AZUL', label: 'Pluggy (sem nota)' },
    ])
    expect(d.trades.map(t => [t.tradeDate, t.seq, t.side, t.assetType, t.ticker, t.qty, t.priceCents, t.feesCents, t.irrfCents])).toEqual([
      ['2026-03-10', 1, 'C', 'Ação', 'AAAA3', 100, 1234, 527, 0],
      ['2026-03-10', 2, 'C', 'FII', 'FIIA11', 10, 10000, 30, 0],
      ['2026-04-07', 1, 'V', 'Ação', 'AAAA3', 50, 1300, 490, 3],
    ])
    const again = await syncPluggy(db, creds, invFake().fn, today)
    expect(again.investments).toEqual([{ itemId: ITEM, label: 'Corretora Azul', found: 2, inserted: 0, updated: 0, existing: 3 }])
    expect(await loadAll(db)).toEqual(d)
  })

  it('nota em PDF fica como está; operação da B3 ganha as taxas; nova entra na nota da Pluggy do dia', async () => {
    const db = await broker()
    const t = (ticker: string, qty: number, side: 'C' | 'V', feesCents: number, assetType: 'Ação' | 'FII' | 'ETF' = 'Ação') => ({ seq: 1, side, assetType, ticker, qty, priceCents: 999, feesCents, irrfCents: 0 })
    await saveNote(db, { number: '55', broker: 'AZUL', tradeDate: '2026-03-10', settleDate: '2026-03-12', source: 'pdf', sourceKey: 'pdf:AZUL:55', label: null }, [t('AAAA3', 100, 'C', 777)])
    await saveNote(db, { number: 'B3 2026-03-10', broker: 'AZUL', tradeDate: '2026-03-10', settleDate: '2026-03-12', source: 'sem_nota', sourceKey: 'b3neg:2026-03-10:AZUL', label: 'Negociação da B3 (sem taxas)' }, [t('FIIA11', 10, 'C', 0, 'FII')])
    await saveNote(db, { number: 'Pluggy 2026-04-07', broker: 'AZUL', tradeDate: '2026-04-07', settleDate: '2026-04-09', source: 'sem_nota', sourceKey: 'pluggy:2026-04-07:AZUL', label: 'Pluggy (sem nota)' }, [t('ETFX11', 3, 'C', 0, 'ETF')])
    const investments = [...INVESTMENTS, { id: INV.semTipo, code: 'ETFX11', name: 'ETFX11', type: 'EQUITY', subtype: null }]
    const ops = { ...OPS, [INV.semTipo]: [op('t5', 'BUY', '2026-04-07', 3, 50), op('t6', 'SELL', '2026-04-07', 1, 52)] }
    const r = await syncPluggy(db, creds, invFake(() => null, investments, ops).fn, today)
    expect(r.investments).toEqual([{ itemId: ITEM, label: 'Corretora Azul', found: 3, inserted: 2, updated: 1, existing: 2 }])
    const all = await tradesOf(db)
    const row = (ticker: string, side = 'C') => all.find(x => x.ticker === ticker && x.side === side)!
    expect(row('AAAA3')).toMatchObject({ priceCents: 999, feesCents: 777, note: { source: 'pdf' } })
    expect(row('FIIA11')).toMatchObject({ priceCents: 999, qty: 10, feesCents: 30, note: { sourceKey: 'b3neg:2026-03-10:AZUL' } })
    expect(row('ETFX11')).toMatchObject({ priceCents: 999, feesCents: 0 }) // Pluggy sem taxa: nada a atualizar
    // o dia 04-07 já tinha nota da Pluggy: a venda de AAAA3 e a de ETFX11 entram nela, com o tipo que o banco já conhece
    expect(row('AAAA3', 'V')).toMatchObject({ seq: 2, note: { sourceKey: 'pluggy:2026-04-07:AZUL' } })
    expect(row('ETFX11', 'V')).toMatchObject({ seq: 3, assetType: 'ETF', note: { sourceKey: 'pluggy:2026-04-07:AZUL' } })
    expect((await loadAll(db)).notes).toHaveLength(3)
    const before = await loadAll(db)
    expect((await syncPluggy(db, creds, invFake(() => null, investments, ops).fn, today)).investments[0]).toMatchObject({ inserted: 0, updated: 0, existing: 5 })
    expect(await loadAll(db)).toEqual(before)
  })

  it('nota em PDF salva depois tira a operação da Pluggy, e a próxima sincronização não a traz de volta', async () => {
    const db = await broker()
    await syncPluggy(db, creds, invFake().fn, today)
    await saveNote(db, { number: '56', broker: 'AZUL', tradeDate: '2026-03-10', settleDate: '2026-03-12', source: 'pdf', sourceKey: 'pdf:AZUL:56', label: null }, [
      { seq: 1, side: 'C', assetType: 'Ação', ticker: 'AAAA3', qty: 100, priceCents: 1234, feesCents: 600, irrfCents: 0 },
      { seq: 2, side: 'C', assetType: 'FII', ticker: 'FIIA11', qty: 10, priceCents: 10000, feesCents: 40, irrfCents: 0 },
    ])
    const d = await loadAll(db)
    expect(d.notes.map(n => n.sourceKey)).toEqual(['pdf:AZUL:56', 'pluggy:2026-04-07:AZUL'])
    expect(d.trades).toHaveLength(3)
    expect((await syncPluggy(db, creds, invFake().fn, today)).investments[0]).toMatchObject({ inserted: 0, updated: 0, existing: 3 })
    expect(await loadAll(db)).toEqual(d)
  })

  it('nota com C 300 cobre três compras de 100 da Pluggy no mesmo dia: posição fica 300', async () => {
    const db = await broker()
    await saveNote(db, { number: '57', broker: 'AZUL', tradeDate: '2026-03-10', settleDate: '2026-03-12', source: 'pdf', sourceKey: 'pdf:AZUL:57', label: null },
      [{ seq: 1, side: 'C', assetType: 'Ação', ticker: 'AAAA3', qty: 300, priceCents: 1234, feesCents: 900, irrfCents: 0 }])
    const ops = { [INV.acao]: [op('t1', 'BUY', '2026-03-10', 100, 12.3), op('t2', 'BUY', '2026-03-10', 100, 12.34), op('t3', 'BUY', '2026-03-10', 100, 12.38)] }
    const r = await syncPluggy(db, creds, invFake(() => null, INVESTMENTS, ops).fn, today)
    expect(r.investments[0]).toMatchObject({ inserted: 0, updated: 0, existing: 3 })
    expect((await loadAll(db)).trades.map(t => t.qty)).toEqual([300])
  })

  it('nota com 100 e Pluggy com 100 + 50 no dia: entra só a sobra de 50, a preço médio e taxas proporcionais', async () => {
    const db = await broker()
    await saveNote(db, { number: '58', broker: 'AZUL', tradeDate: '2026-03-10', settleDate: '2026-03-12', source: 'pdf', sourceKey: 'pdf:AZUL:58', label: null },
      [{ seq: 1, side: 'C', assetType: 'Ação', ticker: 'AAAA3', qty: 100, priceCents: 1200, feesCents: 300, irrfCents: 0 }])
    const ops = { [INV.acao]: [op('t1', 'BUY', '2026-03-10', 100, 12, { brokerageFee: 3 }), op('t2', 'BUY', '2026-03-10', 50, 15, { brokerageFee: 1.5 })] }
    const r = await syncPluggy(db, creds, invFake(() => null, INVESTMENTS, ops).fn, today)
    expect(r.investments[0]).toMatchObject({ inserted: 1, updated: 0 })
    const all = await tradesOf(db)
    expect(all.map(t => [t.note.source, t.qty, t.priceCents, t.feesCents])).toEqual([['pdf', 100, 1200, 300], ['sem_nota', 50, 1300, 150]])
    const before = await loadAll(db)
    expect((await syncPluggy(db, creds, invFake(() => null, INVESTMENTS, ops).fn, today)).investments[0]).toMatchObject({ inserted: 0, updated: 0 })
    expect(await loadAll(db)).toEqual(before)
  })

  it('lê as operações do Yield uma vez por item, não uma por operação da Pluggy', async () => {
    const db = await broker()
    let reads = 0
    const counted = { ...db, select: <T>(sql: string, p?: unknown[]) => { if (/FROM trades/.test(sql)) reads++; return db.select<T>(sql, p) } }
    await syncPluggy(counted, creds, invFake().fn, today)
    expect(reads).toBe(1)
  })

  it('403 nos investimentos não marca a credencial como ruim nem trava o próximo item', async () => {
    const db = await setup()
    await savePluggyItem(db, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Outro Banco')
    const r = await syncPluggy(db, creds, fake(u => u.pathname === '/investments' ? json({}, 403) : null).fn, today)
    expect(r.errors.map(e => e.label)).toEqual(['Banco Exemplo', 'Outro Banco'])
    expect(r.errors.every(e => e.message.startsWith('investimentos não lidos'))).toBe(true)
  })

  it('erro nos investimentos não atrapalha contas e lançamentos; item sem renda variável é contado', async () => {
    const db = await setup()
    const r = await syncPluggy(db, creds, invFake(u => u.pathname === '/investments' ? json({}, 500) : null).fn, today)
    expect(r).toMatchObject({ accounts: 2, inserted: 3, investments: [] })
    expect(r.errors).toEqual([{ itemId: ITEM, label: 'Banco Exemplo', message: 'investimentos não lidos (A Pluggy respondeu com erro (HTTP 500))' }])
    expect((await loadGastos(db)).txns).toHaveLength(3)
    const r2 = await syncPluggy(db, creds, invFake(u => u.pathname.endsWith('/transactions') && u.pathname.includes(INV.fii) ? json({}, 500) : null).fn, today)
    expect(r2.errors).toHaveLength(1)
    expect((await loadAll(db)).trades).toHaveLength(0) // erro no meio não grava parte do item
    expect((await syncPluggy(db, creds, fake().fn, today)).investments).toEqual([{ itemId: ITEM, label: 'Banco Exemplo', found: 0, inserted: 0, updated: 0, existing: 0 }])
  })
})
