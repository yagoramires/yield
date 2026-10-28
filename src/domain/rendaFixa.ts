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
export function nameOf(product: string, fromPosicao: boolean): string {
  if (/^tesouro\b/i.test(product)) return product
  const parts = product.split(' - ')
  return (fromPosicao ? parts : parts.length > 2 ? [parts[0], ...parts.slice(2)] : parts).join(' ')
}

/** Cruza as movimentações da B3 com a última Posição: aplicado, recebido, valor de hoje e rendimento de cada título. */
export function rfHoldings(moves: RfMove[], positions: RfPosition[]): RfHolding[] {
  const byKey = new Map<string, RfMove[]>()
  for (const m of [...moves].sort((a, b) => a.date.localeCompare(b.date))) {
    const l = byKey.get(m.key)
    if (l) l.push(m)
    else byKey.set(m.key, [m])
  }
  // só a Posição mais recente vale: título que não está nela foi vendido ou venceu
  const latest = positions.reduce((m, p) => (p.asOf > m ? p.asOf : m), '')
  const posByKey = new Map(positions.filter(p => p.asOf === latest).map(p => [p.key, p]))
  const keys = [...new Set([...byKey.keys(), ...posByKey.keys()])]

  const list = keys.map(key => {
    const ms = byKey.get(key) ?? []
    const p0 = posByKey.get(key)
    // vendido ou vencido depois da data da Posição: o valor dela não vale mais
    const left = p0 ? ms.filter(m => m.date > p0.asOf && m.kind !== 'juros').reduce((q, m) => q + (m.kind === 'aplicacao' ? m.qty : -m.qty), p0.qty) : 0
    const pos = p0 && left > 1e-6 ? p0 : undefined
    let qty = 0, applied = 0, invested = 0, received = 0, unknownReceived = false, oversold = false
    for (const m of ms) {
      if (m.kind === 'aplicacao') { qty += m.qty; applied += m.valueCents ?? 0; invested += m.valueCents ?? 0 }
      else if (m.kind === 'juros') received += m.valueCents ?? 0
      else {
        if (m.qty > qty + 1e-6) oversold = true // saiu mais do que entrou no período: faltam compras antigas
        applied -= qty > 0 ? Math.round(applied * Math.min(1, m.qty / qty)) : 0
        qty = Math.max(0, qty - m.qty)
        if (m.valueCents === null) unknownReceived = true
        else received += m.valueCents
      }
    }
    // a Movimentação só cobre parte do histórico se a quantidade não bate com a da Posição: aí vale o aplicado da Posição
    const hasBuys = ms.some(m => m.kind === 'aplicacao') && !(pos && Math.abs(pos.qty - qty) > 1e-4)
    // fora da Posição: encerrado se não sobrou quantidade, ou se acabou numa saída já coberta por uma Posição
    // (a Movimentação pode não ter as compras antigas); senão falta uma Posição nova
    const last = ms.at(-1)
    const closed = !pos && (qty <= 1e-9 || (last?.kind === 'saida' && (p0 !== undefined || (latest !== '' && latest >= last.date))))
    const valueCents = pos ? pos.valueCents : closed ? 0 : null
    const investedCents = hasBuys ? invested : pos?.appliedCents ?? null
    const appliedCents = closed ? 0 : hasBuys ? applied : pos?.appliedCents ?? null
    const partial = !hasBuys || oversold
    const gainCents = valueCents === null || investedCents === null || unknownReceived || (closed && oversold) ? null : valueCents + (partial ? 0 : received) - investedCents
    return {
      key, name: pos ? nameOf(pos.product, true) : nameOf(ms[0].product, false), issuer: pos?.issuer ?? null, indexer: pos?.indexer ?? null, maturity: pos?.maturity ?? null,
      qty: pos?.qty ?? qty, appliedCents, investedCents, receivedCents: received, valueCents, gainCents,
      gainPct: gainCents === null || !investedCents ? null : gainCents / investedCents,
      // aplicação depois da data da Posição: o valor dela não inclui esse dinheiro
      closed, asOf: pos?.asOf ?? null, needsNewerPosicao: (!pos && !closed) || (pos !== undefined && ms.some(m => m.kind === 'aplicacao' && m.date > pos.asOf)), last: ms.at(-1)?.date ?? '',
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

/** Quantidade e aplicado em aberto (custo médio; juros não entram) por título até `end`, data ou mês, inclusive. `partial`: saiu mais do que entrou. */
export function rfOpenByKey(moves: RfMove[], end: string): Map<string, { qty: number; applied: Cents; partial: boolean }> {
  const byKey = new Map<string, { qty: number; applied: Cents; partial: boolean }>()
  for (const m of [...moves].sort((a, b) => a.date.localeCompare(b.date))) {
    if (m.date.slice(0, end.length) > end || m.kind === 'juros') continue
    const h = byKey.get(m.key) ?? { qty: 0, applied: 0, partial: false }
    if (m.kind === 'aplicacao') byKey.set(m.key, { ...h, qty: h.qty + m.qty, applied: h.applied + (m.valueCents ?? 0) })
    else byKey.set(m.key, { qty: Math.max(0, h.qty - m.qty), applied: h.qty > 0 ? Math.max(0, h.applied - Math.round(h.applied * Math.min(1, m.qty / h.qty))) : 0, partial: h.partial || m.qty > h.qty + 1e-6 })
  }
  return byKey
}

/** Aplicado em aberto no fim de cada mês, só pelas movimentações (custo médio; juros não entram). */
export function rfAppliedByMonth(moves: RfMove[], lastMonth: Month, n: number): { month: Month; cents: Cents }[] {
  return Array.from({ length: n }, (_, i) => addMonths(lastMonth, i - n + 1)).map(month =>
    ({ month, cents: [...rfOpenByKey(moves, month).values()].reduce((s, h) => s + h.applied, 0) }))
}

// shortcut: a instituição só existe dentro da source_key da Movimentação (b3rf:data:mov:produto:instituição:…); virar coluna se precisar de mais.
export const rfInstitution = (m: RfMove): string | null => m.sourceKey.split(`:${m.product}:`)[1]?.split(':')[0] || null
