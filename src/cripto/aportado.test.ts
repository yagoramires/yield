import { loadAll } from '../db/repo'
import { saveCryptoBalances, setCryptoCost } from '../db/rendaFixaRepo'
import { createTestDb } from '../db/testDb'
import { averageCosts, syncCryptoCosts, type Swap } from './aportado'

const T = (iso: string) => Date.parse(`${iso}T12:00:00Z`)
const buy = (date: string, asset: string, qty: number, pay: string, payQty: number): Swap => ({ time: T(date), get: asset, getQty: qty, pay, payQty })
const sell = (date: string, asset: string, qty: number, get: string, getQty: number): Swap => ({ time: T(date), get, getQty, pay: asset, payQty: qty })
const usdBrl = new Map([['2024-03', 500], ['2024-04', 550]])

test('compra em real soma custo; venda tira custo proporcional, fora de ordem é ordenado', () => {
  const r = averageCosts([sell('2024-05-01', 'BTC', 0.5, 'BRL', 99_999), buy('2024-01-01', 'BTC', 0.4, 'BRL', 400), buy('2024-02-01', 'BTC', 0.6, 'BRL', 800)], usdBrl)
  expect(r.get('BTC')).toEqual({ costCents: 60_000, partial: false })
  expect(r.has('BRL')).toBe(false) // o real não tem aportado a calcular
})

test('dólar digital vale o fechamento do dólar no mês da operação', () => {
  const r = averageCosts([buy('2024-03-10', 'BTC', 0.1, 'USDT', 100), buy('2024-04-02', 'ETH', 1, 'FDUSD', 10)], usdBrl)
  expect(r.get('BTC')).toEqual({ costCents: 50_000, partial: false })
  expect(r.get('ETH')).toEqual({ costCents: 5_500, partial: false })
})

test('vender cripto por USDT dá ao USDT o custo dele mesmo no mês', () => {
  const r = averageCosts([buy('2024-03-01', 'BTC', 1, 'BRL', 1000), sell('2024-03-20', 'BTC', 1, 'USDT', 300)], usdBrl)
  expect(r.get('BTC')).toEqual({ costCents: 0, partial: false })
  expect(r.get('USDT')).toEqual({ costCents: 150_000, partial: false })
})

test('cripto por cripto, outra moeda fiduciária ou mês sem dólar: custo desconhecido, ativo parcial', () => {
  const r = averageCosts([
    buy('2024-03-01', 'BTC', 1, 'BRL', 1000),
    buy('2024-03-02', 'ETH', 10, 'BTC', 0.25), // ETH pago com BTC: o BTC sai com 1/4 do custo
    buy('2024-03-03', 'SOL', 5, 'EUR', 100),
    buy('2023-01-01', 'ADA', 5, 'USDT', 100),
  ], usdBrl)
  expect(r.get('BTC')).toEqual({ costCents: 75_000, partial: false })
  expect(r.get('ETH')).toEqual({ costCents: 0, partial: true })
  expect(r.get('SOL')).toEqual({ costCents: 0, partial: true })
  expect(r.get('ADA')).toEqual({ costCents: 0, partial: true })
})

test('vender mais do que o histórico mostra (moeda depositada de fora) zera o custo e marca parcial', () => {
  const r = averageCosts([buy('2024-01-01', 'BTC', 0.1, 'BRL', 100), sell('2024-02-01', 'BTC', 0.3, 'BRL', 300), buy('2024-03-01', 'BTC', 0.1, 'BRL', 200)], usdBrl)
  expect(r.get('BTC')).toEqual({ costCents: 20_000, partial: true })
})

test('saldo menor que o histórico (vendeu em par cripto ou sacou): custo na proporção do saldo, parcial', () => {
  const r = averageCosts([buy('2024-01-01', 'BTC', 1, 'BRL', 1000)], usdBrl, new Map([['BTC', 0.25]]))
  expect(r.get('BTC')).toEqual({ costCents: 25_000, partial: true })
})

test('saldo maior que o histórico (depósito de fora) ou histórico zerado com saldo: parcial, custo mantido', () => {
  const r = averageCosts([buy('2024-01-01', 'BTC', 1, 'BRL', 1000), buy('2024-01-01', 'ETH', 1, 'BRL', 100), sell('2024-02-01', 'ETH', 1, 'BRL', 200)], usdBrl,
    new Map([['BTC', 2], ['ETH', 3]]))
  expect(r.get('BTC')).toEqual({ costCents: 100_000, partial: true })
  expect(r.get('ETH')).toEqual({ costCents: 0, partial: true })
})

test('saldo igual ao histórico com até 1% de diferença (taxa) não marca parcial', () => {
  const r = averageCosts([buy('2024-01-01', 'BTC', 1, 'BRL', 1000)], usdBrl, new Map([['BTC', 0.995]]))
  expect(r.get('BTC')).toEqual({ costCents: 100_000, partial: false })
})

describe('buscar aportado na Binance', () => {
  const NOW = Date.parse('2024-03-20T00:00:00Z')
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  const yahoo = { chart: { result: [{ timestamp: [Date.parse('2024-03-01T00:00:00Z') / 1000], indicators: { quote: [{ close: [5] }] } }] } }
  const fetchFn = (convertOk: boolean) => (async (url: string) => {
    const u = new URL(url)
    if (u.hostname.includes('yahoo')) return u.searchParams.get('range') === 'max' ? json(yahoo) : json({}, 404)
    if (u.pathname === '/sapi/v1/fiat/payments') return json({ data: u.searchParams.get('transactionType') === '0' && u.searchParams.get('endTime') === String(NOW - 1)
      ? [{ sourceAmount: '200', fiatCurrency: 'BRL', obtainAmount: '1', cryptoCurrency: 'ETH', status: 'Completed', createTime: NOW - 86_400_000 }, { sourceAmount: '300', fiatCurrency: 'BRL', obtainAmount: '1', cryptoCurrency: 'BTC', status: 'Completed', createTime: NOW - 86_400_000 }] : [] })
    if (u.pathname === '/sapi/v1/convert/tradeFlow') return convertOk ? json({ list: u.searchParams.get('endTime') === String(NOW - 1) ? [{ fromAsset: 'USDT', fromAmount: '10', toAsset: 'ETH', toAmount: '1', orderStatus: 'SUCCESS', createTime: NOW - 1000 }] : [] }) : json({ code: -2015 }, 403)
    return json({ code: -1121, msg: 'Invalid symbol.' }, 400)
  }) as typeof fetch
  const setup = async () => {
    const db = createTestDb()
    await saveCryptoBalances(db, [{ asset: 'BTC', qty: 1 }, { asset: 'ETH', qty: 2 }], '2024-03-20T00:00:00Z')
    await setCryptoCost(db, 'BTC', 1234)
    return db
  }
  const byAsset = async (db: Awaited<ReturnType<typeof setup>>) => new Map((await loadAll(db)).cryptoBalances.map(c => [c.asset, c]))

  test('grava o calculado (USDT pelo dólar do mês) e não toca no informado à mão', async () => {
    const db = await setup()
    const r = await syncCryptoCosts(db, { apiKey: 'k', secret: 's' }, fetchFn(true), () => NOW, async () => {})
    expect(r.failed).toEqual([])
    expect(r.computed).toEqual(['ETH'])
    expect(Object.values(r.found).reduce((s, n) => s + n, 0)).toBeGreaterThan(0)
    const m = await byAsset(db)
    expect(m.get('ETH')).toMatchObject({ costCents: 20_000 + 5_000, costManual: 0, costPartial: 0 })
    expect(m.get('BTC')).toMatchObject({ costCents: 1234, costManual: 1 })
  })

  test('fonte que falhou deixa o calculado como parcial e é devolvida', async () => {
    const db = await setup()
    const { failed } = await syncCryptoCosts(db, { apiKey: 'k', secret: 's' }, fetchFn(false), () => NOW, async () => {})
    expect(failed.map(f => f.source)).toEqual(['Convert'])
    expect((await byAsset(db)).get('ETH')).toMatchObject({ costCents: 20_000, costPartial: 1 })
  })
})
