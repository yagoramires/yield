import { describe, expect, it } from 'vitest'
import { createPluggyClient, PluggyError, pluggyDate, pluggyRequest, toTxnRow, type PluggyTxn } from './pluggy'

const creds = { clientId: 'cid', clientSecret: 'segredo-xyz' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function fake(handler: (url: URL) => Response) {
  const calls: { method: string; url: string; key: string | null }[] = []
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    
    calls.push({ method: init?.method ?? 'GET', url: String(input), key: new Headers(init?.headers).get('X-API-KEY') })
    return handler(new URL(String(input)))
  }) as typeof fetch
  return { fn, calls }
}
const ok = (url: URL) => url.pathname === '/auth' ? json({ apiKey: 'K1' }) : url.pathname === '/accounts' ? json({ results: [] }) : json({ results: [], next: null })

describe('pluggyDate', () => {
  it('meia-noite UTC é o próprio dia; outro horário vai para UTC−3', () => {
    expect(pluggyDate('2026-10-05T00:00:00.000Z')).toBe('2026-10-05')
    expect(pluggyDate('2026-10-05T00:00:00Z')).toBe('2026-10-05')
    expect(pluggyDate('2026-10-06T01:30:00.000Z')).toBe('2026-10-05')
  })
  it('meia-noite UTC com offset explícito também é o próprio dia', () => {
    expect(pluggyDate('2026-10-05T00:00:00+00:00')).toBe('2026-10-05')
    expect(pluggyDate('2026-10-05T00:00:00.000+00:00')).toBe('2026-10-05')
    expect(pluggyDate('2026-10-05T10:00:00-03:00')).toBe('2026-10-05')
  })
})

describe('toTxnRow', () => {
  const base: PluggyTxn = { id: 'x', date: '2026-10-05T00:00:00.000Z', description: ' Loja ', amount: 75, type: 'DEBIT', status: 'POSTED' }
  it('cartão inverte o sinal, conta não', () => {
    expect(toTxnRow(base, 'cartao').amountCents).toBe(-7500)
    expect(toTxnRow({ ...base, amount: -150 }, 'cartao').amountCents).toBe(15000)
    expect(toTxnRow({ ...base, amount: -23.9 }, 'conta').amountCents).toBe(-2390)
    expect(Object.is(toTxnRow({ ...base, amount: 0 }, 'cartao').amountCents, 0)).toBe(true)
  })
  it('parcela, pendente e descrição aparada', () => {
    const r = toTxnRow({ ...base, status: 'PENDING', creditCardMetadata: { installmentNumber: 2, totalInstallments: 3 } }, 'cartao')
    expect(r).toMatchObject({ installment: '2/3', pending: true, description: 'Loja' })
    expect(toTxnRow({ ...base, creditCardMetadata: { installmentNumber: 1, totalInstallments: 1 } }, 'cartao').installment).toBeNull()
  })
})

describe('porta só-leitura', () => {
  it('recusa fora de POST /auth, GET /accounts, GET /v2/transactions', () => {
    expect(() => pluggyRequest('PATCH', 'https://api.pluggy.ai/items/x')).toThrow(/não permitida/)
    expect(() => pluggyRequest('GET', 'https://api.pluggy.ai/payments')).toThrow(/não permitida/)
    expect(() => pluggyRequest('POST', 'https://api.pluggy.ai/accounts')).toThrow(/não permitida/)
    expect(() => pluggyRequest('GET', 'https://evil.example/accounts')).toThrow(/não permitida/)
    expect(() => pluggyRequest('GET', 'https://api.pluggy.ai/v2/transactions?a=1')).not.toThrow()
  })
  it('um `next` malicioso não chama fetchFn', async () => {
    const f = fake((u) => u.pathname === '/auth' ? json({ apiKey: 'K' }) : json({ results: [], next: '/../payments' }))
    const c = createPluggyClient(creds, f.fn)
    await expect(c.listTransactions('a', '2026-01-01', '2026-02-01')).rejects.toBeInstanceOf(PluggyError)
    expect(f.calls.every(x => /\/(auth|accounts|v2\/transactions)(\?|$)/.test(x.url))).toBe(true)
  })
})

describe('cliente', () => {
  it('reutiliza a apiKey e manda X-API-KEY', async () => {
    const f = fake(ok)
    const c = createPluggyClient(creds, f.fn)
    await c.listAccounts('i1'); await c.listAccounts('i2')
    expect(f.calls.filter(x => x.url.endsWith('/auth'))).toHaveLength(1)
    expect(f.calls[1].key).toBe('K1')
    expect(f.calls[1].url).toBe('https://api.pluggy.ai/accounts?itemId=i1')
  })
  it('segue `next` até acabar', async () => {
    const f = fake((u) => {
      if (u.pathname === '/auth') return json({ apiKey: 'K' })
      return u.searchParams.get('after') ? json({ results: [{ id: 'b', date: '2026-01-01T00:00:00.000Z', description: 'x', amount: 1 }], next: null }) : json({ results: [{ id: 'a', date: '2026-01-01T00:00:00.000Z', description: 'x', amount: 1 }], next: '?accountId=acc&after=zzz' })
    })
    const r = await createPluggyClient(creds, f.fn).listTransactions('acc', '2026-01-01', '2026-02-01')
    expect(r.map(t => t.id)).toEqual(['a', 'b'])
    expect(f.calls[2].url).toBe('https://api.pluggy.ai/v2/transactions?accountId=acc&after=zzz')
  })
  it('401 com chave em cache reautentica uma vez e repete', async () => {
    let n = 0
    const f = fake((u) => u.pathname === '/auth' ? json({ apiKey: 'K' + ++n }) : json({ results: [] }, f.calls.at(-1)!.key === 'K1' && f.calls.filter(x => x.url.includes('/accounts')).length > 1 ? 401 : 200))
    const c = createPluggyClient(creds, f.fn)
    await c.listAccounts('i') // guarda K1
    await c.listAccounts('i') // K1 expirou no servidor: 401 → /auth → K2
    expect(f.calls.filter(x => x.url.endsWith('/auth'))).toHaveLength(2)
    expect(f.calls.at(-1)!.key).toBe('K2')
  })
  it('mapeia erros sem vazar segredo', async () => {
    const kind = async (status: number, path = '/accounts') => {
      const f = fake((u) => u.pathname === '/auth' ? json({ apiKey: 'K-SECRETA' }) : json({ erro: 'corpo-secreto' }, status))
      const c = createPluggyClient(creds, f.fn)
      const e = await (path === '/accounts' ? c.listAccounts('i1') : c.listTransactions('a', '2026-01-01', '2026-01-02')).catch(e => e)
      expect(e).toBeInstanceOf(PluggyError)
      expect(e.message).not.toMatch(/K-SECRETA|segredo-xyz|corpo-secreto/)
      return [e.kind, e.message]
    }
    expect(await kind(403)).toEqual(['credenciais', 'Client ID ou Client Secret inválidos'])
    expect(await kind(404)).toEqual(['item', 'Item i1 não encontrado: confira o itemId'])
    expect(await kind(400)).toEqual(['item', 'Item i1 não encontrado: confira o itemId'])
    expect(await kind(429)).toEqual(['limite', 'A Pluggy pediu para esperar; tente mais tarde'])
    expect((await kind(500))[0]).toBe('resposta')
    expect((await kind(404, '/v2/transactions'))[0]).toBe('resposta')
  })
  it('auth 401, rede e JSON fora do formato', async () => {
    const bad = createPluggyClient(creds, fake(() => json({}, 401)).fn)
    await expect(bad.listAccounts('i')).rejects.toMatchObject({ kind: 'credenciais' })
    const net = createPluggyClient(creds, (async () => { throw new TypeError('boom') }) as typeof fetch)
    await expect(net.listAccounts('i')).rejects.toMatchObject({ kind: 'rede', message: 'Sem conexão com a Pluggy' })
    const calls: (AbortSignal | null | undefined)[] = []
    const slow = createPluggyClient(creds, (async (_: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init?.signal)
      throw new DOMException('The operation timed out.', 'TimeoutError')
    }) as typeof fetch)
    await expect(slow.listAccounts('i')).rejects.toMatchObject({ kind: 'rede', message: 'A Pluggy não respondeu a tempo; tente de novo' })
    expect(calls[0]).toBeInstanceOf(AbortSignal)
    const aborted = createPluggyClient(creds, (async () => { throw new DOMException('aborted', 'AbortError') }) as typeof fetch)
    await expect(aborted.listAccounts('i')).rejects.toMatchObject({ kind: 'rede', message: 'A Pluggy não respondeu a tempo; tente de novo' })
    const odd = createPluggyClient(creds, fake((u) => u.pathname === '/auth' ? json({ apiKey: 'K' }) : json({ foo: 1 })).fn)
    await expect(odd.listAccounts('i')).rejects.toMatchObject({ kind: 'resposta' })
  })
})
