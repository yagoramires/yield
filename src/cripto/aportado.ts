import type { Db } from '../db/client'
import { loadCryptoBalances, saveComputedCryptoCosts } from '../db/rendaFixaRepo'
import type { Cents, Month } from '../domain/types'
import { fetchMonthlyCloses } from '../quotes/historico'
import { fetchBinanceSwaps } from './binance'

/** Uma troca do histórico: recebeu `getQty` de `get` pagando `payQty` de `pay` (comprar BTC com real: get BTC, pay BRL). */
export interface Swap { time: number; get: string; getQty: number; pay: string; payQty: number }

export const STABLES = new Set(['USDT', 'USDC', 'FDUSD', 'BUSD', 'TUSD'])

/** Valor em centavos de real; null quando não dá para saber (outra moeda fiduciária, cripto, mês sem dólar). */
function brlCents(asset: string, qty: number, time: number, usdBrl: Map<Month, Cents>): number | null {
  if (asset === 'BRL') return qty * 100
  const dollar = STABLES.has(asset) ? usdBrl.get(new Date(time).toISOString().slice(0, 7)) : undefined
  return dollar === undefined ? null : qty * dollar
}

/**
 * Custo médio em real por ativo, na ordem do tempo: compra soma quantidade e custo; venda tira custo na proporção da quantidade.
 * `partial`: parte do custo é desconhecida (pago com cripto ou outra moeda, mês sem dólar, ou vendeu mais do que o histórico mostra).
 */
export function averageCosts(swaps: Swap[], usdBrl: Map<Month, Cents>): Map<string, { costCents: Cents; partial: boolean }> {
  const pos = new Map<string, { qty: number; cost: number; partial: boolean }>()
  const at = (a: string) => pos.get(a) ?? pos.set(a, { qty: 0, cost: 0, partial: false }).get(a)!
  for (const s of [...swaps].sort((a, b) => a.time - b.time)) {
    if (s.pay !== 'BRL') {
      const out = at(s.pay)
      if (s.payQty > out.qty * (1 + 1e-9)) out.partial = true
      out.cost -= out.qty > 0 ? out.cost * Math.min(1, s.payQty / out.qty) : out.cost
      out.qty = Math.max(0, out.qty - s.payQty)
    }
    if (s.get !== 'BRL') {
      const into = at(s.get)
      const v = brlCents(s.pay, s.payQty, s.time, usdBrl) ?? brlCents(s.get, s.getQty, s.time, usdBrl)
      if (v === null) into.partial = true
      into.qty += s.getQty
      into.cost += v ?? 0
    }
  }
  return new Map([...pos].map(([a, p]) => [a, { costCents: Math.round(p.cost), partial: p.partial }]))
}

/**
 * Lê o histórico da Binance e grava o aportado calculado de cada moeda com saldo (o informado à mão fica).
 * Devolve as fontes que não foram lidas; com alguma faltando, todo calculado sai como parcial.
 */
export async function syncCryptoCosts(db: Db, creds: { apiKey: string; secret: string }, fetchFn: typeof fetch, now?: () => number, sleep?: (ms: number) => Promise<void>) {
  const assets = (await loadCryptoBalances(db)).filter(c => c.qty > 0).map(c => c.asset)
  const failed: { source: string; error: unknown }[] = []
  // dólar sem o mês só deixa parciais as moedas pagas em dólar digital (averageCosts cuida disso)
  const [hist, usdBrl] = await Promise.all([fetchBinanceSwaps(creds, assets, fetchFn, now, sleep),
    fetchMonthlyCloses('BRL=X', fetchFn, 'max').catch(error => { failed.push({ source: 'dólar do mês', error }); return new Map<Month, Cents>() })])
  const costs = averageCosts(hist.swaps, usdBrl)
  await saveComputedCryptoCosts(db, assets.flatMap(a => { const c = costs.get(a); return c ? [{ asset: a, costCents: c.costCents, partial: c.partial || hist.failed.length > 0 }] : [] }))
  return [...hist.failed, ...failed]
}
