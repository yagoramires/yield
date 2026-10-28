// Lógica pura das telas de Notas: valida o que o usuário digitou e monta os argumentos de saveNote/saveEvent.
// Toda falha vira Error com mensagem em pt-BR, pronta para exibir.
import type { Note } from '../../db/repo'
import { allocateFees, type NoteFees } from '../../domain/fees'
import { normalizeTicker } from '../../domain/ledger'
import { formatCents } from '../../domain/money'
import type { AssetType, Cents, ISODate, NewCorporateEvent, Side, Trade } from '../../domain/types'
import type { NoteDraft } from '../../import/clearPdf'
import { normalizeBroker, parseBRL } from '../../import/parse'

export const ASSET_TYPES: AssetType[] = ['Ação', 'FII', 'ETF', 'BDR', 'ETF RF']
export const FEE_FIELDS: [keyof NoteFees, string][] = [
  ['liquidacaoCents', 'Liquidação'], ['registroCents', 'Registro'], ['emolumentosCents', 'Emolumentos'],
  ['operacionalCents', 'Operacional'], ['issCents', 'ISS'], ['irrfCents', 'IRRF'], ['outrosCents', 'Outros'],
]

export interface ItemRow { side: Side; assetType: AssetType | ''; ticker: string; qty: string; price: string }
export interface NoteForm { number: string; broker: string; tradeDate: string; settleDate: string; label: string; items: ItemRow[]; fees: Record<keyof NoteFees, string> }
export interface TradeArgs { seq: number; side: Side; assetType: AssetType; ticker: string; qty: number; priceCents: Cents; feesCents: Cents; irrfCents: Cents }
export interface NoteArgs { number: string; broker: string; tradeDate: ISODate; settleDate: ISODate; source: Note['source']; sourceKey: string | null; label: string | null }
export interface Built { note: NoteArgs; trades: TradeArgs[] }

export const emptyItem = (): ItemRow => ({ side: 'C', assetType: 'Ação', ticker: '', qty: '', price: '' })
export const emptyFees = (): Record<keyof NoteFees, string> => Object.fromEntries(FEE_FIELDS.map(([k]) => [k, ''])) as Record<keyof NoteFees, string>
export const emptyForm = (): NoteForm => ({ number: '', broker: '', tradeDate: '', settleDate: '', label: '', items: [emptyItem()], fees: emptyFees() })

export function parsePosInt(text: string, what: string): number {
  const t = text.trim()
  if (!/^\d+$/.test(t) || Number(t) <= 0 || !Number.isSafeInteger(Number(t))) throw new Error(`${what}: informe um número inteiro maior que zero.`)
  return Number(t)
}

// parseBRL('abc') devolve 0 e '29.05' viraria R$ 2.905: aqui o ponto só vale como milhar.
export function parseMoney(text: string, what: string, required = true): Cents {
  const t = text.trim()
  if (!t) { if (required) throw new Error(`${what}: informe o valor.`); return 0 }
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(t)) throw new Error(`${what}: valor inválido. Use, por exemplo, 29,05 ou 1.234,56.`)
  const cents = parseBRL(t)
  if (required && cents <= 0) throw new Error(`${what}: informe um valor maior que zero.`)
  return cents
}

export function parseDate(text: string, what: string): ISODate {
  const d = new Date(`${text}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text) throw new Error(`${what}: informe uma data válida.`)
  return text
}

function tradesFrom(items: { side: Side; assetType: AssetType; ticker: string; qty: number; priceCents: Cents }[], fees: NoteFees): TradeArgs[] {
  try {
    return allocateFees(items, fees).map((t, i) => ({ seq: i + 1, side: t.side, assetType: t.assetType, ticker: t.ticker, qty: t.qty, priceCents: t.priceCents, feesCents: t.feesCents, irrfCents: t.irrfCents }))
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('IRRF')) throw new Error('IRRF informado, mas a nota não tem venda.')
    throw new Error('Não foi possível ratear as taxas desta nota. Confira os itens e as taxas.')
  }
}

export function buildNote(f: NoteForm, kind: 'manual' | 'sem_nota', keep?: { number: string; source: Note['source']; sourceKey: string | null }): Built {
  const semNota = kind === 'sem_nota'
  const number = semNota ? (keep?.number ?? `sem-nota-${crypto.randomUUID().slice(0, 8)}`) : f.number.trim()
  if (!number) throw new Error('Nº da nota: informe o número.')
  const broker = normalizeBroker(f.broker) || (semNota ? 'SEM NOTA' : '')
  if (!broker) throw new Error('Corretora: informe a corretora.')
  const tradeDate = parseDate(f.tradeDate, 'Pregão')
  const settleDate = semNota || !f.settleDate ? tradeDate : parseDate(f.settleDate, 'Liquidação')
  const label = f.label.trim()
  if (semNota && !label) throw new Error('Informe o motivo (ex.: IPO, subscrição).')
  if (!f.items.length) throw new Error('A nota precisa de ao menos um item.')
  if (semNota && f.items.length !== 1) throw new Error('Operação sem nota tem uma única compra.')
  const items = f.items.map((r, i) => {
    const n = `Item ${i + 1}`
    const ticker = normalizeTicker(r.ticker)
    if (!ticker) throw new Error(`${n}: informe o ticker.`)
    if (!r.assetType) throw new Error(`${n}: escolha o tipo.`)
    return { side: semNota ? 'C' as const : r.side, assetType: r.assetType, ticker, qty: parsePosInt(r.qty, `${n}, Qtd`), priceCents: parseMoney(r.price, `${n}, Preço`) }
  })
  const fees = Object.fromEntries(FEE_FIELDS.map(([k, name]) => [k, semNota ? 0 : parseMoney(f.fees[k], name, false)])) as unknown as NoteFees
  const source = semNota ? 'sem_nota' : (keep?.source ?? 'manual')
  const sourceKey = semNota ? null : source === 'manual' ? `manual:${broker}:${number}:${tradeDate}` : (keep?.sourceKey ?? null)
  return { note: { number, broker, tradeDate, settleDate, source, sourceKey, label: semNota ? label : null }, trades: tradesFrom(items, fees) }
}

export function draftToSave(draft: NoteDraft, resolved: { ticker: string; assetType: AssetType | '' }[]): Built {
  const items = draft.items.map((it, i) => {
    const ticker = normalizeTicker(resolved[i]?.ticker ?? '')
    const assetType = resolved[i]?.assetType
    if (!ticker) throw new Error(`Item ${i + 1} (${it.spec}): informe o ticker.`)
    if (!assetType) throw new Error(`Item ${i + 1} (${it.spec}): escolha o tipo.`)
    if (!Number.isSafeInteger(it.qty) || it.qty <= 0) throw new Error(`Item ${i + 1}: quantidade inválida no PDF.`)
    return { side: it.side, assetType, ticker, qty: it.qty, priceCents: it.priceCents }
  })
  const { number, broker, tradeDate } = draft
  return { note: { number, broker, tradeDate, settleDate: draft.settleDate ?? tradeDate, source: 'pdf', sourceKey: `pdf:${broker}:${number}`, label: null }, trades: tradesFrom(items, draft.fees) }
}

// Reabre a nota no formulário. A divisão original das taxas não é guardada: o total vai em "Outros".
export function formFromNote(n: Note, trades: Trade[]): NoteForm {
  const fees = emptyFees()
  const sum = (k: 'feesCents' | 'irrfCents') => trades.reduce((s, t) => s + t[k], 0)
  if (sum('feesCents')) fees.outrosCents = formatCents(sum('feesCents'))
  if (sum('irrfCents')) fees.irrfCents = formatCents(sum('irrfCents'))
  return {
    number: n.source === 'sem_nota' ? '' : n.number, broker: n.broker, tradeDate: n.tradeDate, settleDate: n.settleDate, label: n.label ?? '',
    items: trades.map(t => ({ side: t.side, assetType: t.assetType, ticker: t.ticker, qty: String(t.qty), price: formatCents(t.priceCents) })), fees,
  }
}

export interface EventForm { kind: NewCorporateEvent['kind']; ticker: string; date: string; qty: string; newTicker: string; unitCost: string }
export const emptyEvent = (): EventForm => ({ kind: 'bonificacao', ticker: '', date: '', qty: '', newTicker: '', unitCost: '' })

export function buildEvent(f: EventForm): NewCorporateEvent {
  const ticker = normalizeTicker(f.ticker)
  if (!ticker) throw new Error('Ativo: informe o ticker.')
  const date = parseDate(f.date, 'Data')
  if (f.kind === 'mudanca_ticker') {
    const newTicker = normalizeTicker(f.newTicker)
    if (!newTicker || newTicker === ticker) throw new Error('Novo ticker: informe um ticker diferente do atual.')
    return { kind: 'mudanca_ticker', ticker, newTicker, date }
  }
  const qty = parsePosInt(f.qty, 'Qtd')
  if (f.kind === 'bonificacao') return { kind: 'bonificacao', ticker, date, qtyDelta: qty, unitCostCents: f.unitCost.trim() ? parseMoney(f.unitCost, 'Custo unitário') : null }
  return { kind: f.kind, ticker, date, qtyDelta: f.kind === 'grupamento' ? -qty : qty }
}

// Líquido da nota: vendas − compras − taxas − IRRF (negativo = você pagou).
export const noteNet = (ts: Pick<Trade, 'side' | 'qty' | 'priceCents' | 'feesCents' | 'irrfCents'>[]): Cents =>
  ts.reduce((s, t) => s + (t.side === 'V' ? 1 : -1) * t.qty * t.priceCents - t.feesCents - t.irrfCents, 0)
export const DUP_MSG = 'Essa nota já existe'
