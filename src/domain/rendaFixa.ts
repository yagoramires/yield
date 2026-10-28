import type { RfMove, RfPosition } from '../db/rendaFixaRepo'
import { addMonths, monthOf } from './money'
import type { Cents, ISODate, Month } from './types'

export interface RfHolding {
  key: string; name: string; issuer: string | null; indexer: string | null; maturity: ISODate | null; qty: number
  appliedCents: Cents | null // aplicado ainda no título (custo médio)
  investedCents: Cents | null // tudo o que já foi aplicado
  receivedCents: Cents // juros + vendas/resgates
  valueCents: Cents | null; gainCents: Cents | null; gainPct: number | null
  closed: boolean; asOf: ISODate | null; needsNewerPosicao: boolean
}

// "CDB - BANCO X S/A" (Posição) ou "CDB - <código> - BANCO X S/A" (Movimentação) → "CDB BANCO X S/A"
function nameOf(product: string, fromPosicao: boolean): string {
  if (/^tesouro\b/i.test(product)) return product
  const parts = product.split(' - ')
  return (fromPosicao ? parts : parts.length > 2 ? [parts[0], ...parts.slice(2)] : parts).join(' ')
}

/** Cruza as movimentações da B3 com a última Posição: aplicado, recebido, valor de hoje e rendimento de cada título. */
export function rfHoldings(moves: RfMove[], positions: RfPosition[]): RfHolding[] {
  const byKey = new Map<string, RfMove[]>()
  for (const m of [...moves].sort((a, b) => a.date.localeCompare(b.date))) byKey.set(m.key, [...(byKey.get(m.key) ?? []), m])
  const posByKey = new Map(positions.map(p => [p.key, p]))
  const keys = [...new Set([...byKey.keys(), ...posByKey.keys()])]

  const list = keys.map(key => {
    const ms = byKey.get(key) ?? []
    const pos = posByKey.get(key)
    let qty = 0, applied = 0, invested = 0, received = 0, unknownReceived = false
    for (const m of ms) {
      if (m.kind === 'aplicacao') { qty += m.qty; applied += m.valueCents ?? 0; invested += m.valueCents ?? 0 }
      else if (m.kind === 'juros') received += m.valueCents ?? 0
      else {
        applied -= qty > 0 ? Math.round(applied * Math.min(1, m.qty / qty)) : 0
        qty = Math.max(0, qty - m.qty)
        if (m.valueCents === null) unknownReceived = true
        else received += m.valueCents
      }
    }
    const hasBuys = ms.some(m => m.kind === 'aplicacao')
    // fora da Posição mais recente: encerrado se acabou numa saída ou sem quantidade; senão falta uma Posição nova
    const closed = !pos && (qty <= 1e-9 || ms.at(-1)?.kind === 'saida')
    const valueCents = pos ? pos.valueCents : closed ? 0 : null
    const investedCents = hasBuys ? invested : pos?.appliedCents ?? null
    const appliedCents = closed ? 0 : hasBuys ? applied : pos?.appliedCents ?? null
    const gainCents = valueCents === null || investedCents === null || unknownReceived ? null : valueCents + received - investedCents
    return {
      key, name: pos ? nameOf(pos.product, true) : nameOf(ms[0].product, false), issuer: pos?.issuer ?? null, indexer: pos?.indexer ?? null, maturity: pos?.maturity ?? null,
      qty: pos?.qty ?? qty, appliedCents, investedCents, receivedCents: received, valueCents, gainCents,
      gainPct: gainCents === null || !investedCents ? null : gainCents / investedCents,
      closed, asOf: pos?.asOf ?? null, needsNewerPosicao: !pos && !closed, last: ms.at(-1)?.date ?? '',
    }
  })
  const open = list.filter(h => !h.closed).sort((a, b) => (b.valueCents ?? -1) - (a.valueCents ?? -1))
  const done = list.filter(h => h.closed).sort((a, b) => b.last.localeCompare(a.last))
  return [...open, ...done].map(({ last: _, ...h }) => h)
}

export const rfJuros = (moves: RfMove[]) =>
  moves.filter(m => m.kind === 'juros' && m.valueCents !== null).map(m => ({ date: m.date, product: m.product, valueCents: m.valueCents! }))

export function rfJurosByMonth(moves: RfMove[], end: Month, n: number): { month: Month; cents: Cents }[] {
  const juros = rfJuros(moves)
  return Array.from({ length: n }, (_, i) => addMonths(end, i - n + 1)).map(month => ({ month, cents: juros.filter(j => monthOf(j.date) === month).reduce((s, j) => s + j.valueCents, 0) }))
}
