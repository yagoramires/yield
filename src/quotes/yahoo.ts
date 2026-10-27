import type { Db } from '../db/client'
import { upsertQuote } from '../db/repo'
import { normalizeTicker } from '../domain/ledger'
import type { Cents } from '../domain/types'
import { parseBRL } from '../import/parse'

export const MANUAL_QUOTE_SYMBOLS = { dolar: 'BRL=X', BTC: 'BTC-BRL', ETH: 'ETH-BRL' }
export const REFRESH_MS = 15 * 60 * 1000

// Sem o User-Agent de navegador o Yahoo às vezes responde 429.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

export function yahooSymbol(tickerOrSymbol: string): string {
  const s = tickerOrSymbol.trim().toUpperCase()
  return /[.\-=]/.test(s) ? s : `${normalizeTicker(s)}.SA`
}

export async function fetchYahooQuote(symbol: string, fetchFn: typeof fetch): Promise<{ priceCents: Cents; at: string }> {
  const res = await fetchFn(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`)
  const meta = (await res.json())?.chart?.result?.[0]?.meta
  const price = meta?.regularMarketPrice
  if (typeof price !== 'number' || !(price > 0)) throw new Error(`Yahoo ${symbol}: resposta sem preço`)
  const t = meta.regularMarketTime
  return { priceCents: parseBRL(price), at: (typeof t === 'number' ? new Date(t * 1000) : new Date()).toISOString() }
}

export async function refreshQuotes(db: Db, symbols: string[], fetchFn: typeof fetch): Promise<{ ok: string[]; failed: string[] }> {
  const ok: string[] = [], failed: string[] = []
  for (const symbol of symbols) {
    try {
      const { priceCents, at } = await fetchYahooQuote(symbol, fetchFn)
      await upsertQuote(db, { symbol, priceCents, fetchedAt: at, source: 'yahoo' })
      ok.push(symbol)
    } catch { failed.push(symbol) }
  }
  return { ok, failed }
}
