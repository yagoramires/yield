import type { AssetType, CorporateEvent, Position, Sale, Trade, Warning } from './types'

export function normalizeTicker(t: string): string {
  const s = t.trim().toUpperCase()
  return /^[A-Z]{4}\d{1,2}F$/.test(s) ? s.slice(0, -1) : s
}

export interface ReplayResult { positions: Position[]; sales: Sale[]; warnings: Warning[] }

type Item = { date: string; rank: number; k1: string; k2: number; ev?: CorporateEvent; tr?: Trade }

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0)

export function replay(trades: Trade[], events: CorporateEvent[]): ReplayResult {
  const items: Item[] = [
    ...events.map((ev) => ({ date: ev.date, rank: 0, k1: ev.id, k2: 0, ev })),
    ...trades.map((tr) => ({ date: tr.tradeDate, rank: tr.side === 'C' ? 1 : 2, k1: tr.noteId, k2: tr.seq, tr })),
  ].sort((a, b) => cmp(a.date, b.date) || a.rank - b.rank || cmp(a.k1, b.k1) || a.k2 - b.k2)

  const pos = new Map<string, { qty: number; cost: number }>()
  const types = new Map<string, AssetType>()
  const sales: Sale[] = []
  const warnings: Warning[] = []
  const typeWarned = new Set<string>()
  const dayKeys = new Map<string, Set<string>>()

  for (const { ev, tr } of items) {
    if (ev) {
      const tk = normalizeTicker(ev.ticker)
      const p = pos.get(tk)
      if (ev.kind === 'mudanca_ticker') {
        if (!p || p.qty === 0) continue
        const nk = normalizeTicker(ev.newTicker)
        const n = pos.get(nk) ?? { qty: 0, cost: 0 }
        pos.set(nk, { qty: n.qty + p.qty, cost: n.cost + p.cost })
        pos.delete(tk)
        if (!types.has(nk) && types.has(tk)) types.set(nk, types.get(tk)!)
        continue
      }
      if (!p || p.qty <= 0) {
        warnings.push({ kind: 'evento_sem_posicao', ticker: tk, date: ev.date, detail: `Evento (${ev.kind}) sem posição em carteira; ignorado` })
        continue
      }
      p.qty += ev.kind === 'grupamento' ? Math.max(ev.qtyDelta, -p.qty) : ev.qtyDelta
      if (p.qty === 0) p.cost = 0
      if (ev.kind === 'bonificacao') {
        if (ev.unitCostCents === null) {
          warnings.push({ kind: 'bonificacao_sem_custo', ticker: tk, date: ev.date, detail: `Bonificação de ${ev.qtyDelta} sem custo atribuído` })
        } else p.cost += ev.qtyDelta * ev.unitCostCents
      }
      continue
    }
    const t = tr!
    const tk = normalizeTicker(t.ticker)
    const first = types.get(tk)
    if (!first) types.set(tk, t.assetType)
    else if (first !== t.assetType && !typeWarned.has(tk)) {
      typeWarned.add(tk)
      warnings.push({ kind: 'tipo_inconsistente', ticker: tk, date: t.tradeDate, detail: `Tipo ${t.assetType} difere do primeiro registro (${first}); usando ${first}` })
    }
    const dk = `${tk}|${t.tradeDate}|${t.broker}`
    const sides = dayKeys.get(dk) ?? new Set<string>()
    if (!sides.has(t.side) && sides.size === 1) {
      warnings.push({ kind: 'day_trade', ticker: tk, date: t.tradeDate, detail: `Compra e venda no mesmo dia na corretora ${t.broker}` })
    }
    dayKeys.set(dk, sides.add(t.side))

    const p = pos.get(tk) ?? { qty: 0, cost: 0 }
    pos.set(tk, p)
    if (t.side === 'C') {
      p.qty += t.qty
      p.cost += t.qty * t.priceCents + t.feesCents
      continue
    }
    if (t.qty <= 0) {
      warnings.push({ kind: 'quantidade_invalida', ticker: tk, date: t.tradeDate, detail: `Venda com quantidade ${t.qty}; ignorada` })
      continue
    }
    const m = Math.min(t.qty, p.qty)
    const gross = m * t.priceCents
    const fees = Math.round((t.feesCents * m) / t.qty)
    const cost = m > 0 ? Math.round((p.cost * m) / p.qty) : 0
    if (m < t.qty) {
      warnings.push({ kind: 'venda_maior_que_posicao', ticker: tk, date: t.tradeDate, detail: `Venda de ${t.qty} com posição de ${p.qty}; excedente de ${t.qty - m} ignorado` })
    }
    sales.push({
      tradeId: t.id, tradeDate: t.tradeDate, settleDate: t.settleDate, ticker: tk, assetType: types.get(tk)!,
      qty: m, grossCents: gross, netCents: gross - fees, costBasisCents: cost, resultCents: gross - fees - cost,
      irrfCents: Math.round((t.irrfCents * m) / t.qty), alienationCents: t.qty * t.priceCents,
    })
    p.qty -= m
    p.cost = p.qty === 0 ? 0 : p.cost - cost
  }

  const positions = [...pos]
    .filter(([, p]) => p.qty > 0)
    .map(([ticker, p]) => ({ ticker, assetType: types.get(ticker)!, qty: p.qty, totalCostCents: p.cost }))
    .sort((a, b) => cmp(a.ticker, b.ticker))
  return { positions, sales, warnings }
}
