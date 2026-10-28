import type { Db } from '../db/client'
import { upsertQuote } from '../db/repo'
import { normalizeTicker } from '../domain/ledger'
import type { Cents } from '../domain/types'
import { parseBRL } from '../import/parse'

export const REFRESH_MS = 15 * 60 * 1000

// Sem o User-Agent de navegador o Yahoo às vezes responde 429.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

export function yahooSymbol(tickerOrSymbol: string): string {
  const s = tickerOrSymbol.trim().toUpperCase()
  return /[.\-=]/.test(s) ? s : `${normalizeTicker(s)}.SA`
}

// o Yahoo não tem mais os pares em real (BTC-BRL dá 404): cripto é cotada em dólar; .SA e -BRL vêm de ativos antigos
export function cryptoSymbol(coinOrSymbol: string): string {
  return `${coinOrSymbol.trim().toUpperCase().replace(/(-USD|-BRL|\.SA)$/, '')}-USD`
}

const CRYPTO_REPAIR_KEY = 'reparo.cripto_em_dolar'

/** Cripto manual gravada antes do par em dólar (BTC-BRL, BTC.SA, em real) nunca era cotada: passa a XXX-USD em US$,
 * mantendo quantidade e valor informado. Roda uma vez na abertura (marca no meta); devolve quantos ativos mudaram. */
export async function repairCryptoSymbols(db: Db): Promise<number> {
  if ((await db.select('SELECT 1 FROM meta WHERE key = ?', [CRYPTO_REPAIR_KEY])).length) return 0
  const rows = await db.select<{ id: string; s: string; c: string }>("SELECT id, quote_symbol AS s, currency AS c FROM manual_assets WHERE asset_class = 'cripto' AND quote_symbol IS NOT NULL")
  let changed = 0
  for (const r of rows) {
    const symbol = cryptoSymbol(r.s)
    if (symbol === r.s && r.c === 'USD') continue
    await db.execute("UPDATE manual_assets SET quote_symbol = ?, currency = 'USD' WHERE id = ?", [symbol, r.id])
    changed++
  }
  await db.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')", [CRYPTO_REPAIR_KEY])
  return changed
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
