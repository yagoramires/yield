import type { AssetType, Cents, Side } from './types'

export interface NoteItemInput { side: Side; assetType: AssetType; ticker: string; qty: number; priceCents: Cents }
export interface NoteFees {
  liquidacaoCents: Cents; registroCents: Cents; emolumentosCents: Cents
  operacionalCents: Cents; issCents: Cents; outrosCents: Cents; irrfCents: Cents
}

// floor(total × peso / somaPesos) por linha; a última recebe o resto. BigInt evita estourar 2^53 no produto.
function split(total: Cents, weights: number[]): Cents[] {
  if (total === 0) return weights.map(() => 0)
  const sum = weights.reduce((s, w) => s + w, 0)
  if (weights.length === 0 || sum === 0) throw new Error('Taxa sem base de rateio na nota')
  const out = weights.map(w => Number((BigInt(total) * BigInt(w)) / BigInt(sum)))
  out[out.length - 1] += total - out.reduce((s, v) => s + v, 0)
  return out
}

export function allocateFees(items: NoteItemInput[], fees: NoteFees): (NoteItemInput & { feesCents: Cents; irrfCents: Cents })[] {
  const gross = items.map(i => i.qty * i.priceCents)
  const operacional = split(fees.operacionalCents, items.map(() => 1))
  const iss = split(fees.issCents, operacional)
  const proportional = split(fees.liquidacaoCents + fees.registroCents + fees.emolumentosCents + fees.outrosCents, gross)

  const sellIdx = items.flatMap((i, n) => (i.side === 'V' ? [n] : []))
  if (fees.irrfCents > 0 && sellIdx.length === 0) throw new Error('IRRF sem venda na nota')
  const sellIrrf = split(fees.irrfCents, sellIdx.map(n => gross[n]))
  const irrf = items.map(() => 0)
  sellIdx.forEach((n, k) => { irrf[n] = sellIrrf[k] })

  return items.map((item, n) => ({
    ...item,
    feesCents: operacional[n] + iss[n] + proportional[n],
    irrfCents: irrf[n],
  }))
}
