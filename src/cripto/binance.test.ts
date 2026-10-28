import { BINANCE_BASE, BinanceError, binanceRequest, fetchBinanceBalances, sign } from './binance'

test('assinatura HMAC-SHA256 igual ao exemplo da documentação da Binance', async () => {
  expect(await sign('NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j', 'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559'))
    .toBe('c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71')
})

test('só as leituras da lista saem do computador', () => {
  expect(() => binanceRequest('POST', `${BINANCE_BASE}/api/v3/order`)).toThrow(BinanceError)
  expect(() => binanceRequest('GET', `${BINANCE_BASE}/sapi/v1/capital/withdraw/apply`)).toThrow('só lê')
  expect(() => binanceRequest('GET', 'https://evil.example/api/v3/account')).toThrow(BinanceError)
  expect(binanceRequest('GET', `${BINANCE_BASE}/api/v3/account?timestamp=1`).pathname).toBe('/api/v3/account')
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const creds = { apiKey: 'chave-teste', secret: 'segredo-teste' }

test('soma spot e Earn, ignora o espelho LD* e o que está zerado', async () => {
  const calls: { url: string; key: string | null }[] = []
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, key: new Headers(init?.headers).get('X-MBX-APIKEY') })
    const path = new URL(url).pathname
    if (path === '/api/v3/account') return json({ balances: [{ asset: 'BTC', free: '0.4', locked: '0.1' }, { asset: 'LDBTC', free: '9', locked: '0' }, { asset: 'ETH', free: '0', locked: '0' }] })
    if (path.endsWith('/flexible/position')) return json({ rows: [{ asset: 'BTC', totalAmount: '0.2' }], total: 1 })
    return json({ code: -2015, msg: 'Invalid API-key, IP, or permissions for action.' }, 403)
  }) as typeof fetch
  const r = await fetchBinanceBalances(creds, fetchFn, () => 1_700_000_000_000)
  expect(r.balances).toHaveLength(1)
  expect(r.balances[0].asset).toBe('BTC')
  expect(r.balances[0].qty).toBeCloseTo(0.7)
  expect(r.earnSkipped).toBe(true)
  expect(calls).toHaveLength(3)
  for (const c of calls) {
    expect(c.key).toBe('chave-teste')
    expect(c.url).toMatch(/timestamp=1700000000000&recvWindow=10000&signature=[0-9a-f]{64}$/)
  }
})

test('chave recusada vira erro de chave; rede fora vira erro de rede', async () => {
  await expect(fetchBinanceBalances(creds, (async () => json({ code: -2015, msg: 'x' }, 401)) as typeof fetch)).rejects.toMatchObject({ kind: 'chave' })
  await expect(fetchBinanceBalances(creds, (async () => { throw new TypeError('offline') }) as typeof fetch)).rejects.toMatchObject({ kind: 'rede' })
})

test('LDO é moeda; LD<x> só sai quando o Earn flexível de <x> foi lido', async () => {
  const run = (flexOk: boolean) => fetchBinanceBalances(creds, (async (url: string) => {
    const path = new URL(url).pathname
    if (path === '/api/v3/account') return json({ balances: [{ asset: 'LDO', free: '5', locked: '0' }, { asset: 'LDBTC', free: '0.2', locked: '0' }] })
    if (flexOk && path.endsWith('/flexible/position')) return json({ rows: [{ asset: 'BTC', totalAmount: '0.2' }], total: 1 })
    return json({ code: -2015 }, 403)
  }) as typeof fetch)
  expect((await run(true)).balances).toEqual(expect.arrayContaining([{ asset: 'LDO', qty: 5 }, { asset: 'BTC', qty: 0.2 }]))
  expect((await run(true)).balances).toHaveLength(2)
  // sem o Earn, o espelho fica como está (aparece "sem cotação") em vez de sumir do total
  expect((await run(false)).balances).toEqual([{ asset: 'LDO', qty: 5 }, { asset: 'LDBTC', qty: 0.2 }])
})
