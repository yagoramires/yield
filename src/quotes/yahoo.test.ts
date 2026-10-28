import { beforeEach, describe, expect, test } from 'vitest'
import { createTestDb, type Db } from '../db/testDb'
import { loadAll, upsertQuote } from '../db/repo'
import { cryptoSymbol, fetchYahooQuote, refreshQuotes, yahooSymbol } from './yahoo'

const resp = (price: number, time = 1793030000) =>
  new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: price, regularMarketTime: time } }] } }))
const fake: typeof fetch = async (url) => {
  const u = String(url)
  if (u.includes('XXXX3')) return new Response('nope', { status: 404 })
  return resp(10.92)
}

let db: Db
beforeEach(() => { db = createTestDb() })

test('yahooSymbol', () => {
  expect(yahooSymbol('itsa4')).toBe('ITSA4.SA')
  expect(yahooSymbol('ITSA4.SA')).toBe('ITSA4.SA')
  for (const s of ['BTC-BRL', 'ETH-BRL', 'BRL=X']) expect(yahooSymbol(s)).toBe(s)
})

test('cryptoSymbol: moeda vira o par em dólar do Yahoo', () => {
  expect(['btc', ' ETH ', 'SOL-USD', 'BTC-BRL', 'BTC.SA'].map(cryptoSymbol)).toEqual(['BTC-USD', 'ETH-USD', 'SOL-USD', 'BTC-USD', 'BTC-USD'])
})

describe('fetchYahooQuote', () => {
  test('converte preço em centavos e hora em ISO', async () => {
    const q = await fetchYahooQuote('ITSA4.SA', fake)
    expect(q).toEqual({ priceCents: 1092, at: new Date(1793030000 * 1000).toISOString() })
  })
  test('arredonda sem artefato de float', async () => {
    expect((await fetchYahooQuote('X.SA', async () => resp(1.005))).priceCents).toBe(101)
  })
  test('erro em HTTP não-ok e em resposta sem preço', async () => {
    await expect(fetchYahooQuote('XXXX3.SA', fake)).rejects.toThrow()
    await expect(fetchYahooQuote('X.SA', async () => new Response(JSON.stringify({ chart: { result: null } })))).rejects.toThrow()
  })
})

describe('refreshQuotes', () => {
  test('falha de um símbolo não derruba os outros e mantém a cotação antiga', async () => {
    await upsertQuote(db, { symbol: 'XXXX3.SA', priceCents: 500, fetchedAt: '2024-01-01T00:00:00.000Z', source: 'yahoo' })
    const r = await refreshQuotes(db, ['ITSA4.SA', 'XXXX3.SA'], fake)
    expect(r).toEqual({ ok: ['ITSA4.SA'], failed: ['XXXX3.SA'] })
    const q = (await loadAll(db)).quotes
    expect(q.find(x => x.symbol === 'ITSA4.SA')).toMatchObject({ priceCents: 1092, source: 'yahoo' })
    expect(q.find(x => x.symbol === 'XXXX3.SA')!.priceCents).toBe(500)
  })
  test('nunca sobrescreve cotação manual', async () => {
    await upsertQuote(db, { symbol: 'BRL=X', priceCents: 600, fetchedAt: '2024-01-01T00:00:00.000Z', source: 'manual' })
    await refreshQuotes(db, ['BRL=X'], fake)
    expect((await loadAll(db)).quotes[0]).toMatchObject({ priceCents: 600, source: 'manual' })
  })
})
