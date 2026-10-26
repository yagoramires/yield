import { normalizeTicker } from '../domain/ledger'
import type { NoteFees } from '../domain/fees'
import type { AssetType, Cents, ISODate, Side } from '../domain/types'
import { normalizeBroker, parseBRDate, parseBRL, parseQty } from './parse'

export interface NoteDraftItem { side: Side; spec: string; ticker: string | null; assetType: AssetType | null; qty: number; priceCents: Cents }
export interface NoteDraft { number: string; broker: 'CLEAR'; tradeDate: ISODate; settleDate: ISODate | null; items: NoteDraftItem[]; fees: NoteFees }

const HEADER = /^(\d+)\s+\d+\s+(\d{2}\/\d{2}\/\d{4})$/ // linha de valores sob "Nr. nota Folha Data pregão"
// 1-BOVESPA C VISTA <especificação> [obs] <qtd> <preço> <valor> <D/C>
const TRADE = /^\d-BOVESPA\s+([CV])\s+\S+\s+(?:\d+\/\d+\s+)?(.+?)(?:\s+[#A-Z])?\s+(\d[\d.]*)\s+(\d[\d.]*,\d+)\s+\d[\d.]*,\d+\s+[DC]$/
const AMOUNT = /(\d[\d.]*,\d{2})(?:\s+[DC])?\s*$/
const FEE_LABELS: [RegExp, keyof NoteFees][] = [
  [/^Taxa de liquida[çc][ãa]o/i, 'liquidacaoCents'], [/^Taxa de registro/i, 'registroCents'],
  [/^Emolumentos/i, 'emolumentosCents'], [/^Taxa operacional/i, 'operacionalCents'],
  [/^ISS\b/i, 'issCents'], [/^I\.R\.R\.F\. s\/ opera/i, 'irrfCents'], [/^Outros\b/i, 'outrosCents'],
]

const noFees = (): NoteFees => ({ liquidacaoCents: 0, registroCents: 0, emolumentosCents: 0, operacionalCents: 0, issCents: 0, outrosCents: 0, irrfCents: 0 })

function parseItem(m: RegExpExecArray): NoteDraftItem {
  const spec = m[2].trim()
  const raw = /\b[A-Z]{4}\d{1,2}\b/.exec(spec)?.[0]
  const ticker = raw ? normalizeTicker(raw) : null
  return {
    side: m[1] as Side, spec, ticker, qty: parseQty(m[3]), priceCents: parseBRL(m[4]),
    assetType: /^FII\b/.test(spec) || (ticker?.endsWith('11') && /\bFII\b/.test(spec)) ? 'FII' : null,
  }
}

export function parseClearNote(pages: string[]): NoteDraft[] {
  const notes: NoteDraft[] = []
  let cur: NoteDraft | undefined
  const lines = pages.join('\n').split('\n').map(l => l.trim())
  lines.forEach((line, i) => {
    const h = HEADER.exec(line)
    if (h && /^Nr\. nota/i.test(lines[i - 1] ?? '')) {
      const tradeDate = parseBRDate(h[2])
      // Folha 2+ da mesma nota continua a anterior.
      if (cur?.number === h[1] && cur.tradeDate === tradeDate) return
      cur = { number: h[1], broker: normalizeBroker('CLEAR') as 'CLEAR', tradeDate, settleDate: null, items: [], fees: noFees() }
      notes.push(cur)
      return
    }
    if (!cur) return
    if (/^\d-BOVESPA\b/.test(line)) {
      const m = TRADE.exec(line)
      if (!m) throw new Error(`Linha de negócio não reconhecida na nota ${cur.number}: "${line}"`)
      cur.items.push(parseItem(m))
      return
    }
    const settle = /^L[ií]quido para (\d{2}\/\d{2}\/\d{4})/i.exec(line)
    if (settle) { cur.settleDate = parseBRDate(settle[1]); return }
    const fee = FEE_LABELS.find(([re]) => re.test(line))
    const amount = fee && AMOUNT.exec(line)
    if (fee && amount) cur.fees[fee[1]] = parseBRL(amount[1])
  })
  return notes
}
