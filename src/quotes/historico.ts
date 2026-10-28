import type { Cents, Month } from '../domain/types'

// Sem o User-Agent de navegador o Yahoo às vezes responde 429 (o mesmo de yahoo.ts).
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

/** Fechamento de cada mês do gráfico do Yahoo (interval=1mo); o candle mensal vem com o timestamp do dia 1. */
export function parseYahooMonthly(json: unknown): Map<Month, Cents> {
  const r = (json as { chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] } })?.chart?.result?.[0]
  const out = new Map<Month, Cents>()
  r?.timestamp?.forEach((t, i) => {
    const c = r.indicators?.quote?.[0]?.close?.[i]
    if (typeof c === 'number' && c > 0) out.set(new Date(t * 1000).toISOString().slice(0, 7), Math.round(c * 100))
  })
  return out
}

/** Série SGS 4391 do Banco Central (CDI acumulado no mês, % a.m.): [{ data: 'dd/MM/aaaa', valor: '1.05' }]. */
export function parseCdi(json: unknown): Map<Month, number> {
  const out = new Map<Month, number>()
  for (const p of Array.isArray(json) ? json as { data: string; valor: string }[] : []) {
    const [, mm, yyyy] = p.data.split('/')
    if (yyyy && mm && !Number.isNaN(Number(p.valor))) out.set(`${yyyy}-${mm}`, Number(p.valor))
  }
  return out
}

export async function fetchMonthlyCloses(symbol: string, fetchFn: typeof fetch): Promise<Map<Month, Cents>> {
  const res = await fetchFn(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1mo`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`)
  return parseYahooMonthly(await res.json())
}

export async function fetchCdi(from: Month, to: Month, fetchFn: typeof fetch): Promise<Map<Month, number>> {
  const br = (m: Month, d: string) => `${d}/${m.slice(5)}/${m.slice(0, 4)}`
  const res = await fetchFn(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.4391/dados?formato=json&dataInicial=${br(from, '01')}&dataFinal=${br(to, '28')}`)
  if (!res.ok) throw new Error(`Banco Central: HTTP ${res.status}`)
  return parseCdi(await res.json())
}
