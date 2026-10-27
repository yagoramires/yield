import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadGastos, savePluggyItem, setOverride } from '../db/gastosRepo'
import { createTestDb } from '../db/testDb'
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
    expect(f.calls.every(c => (c.method === 'POST' && c.url.endsWith('/auth')) || (c.method === 'GET' && /\/accounts\?itemId=|\/v2\/transactions\?/.test(c.url)))).toBe(true)
    expect(f.calls.find(c => c.url.includes('/v2/'))!.url).toContain('dateFrom=2025-10-26&dateTo=2026-11-26')
    const g = await loadGastos(db)
    expect(g.accounts.map(a => [a.externalId, a.kind, a.name, a.institution]).sort()).toEqual([
      [`pluggy:${BANK}`, 'conta', 'Conta Exemplo', 'Banco Exemplo'], [`pluggy:${CARD}`, 'cartao', 'Cartão Exemplo', 'Banco Exemplo']])
    expect(g.accounts.every(a => a.lastSyncAt)).toBe(true)
    expect(g.txns.find(t => t.description === 'Salario Ficticio')).toMatchObject({ date: '2026-10-05', pending: true, amountCents: 500000 })
    expect(g.txns.find(t => t.description === 'Loja Inventada')).toMatchObject({ amountCents: -7500, installment: '2/3' })
  })

  it('2ª sincronização com as mesmas respostas não duplica e usa lastSyncAt − 35 dias', async () => {
    const db = await setup()
    await syncPluggy(db, creds, fake().fn, today)
    const before = (await loadGastos(db)).txns.length
    const f = fake()
    await syncPluggy(db, creds, f.fn, today)
    expect((await loadGastos(db)).txns).toHaveLength(before)
    const from = new Date(Date.now() - 35 * 864e5).toISOString().slice(0, 10)
    expect(f.calls.find(c => c.url.includes('/v2/'))!.url).toContain(`dateFrom=${from}`)
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
})
