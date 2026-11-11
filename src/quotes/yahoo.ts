import type { Db } from '../db/client'
import { saveQuoteDividends, saveSegment, upsertQuote, type QuoteDividends } from '../db/repo'
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

type Dividends = Omit<QuoteDividends, 'symbol' | 'fetchedAt'>

/** Soma e último dos proventos por cota que o Yahoo devolve em `events.dividends` (chave = timestamp da data ex). */
export function parseDividends(events: unknown): Dividends | null {
  const list = Object.values((events as { dividends?: Record<string, { amount?: unknown; date?: unknown }> })?.dividends ?? {})
    .filter((d): d is { amount: number; date: number } => typeof d.amount === 'number' && d.amount > 0 && typeof d.date === 'number')
    .sort((a, b) => a.date - b.date)
  const last = list.at(-1)
  if (!last) return null
  return { sum12m: list.reduce((s, d) => s + d.amount, 0), lastAmount: last.amount, lastDate: new Date(last.date * 1000).toISOString().slice(0, 10) }
}

// range=1y + events=div: a mesma chamada da cotação já traz os proventos dos últimos 12 meses
export async function fetchYahooQuote(symbol: string, fetchFn: typeof fetch): Promise<{ priceCents: Cents; at: string; dividends: Dividends | null }> {
  const res = await fetchFn(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1mo&events=div`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`)
  const result = (await res.json())?.chart?.result?.[0]
  const meta = result?.meta
  const price = meta?.regularMarketPrice
  if (typeof price !== 'number' || !(price > 0)) throw new Error(`Yahoo ${symbol}: resposta sem preço`)
  const t = meta.regularMarketTime
  return { priceCents: parseBRL(price), at: (typeof t === 'number' ? new Date(t * 1000) : new Date()).toISOString(), dividends: parseDividends(result.events) }
}

// o Yahoo dá setor e indústria em inglês; FII vem como REIT e a indústria vira o segmento usado aqui.
// REIT—Diversified fica de fora: o Yahoo põe ali logística, lajes, papel e renda urbana, e um chute errado distorce a meta.
const REIT_PT: Record<string, string> = {
  'REIT—Retail': 'Shoppings', 'REIT—Industrial': 'Logística', 'REIT—Office': 'Lajes corporativas', 'REIT—Mortgage': 'Papel',
  'REIT—Residential': 'Residencial', 'REIT—Healthcare Facilities': 'Hospitais', 'REIT—Hotel & Motel': 'Hotéis',
}
const SECTOR_PT: Record<string, string> = {
  'Financial Services': 'Financeiro', Utilities: 'Utilidade pública', Energy: 'Petróleo e gás', 'Basic Materials': 'Materiais básicos',
  Industrials: 'Bens industriais', 'Consumer Cyclical': 'Consumo cíclico', 'Consumer Defensive': 'Consumo não cíclico', Healthcare: 'Saúde',
  Technology: 'Tecnologia', 'Communication Services': 'Comunicações', 'Real Estate': 'Imobiliário',
}

/** Segmento pela busca do Yahoo (a cotação não traz); null quando ele não tem. Erro de rede lança, para tentar de novo depois. */
export async function fetchYahooSegment(symbol: string, fetchFn: typeof fetch): Promise<string | null> {
  const res = await fetchFn(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=1&newsCount=0`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Yahoo busca ${symbol}: HTTP ${res.status}`)
  const q = ((await res.json())?.quotes as { symbol?: string; sectorDisp?: string; industryDisp?: string }[] | undefined)?.find(x => x.symbol === symbol)
  const ind = q?.industryDisp, sec = q?.sectorDisp
  if (ind?.startsWith('REIT')) return REIT_PT[ind] ?? null
  // final 11 como "Financial Services" é FII ou ETF que o Yahoo chama de gestora, não um banco
  if (symbol.endsWith('11.SA') && sec === 'Financial Services') return null
  return (sec && SECTOR_PT[sec]) ?? sec ?? null
}

export async function refreshQuotes(db: Db, symbols: string[], fetchFn: typeof fetch): Promise<{ ok: string[]; failed: string[] }> {
  const ok: string[] = [], failed: string[] = []
  for (const symbol of symbols) {
    try {
      const { priceCents, at, dividends } = await fetchYahooQuote(symbol, fetchFn)
      await upsertQuote(db, { symbol, priceCents, fetchedAt: at, source: 'yahoo' })
      await saveQuoteDividends(db, symbol, dividends && { ...dividends, fetchedAt: at })
      ok.push(symbol)
    } catch { failed.push(symbol) }
  }
  // segmento não muda: busca só uma vez por ativo da B3 (os que o Yahoo não tem ficam gravados como null)
  const known = new Set((await db.select<{ symbol: string }>('SELECT symbol FROM asset_segments')).map(r => r.symbol))
  for (const symbol of ok.filter(s => s.endsWith('.SA') && !known.has(s))) {
    try { await saveSegment(db, { symbol, segment: await fetchYahooSegment(symbol, fetchFn), source: 'yahoo' }) } catch { /* tenta de novo na próxima atualização */ }
  }
  return { ok, failed }
}
