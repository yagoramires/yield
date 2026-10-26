import { read, utils } from 'xlsx'
import type { Db } from '../db/client'
import { saveEvent, upsertDividends } from '../db/repo'
import { normalizeTicker } from '../domain/ledger'
import type { Dividend, DividendKind, ISODate, NewCorporateEvent } from '../domain/types'
import { normalizeBroker, parseBRDate, parseBRL, parseQty } from './parse'

export interface B3Import {
  dividends: Omit<Dividend, 'id'>[]
  events: (NewCorporateEvent & { sourceKey: string })[]
  ignored: number
  toReview: { date: ISODate; movimentacao: string; produto: string }[]
}

type Cell = string | number | boolean | null
const PROVENTOS: Record<string, DividendKind> = { Rendimento: 'Rendimento', Dividendo: 'Dividendo', 'Juros Sobre Capital Próprio': 'JCP' }
const REVISAR = ['Atualização', 'Amortização', 'Leilão de Fração', 'Incorporação', 'Fração em Ativos', 'Cisão']
const text = (v: Cell | undefined) => (v == null ? '' : String(v).trim())
const str = (v: Cell | undefined) => (typeof v === 'number' ? v : text(v))

export function parseB3Movimentacao(data: ArrayBuffer): B3Import {
  const wb = read(data, { cellDates: false })
  const rows = utils.sheet_to_json<Cell[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null, blankrows: false })
  const col = new Map(rows[0]?.map((h, i) => [text(h), i]))
  const out: B3Import = { dividends: [], events: [], ignored: 0, toReview: [] }
  for (const r of rows.slice(1)) {
    const get = (h: string) => r[col.get(h) ?? -1]
    const mov = text(get('Movimentação'))
    const produto = text(get('Produto'))
    const dataRaw = get('Data')
    if (!mov || dataRaw == null) continue
    const date = parseBRDate(dataRaw as string | number)
    const inst = text(get('Instituição'))
    const qtyCell = get('Quantidade')
    const valueCell = get('Valor da Operação')
    const ticker = normalizeTicker(produto.split(' - ')[0])
    const sourceKey = `b3:${date}:${mov}:${produto}:${inst}:${text(qtyCell)}:${text(valueCell)}`
    const qty = parseQty(str(qtyCell))
    const sign = /^d/i.test(text(get('Entrada/Saída'))) ? -1 : 1

    if (PROVENTOS[mov]) {
      out.dividends.push({ ticker, kind: PROVENTOS[mov], payDate: date, amountCents: parseBRL(str(valueCell)), broker: normalizeBroker(inst), source: 'b3', sourceKey })
    } else if (mov === 'Bonificação em Ativos') {
      out.events.push({ kind: 'bonificacao', ticker, date, qtyDelta: qty, unitCostCents: null, sourceKey })
    } else if (mov === 'Desdobro' || mov === 'Grupamento') {
      out.events.push({ kind: mov === 'Desdobro' ? 'desdobramento' : 'grupamento', ticker, date, qtyDelta: sign * qty, sourceKey })
    } else if (REVISAR.includes(mov)) {
      out.toReview.push({ date, movimentacao: mov, produto })
    } else {
      out.ignored++ // negociações entram pelas notas
    }
  }
  return out
}

export async function importB3(db: Db, p: B3Import) {
  const d = await upsertDividends(db, p.dividends)
  let events = 0
  let eventsSkipped = 0
  for (const e of p.events) ('skipped' in (await saveEvent(db, e)) ? eventsSkipped++ : events++)
  return { dividends: d.inserted, dividendsSkipped: d.skipped, replaced: d.replaced, events, eventsSkipped }
}
