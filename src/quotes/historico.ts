import type { Cents, Month } from '../domain/types'

// Sem o User-Agent de navegador o Yahoo às vezes responde 429 (o mesmo de yahoo.ts).
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

/**
 * Fechamento de cada mês do gráfico do Yahoo (interval=1mo). O Yahoo ajusta o histórico por desdobramento/grupamento;
 * aqui o ajuste é desfeito (meses antes de cada evento voltam para a unidade da época), porque a quantidade vem do replay real.
 */
export function parseYahooMonthly(json: unknown): Map<Month, Cents> {
  type Split = { date: number; numerator: number; denominator: number }
  const r = (json as { chart?: { result?: { timestamp?: number[]; events?: { splits?: Record<string, Split> }; indicators?: { quote?: { close?: (number | null)[] }[] } }[] } })?.chart?.result?.[0]
  const month = (t: number) => new Date(t * 1000).toISOString().slice(0, 7)
  const splits = Object.values(r?.events?.splits ?? {}).filter(x => x.numerator > 0 && x.denominator > 0)
  const out = new Map<Month, Cents>()
  r?.timestamp?.forEach((t, i) => {
    const c = r.indicators?.quote?.[0]?.close?.[i]
    if (typeof c !== 'number' || !(c > 0)) return
    const m = month(t)
    const factor = splits.filter(x => m < month(x.date)).reduce((f, x) => f * (x.numerator / x.denominator), 1)
    out.set(m, Math.round(c * factor * 100))
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
  const res = await fetchFn(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1mo&events=split`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`)
  return parseYahooMonthly(await res.json())
}

export async function fetchCdi(from: Month, to: Month, fetchFn: typeof fetch): Promise<Map<Month, number>> {
  const br = (m: Month, d: string) => `${d}/${m.slice(5)}/${m.slice(0, 4)}`
  const res = await fetchFn(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.4391/dados?formato=json&dataInicial=${br(from, '01')}&dataFinal=${br(to, '28')}`)
  if (!res.ok) throw new Error(`Banco Central: HTTP ${res.status}`)
  return parseCdi(await res.json())
}
