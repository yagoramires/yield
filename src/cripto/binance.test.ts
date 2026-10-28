import { BINANCE_BASE, BinanceError, binanceRequest, fetchBinanceBalances, fetchBinanceSwaps, sign } from './binance'

test('assinatura HMAC-SHA256 igual ao exemplo da documentação da Binance', async () => {
  expect(await sign('NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j', 'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559'))
    .toBe('c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71')
})

test('só as leituras da lista saem do computador', () => {
  expect(() => binanceRequest('POST', `${BINANCE_BASE}/api/v3/order`)).toThrow(BinanceError)
  expect(() => binanceRequest('GET', `${BINANCE_BASE}/sapi/v1/capital/withdraw/apply`)).toThrow('só lê')
  expect(() => binanceRequest('GET', 'https://evil.example/api/v3/account')).toThrow(BinanceError)
  expect(binanceRequest('GET', `${BINANCE_BASE}/api/v3/account?timestamp=1`).pathname).toBe('/api/v3/account')
  for (const p of ['/sapi/v1/fiat/payments', '/sapi/v1/convert/tradeFlow', '/api/v3/myTrades']) {
    expect(binanceRequest('GET', `${BINANCE_BASE}${p}?timestamp=1`).pathname).toBe(p)
    expect(() => binanceRequest('POST', `${BINANCE_BASE}${p}`)).toThrow('só lê')
  }
  expect(() => binanceRequest('GET', `${BINANCE_BASE}/sapi/v1/convert/acceptQuote`)).toThrow('só lê')
  expect(() => binanceRequest('GET', `${BINANCE_BASE}/sapi/v1/fiat/orders`)).toThrow('só lê')
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

describe('histórico para o aportado', () => {
  const NOW = Date.parse('2018-03-15T00:00:00Z')
  const DAY = 86_400_000
  type Route = (q: URLSearchParams) => Response
  const run = (routes: Record<string, Route>, assets = ['BTC']) => {
    const calls: { path: string; q: URLSearchParams; key: string | null }[] = []
    const sleeps: { ms: number; after: string }[] = []
    const fetchFn = (async (url: string, init?: RequestInit) => {
      const u = new URL(url)
      calls.push({ path: u.pathname, q: u.searchParams, key: new Headers(init?.headers).get('X-MBX-APIKEY') })
      return (routes[u.pathname] ?? (() => json({ code: -1121, msg: 'Invalid symbol.' }, 400)))(u.searchParams)
    }) as typeof fetch
    const sleep = async (ms: number) => { sleeps.push({ ms, after: calls.at(-1)?.q.get('symbol') ?? '' }) }
    return fetchBinanceSwaps(creds, assets, fetchFn, () => NOW, sleep).then(r => ({ ...r, calls, sleeps }))
  }
  const covers = (ws: [number, number][], from: number, maxDays: number) => {
    const sorted = [...ws].sort((a, b) => a[0] - b[0])
    expect(sorted[0][0]).toBe(from)
    expect(sorted.at(-1)![1]).toBeGreaterThanOrEqual(NOW - 1)
    sorted.forEach(([a, b], i) => {
      expect(b - a).toBeLessThan(maxDays * DAY)
      if (i) expect(a).toBe(sorted[i - 1][1] + 1)
    })
  }
  const empty = { '/sapi/v1/fiat/payments': () => json({ data: [], total: 0 }), '/sapi/v1/convert/tradeFlow': () => json({ list: [] }) }

  test('PIX/cartão: compra e venda, janelas até 2017-07-01, página seguinte quando vem cheia, só Completed', async () => {
    const r = await run({ ...empty, '/sapi/v1/fiat/payments': q => {
      if (q.get('transactionType') === '0' && q.get('beginTime') === String(NOW - 90 * DAY)) {
        if (q.get('page') === '1') return json({ data: Array.from({ length: 500 }, (_, i) => ({ orderNo: `p${i}`, sourceAmount: '1', fiatCurrency: 'BRL', obtainAmount: '0.001', cryptoCurrency: 'BTC', status: i ? 'Failed' : 'Completed', createTime: NOW - 10 * DAY })) })
        return json({ data: [{ orderNo: 'x', sourceAmount: '200', fiatCurrency: 'BRL', obtainAmount: '0.5', cryptoCurrency: 'ETH', totalFee: '2', status: 'Completed', createTime: NOW - 5 * DAY }] })
      }
      if (q.get('transactionType') === '1' && q.get('beginTime') === String(NOW - 90 * DAY)) return json({ data: [{ sourceAmount: '50', fiatCurrency: 'BRL', obtainAmount: '0.0005', cryptoCurrency: 'BTC', status: 'Completed', createTime: NOW - 2 * DAY }] })
      return json({ data: [] })
    } })
    expect(r.failed).toEqual([])
    expect(r.swaps).toEqual(expect.arrayContaining([
      { time: NOW - 10 * DAY, get: 'BTC', getQty: 0.001, pay: 'BRL', payQty: 1 },
      { time: NOW - 5 * DAY, get: 'ETH', getQty: 0.5, pay: 'BRL', payQty: 200 },
      { time: NOW - 2 * DAY, get: 'BRL', getQty: 50, pay: 'BTC', payQty: 0.0005 },
    ]))
    const fiat = r.calls.filter(c => c.path === '/sapi/v1/fiat/payments')
    for (const t of ['0', '1']) covers(fiat.filter(c => c.q.get('transactionType') === t && c.q.get('page') === '1').map(c => [Number(c.q.get('beginTime')), Number(c.q.get('endTime'))]), Date.parse('2017-07-01T00:00:00Z'), 91)
    expect(fiat.filter(c => c.q.get('page') === '2')).toHaveLength(1)
    expect(fiat.every(c => c.q.get('rows') === '500' && c.key === 'chave-teste' && /^[0-9a-f]{64}$/.test(c.q.get('signature') ?? ''))).toBe(true)
  })

  test('avisa o progresso de cada fonte enquanto lê e "ok" no fim', async () => {
    const seen: string[] = []
    await fetchBinanceSwaps(creds, ['BTC'], (async () => json({ data: [], list: [] })) as typeof fetch, () => NOW, async () => {}, t => seen.push(t))
    expect(seen.some(t => /PIX\/cartão \d{2}\/\d{4}/.test(t))).toBe(true)
    expect(seen.some(t => /Convert \d{2}\/\d{4}/.test(t))).toBe(true)
    expect(seen.some(t => /à vista BTC(BRL|USDT)/.test(t))).toBe(true)
    expect(seen.at(-1)).toBe('PIX/cartão ok · Convert ok · à vista ok')
  })

  test('Convert: janelas de até 30 dias até 2018-01-01, só SUCCESS', async () => {
    const r = await run({ ...empty, '/sapi/v1/convert/tradeFlow': q => json({ list: q.get('endTime') === String(NOW - 1) ? [
      { fromAsset: 'USDT', fromAmount: '100', toAsset: 'BTC', toAmount: '0.01', orderStatus: 'SUCCESS', createTime: NOW - DAY },
      { fromAsset: 'USDT', fromAmount: '9', toAsset: 'BTC', toAmount: '0.001', orderStatus: 'FAIL', createTime: NOW - DAY },
    ] : [] }) })
    expect(r.swaps).toEqual([{ time: NOW - DAY, get: 'BTC', getQty: 0.01, pay: 'USDT', payQty: 100 }])
    const conv = r.calls.filter(c => c.path === '/sapi/v1/convert/tradeFlow')
    covers(conv.map(c => [Number(c.q.get('startTime')), Number(c.q.get('endTime'))]), Date.parse('2018-01-01T00:00:00Z'), 30)
    expect(conv.every(c => c.q.get('limit') === '1000')).toBe(true)
  })

  test('spot: tenta os pares em real e em dólar de cada moeda, pula símbolo inexistente e pagina por fromId', async () => {
    const r = await run({ ...empty,
      '/sapi/v1/fiat/payments': q => json({ data: q.get('beginTime') === String(NOW - 90 * DAY) && q.get('transactionType') === '0' ? [{ sourceAmount: '10', fiatCurrency: 'BRL', obtainAmount: '1', cryptoCurrency: 'SOL', status: 'Completed', createTime: NOW - DAY }] : [] }),
      '/api/v3/myTrades': q => {
        const sym = q.get('symbol')
        if (sym === 'BTCUSDT' && q.get('fromId') === '0') return json(Array.from({ length: 1000 }, (_, i) => ({ id: i, price: '10', qty: '0.1', quoteQty: '1', commission: '0.001', commissionAsset: 'BTC', time: NOW - 3 * DAY, isBuyer: true })))
        if (sym === 'BTCUSDT' && q.get('fromId') === '1000') return json([{ id: 1000, price: '10', qty: '0.1', quoteQty: '1', commission: '0.01', commissionAsset: 'USDT', time: NOW - DAY, isBuyer: false }])
        if (sym === 'SOLBRL') return json([{ id: 7, price: '20', qty: '2', quoteQty: '40', commission: '0.4', commissionAsset: 'BRL', time: NOW - DAY, isBuyer: true }])
        return json({ code: -1121, msg: 'Invalid symbol.' }, 400)
      } })
    expect(r.failed).toEqual([])
    const symbols = new Set(r.calls.filter(c => c.path === '/api/v3/myTrades').map(c => c.q.get('symbol')))
    expect(symbols).toEqual(new Set(['BTCBRL', 'BTCUSDT', 'BTCFDUSD', 'BTCUSDC', 'BTCBUSD', 'SOLBRL', 'SOLUSDT', 'SOLFDUSD', 'SOLUSDC', 'SOLBUSD']))
    expect(r.swaps.filter(s => s.get === 'BTC')).toHaveLength(1000)
    expect(r.swaps.find(s => s.get === 'BTC')).toEqual({ time: NOW - 3 * DAY, get: 'BTC', getQty: 0.099, pay: 'USDT', payQty: 1 })
    expect(r.swaps).toEqual(expect.arrayContaining([
      { time: NOW - DAY, get: 'USDT', getQty: 0.99, pay: 'BTC', payQty: 0.1 },
      { time: NOW - DAY, get: 'SOL', getQty: 2, pay: 'BRL', payQty: 40.4 },
    ]))
  })

  test('fonte sem permissão ou fora do ar não perde as outras', async () => {
    const r = await run({
      '/sapi/v1/fiat/payments': () => json({ code: -2015, msg: 'no' }, 403),
      '/sapi/v1/convert/tradeFlow': () => { throw new TypeError('offline') },
      '/api/v3/myTrades': q => json(q.get('symbol') === 'BTCBRL' ? [{ id: 1, qty: '1', quoteQty: '100', commission: '0', commissionAsset: 'BNB', time: NOW, isBuyer: true }] : []),
    })
    expect(r.swaps).toEqual([{ time: NOW, get: 'BTC', getQty: 1, pay: 'BRL', payQty: 100 }])
    expect(r.failed.map(f => [f.source, (f.error as BinanceError).kind]).sort()).toEqual([['Convert', 'rede'], ['compras com PIX/cartão', 'chave']])
  })

  test('spot: espera entre um par e outro e, no 429, aguarda o Retry-After e tenta de novo uma vez', async () => {
    let hits = 0
    const r = await run({ ...empty, '/api/v3/myTrades': q => {
      if (q.get('symbol') !== 'BTCUSDT') return json([])
      if (hits++ === 0) return new Response('{"code":-1003}', { status: 429, headers: { 'Retry-After': '7' } })
      return json([{ id: 1, qty: '1', quoteQty: '100', commission: '0', commissionAsset: 'BNB', time: NOW, isBuyer: true }])
    } })
    expect(r.failed).toEqual([])
    expect(r.swaps).toEqual([{ time: NOW, get: 'BTC', getQty: 1, pay: 'USDT', payQty: 100 }])
    expect(r.sleeps.filter(s => s.ms === 7000)).toEqual([{ ms: 7000, after: 'BTCUSDT' }])
    // um intervalo antes de cada par depois do primeiro
    expect(r.sleeps.filter(s => s.ms === 250)).toHaveLength(4)
  })

  test('spot: 418 sem Retry-After espera 60 s; falhando de novo, só o spot vai para failed', async () => {
    const r = await run({ ...empty, '/api/v3/myTrades': () => new Response('{}', { status: 418 }) })
    expect(r.sleeps.filter(s => s.ms === 60_000)).toHaveLength(1)
    expect(r.failed.map(f => f.source)).toEqual(['negociações à vista'])
  })
})
