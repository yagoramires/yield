import { beforeEach, describe, expect, test } from 'vitest'
import { createTestDb, type Db } from '../db/testDb'
import { loadAll, saveManualAsset, saveSegment, upsertQuote } from '../db/repo'
import { cryptoSymbol, fetchYahooQuote, fetchYahooSegment, parseDividends, refreshQuotes, repairCryptoSymbols, yahooSymbol } from './yahoo'

const resp = (price: number, time = 1793030000, events?: unknown) =>
  new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: price, regularMarketTime: time }, events }] } }))
// 15/09 e 15/10/2026, 13h UTC (o Yahoo marca a data ex no horário do pregão)
const DIVS = { dividends: { 1789477200: { amount: 0.1, date: 1789477200 }, 1792069200: { amount: 0.085, date: 1792069200 } } }
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

test('repairCryptoSymbols: cripto manual antiga em -BRL / .SA passa ao par em dólar, uma vez só', async () => {
  const db = createTestDb()
  const base = { assetClass: 'cripto' as const, currency: 'BRL' as const, costCents: null, quantity: 0.5, valueCents: 12_345, updatedAt: '2026-01-01', sourceKey: null }
  await saveManualAsset(db, { ...base, id: 'a', name: 'Bitcoin', quoteSymbol: 'BTC-BRL' })
  await saveManualAsset(db, { ...base, id: 'b', name: 'Ether', quoteSymbol: 'eth.sa' })
  await saveManualAsset(db, { ...base, id: 'c', name: 'Sem símbolo', quoteSymbol: null })
  await saveManualAsset(db, { ...base, id: 'd', name: 'Fundo', assetClass: 'outro', quoteSymbol: 'XPTO11.SA' })
  expect(await repairCryptoSymbols(db)).toBe(2)
  const byId = Object.fromEntries((await loadAll(db)).manualAssets.map(a => [a.id, a]))
  expect(byId.a).toMatchObject({ quoteSymbol: 'BTC-USD', currency: 'USD', quantity: 0.5, valueCents: 12_345 })
  expect(byId.b).toMatchObject({ quoteSymbol: 'ETH-USD', currency: 'USD' })
  expect(byId.c).toMatchObject({ quoteSymbol: null, currency: 'BRL' })
  expect(byId.d).toMatchObject({ quoteSymbol: 'XPTO11.SA', currency: 'BRL' })
  // marcada no meta: não roda de novo
  await saveManualAsset(db, { ...base, id: 'e', name: 'Sol', quoteSymbol: 'SOL-BRL' })
  expect(await repairCryptoSymbols(db)).toBe(0)
})

test('cryptoSymbol: moeda vira o par em dólar do Yahoo', () => {
  expect(['btc', ' ETH ', 'SOL-USD', 'BTC-BRL', 'BTC.SA'].map(cryptoSymbol)).toEqual(['BTC-USD', 'ETH-USD', 'SOL-USD', 'BTC-USD', 'BTC-USD'])
})

describe('fetchYahooQuote', () => {
  test('converte preço em centavos e hora em ISO', async () => {
    const q = await fetchYahooQuote('ITSA4.SA', fake)
    expect(q).toEqual({ priceCents: 1092, at: new Date(1793030000 * 1000).toISOString(), dividends: null })
  })
  test('arredonda sem artefato de float', async () => {
    expect((await fetchYahooQuote('X.SA', async () => resp(1.005))).priceCents).toBe(101)
  })
  test('erro em HTTP não-ok e em resposta sem preço', async () => {
    await expect(fetchYahooQuote('XXXX3.SA', fake)).rejects.toThrow()
    await expect(fetchYahooQuote('X.SA', async () => new Response(JSON.stringify({ chart: { result: null } })))).rejects.toThrow()
  })
})

test('parseDividends: soma, último por data ex e nada quando não pagou', () => {
  expect(parseDividends(DIVS)).toEqual({ sum12m: 0.185, lastAmount: 0.085, lastDate: '2026-10-15' })
  expect(parseDividends(undefined)).toBeNull()
  expect(parseDividends({ dividends: { 1: { amount: 'x', date: 1 } } })).toBeNull()
})

const search = (quotes: unknown[]) => new Response(JSON.stringify({ quotes }))

test('fetchYahooSegment: FII pelo tipo de REIT, ação pelo setor traduzido, null quando não tem', async () => {
  expect(await fetchYahooSegment('SHOP11.SA', async () => search([{ symbol: 'SHOP11.SA', sectorDisp: 'Real Estate', industryDisp: 'REIT—Retail' }]))).toBe('Shoppings')
  expect(await fetchYahooSegment('BBAS3.SA', async () => search([{ symbol: 'BBAS3.SA', sectorDisp: 'Financial Services', industryDisp: 'Banks—Regional' }]))).toBe('Financeiro')
  expect(await fetchYahooSegment('X.SA', async () => search([{ symbol: 'X.SA', sectorDisp: 'Novo Setor' }]))).toBe('Novo Setor')
  expect(await fetchYahooSegment('PAPL11.SA', async () => search([{ symbol: 'PAPL11.SA' }]))).toBeNull()
  // chutes do Yahoo que não dizem o segmento do FII ficam em branco para a pessoa escolher
  expect(await fetchYahooSegment('AAAA11.SA', async () => search([{ symbol: 'AAAA11.SA', sectorDisp: 'Real Estate', industryDisp: 'REIT—Diversified' }]))).toBeNull()
  expect(await fetchYahooSegment('BBBB11.SA', async () => search([{ symbol: 'BBBB11.SA', sectorDisp: 'Financial Services', industryDisp: 'Asset Management' }]))).toBeNull()
  expect(await fetchYahooSegment('CCCC11.SA', async () => search([{ symbol: 'CCCC11.SA', sectorDisp: 'Utilities' }]))).toBe('Utilidade pública') // unit de ação
  expect(await fetchYahooSegment('ITSA4.SA', async () => search([{ symbol: 'ITSA', sectorDisp: 'Industrials' }]))).toBeNull() // outro símbolo
  await expect(fetchYahooSegment('X.SA', async () => new Response('', { status: 429 }))).rejects.toThrow()
})

describe('refreshQuotes', () => {
  test('busca o segmento uma vez, só da B3, e nunca sobrescreve o digitado à mão', async () => {
    const urls: string[] = []
    const f: typeof fetch = async (url) => {
      const u = String(url); urls.push(u)
      return u.includes('/search') ? search([{ symbol: decodeURIComponent(u.split('q=')[1].split('&')[0]), sectorDisp: 'Utilities' }]) : resp(10)
    }
    await saveSegment(db, { symbol: 'TAEE11.SA', segment: 'Energia elétrica', source: 'manual' })
    await refreshQuotes(db, ['ITSA4.SA', 'TAEE11.SA', 'AAPL'], f)
    await refreshQuotes(db, ['ITSA4.SA'], f)
    expect(urls.filter(u => u.includes('/search'))).toHaveLength(1)
    await saveSegment(db, { symbol: 'TAEE11.SA', segment: 'Utilidade pública', source: 'yahoo' })
    expect((await loadAll(db)).segments).toEqual([
      { symbol: 'ITSA4.SA', segment: 'Utilidade pública', source: 'yahoo' },
      { symbol: 'TAEE11.SA', segment: 'Energia elétrica', source: 'manual' },
    ])
  })
  test('grava os proventos junto e apaga quando o ativo deixa de pagar', async () => {
    await refreshQuotes(db, ['RNDA11.SA'], async () => resp(9.5, 1793030000, DIVS))
    expect((await loadAll(db)).quoteDividends).toEqual([{ symbol: 'RNDA11.SA', sum12m: 0.185, lastAmount: 0.085, lastDate: '2026-10-15', fetchedAt: new Date(1793030000 * 1000).toISOString() }])
    await refreshQuotes(db, ['RNDA11.SA'], async () => resp(9.5))
    expect((await loadAll(db)).quoteDividends).toEqual([])
  })
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
