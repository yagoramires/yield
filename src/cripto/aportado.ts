import type { Db } from '../db/client'
import { loadCryptoBalances, saveComputedCryptoCosts } from '../db/rendaFixaRepo'
import type { Cents, Month } from '../domain/types'
import { fetchMonthlyCloses } from '../quotes/historico'
import { fetchBinanceSwaps, type BinanceSend } from './binance'

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
 * Com `balances`, a quantidade do histórico é conferida com o saldo real: diferença acima de 1% (venda em par cripto, saque,
 * depósito de fora) marca parcial; saldo menor que o histórico reduz o custo na proporção.
 */
export function averageCosts(swaps: Swap[], usdBrl: Map<Month, Cents>, balances?: Map<string, number>): Map<string, { costCents: Cents; partial: boolean }> {
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
  for (const [a, p] of pos) {
    const bal = balances?.get(a)
    if (bal === undefined || Math.abs(p.qty - bal) <= bal * 0.01) continue
    p.partial = true
    if (p.qty > bal) p.cost *= bal / p.qty
  }
  return new Map([...pos].map(([a, p]) => [a, { costCents: Math.round(p.cost), partial: p.partial }]))
}

/**
 * Lê o histórico da Binance e grava o aportado calculado de cada moeda com saldo (o informado à mão fica).
 * Devolve as fontes que não foram lidas; com alguma faltando, todo calculado sai como parcial.
 */
export async function syncCryptoCosts(db: Db, send: BinanceSend, fetchFn: typeof fetch, now?: () => number, sleep?: (ms: number) => Promise<void>, onProgress?: (text: string) => void) {
  const held = (await loadCryptoBalances(db)).filter(c => c.qty > 0)
  const assets = held.map(c => c.asset)
  const failed: { source: string; error: unknown }[] = []
  // dólar sem o mês só deixa parciais as moedas pagas em dólar digital (averageCosts cuida disso)
  const [hist, usdBrl] = await Promise.all([fetchBinanceSwaps(send, assets, now, sleep, onProgress),
    fetchMonthlyCloses('BRL=X', fetchFn, 'max').catch(error => { failed.push({ source: 'dólar do mês', error }); return new Map<Month, Cents>() })])
  const costs = averageCosts(hist.swaps, usdBrl, new Map(held.map(c => [c.asset, c.qty])))
  await saveComputedCryptoCosts(db, assets.flatMap(a => { const c = costs.get(a); return c ? [{ asset: a, costCents: c.costCents, partial: c.partial || hist.failed.length > 0 }] : [] }))
  // o resumo vai para a tela: sem ele, uma busca sem compras terminava calada
  // o informado à mão prevalece: só conta como calculado o que foi gravado
  const auto = held.filter(c => !c.costManual).map(c => c.asset)
  return { failed: [...hist.failed, ...failed], found: hist.found, computed: auto.filter(a => costs.has(a)), missing: auto.filter(a => !costs.has(a)) }
}
