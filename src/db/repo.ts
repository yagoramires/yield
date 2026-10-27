import { normalizeTicker } from '../domain/ledger'
import type { Cents, CorporateEvent, DarfPayment, Dividend, ISODate, Month, NewCorporateEvent, Trade } from '../domain/types'
import { normalizeBroker } from '../import/parse'
import type { Db } from './client'

export interface ManualAsset { id: string; name: string; assetClass: 'renda_fixa' | 'cripto' | 'dolar' | 'outro'; quoteSymbol: string | null; quantity: number | null; valueCents: Cents | null; updatedAt: ISODate; sourceKey: string | null }
export interface Note { id: string; number: string; broker: string; tradeDate: ISODate; settleDate: ISODate; source: 'manual' | 'pdf' | 'planilha' | 'sem_nota'; sourceKey: string | null; label: string | null }
export interface Quote { symbol: string /* sempre yahooSymbol(ticker), ex. 'ITSA4.SA' */; priceCents: Cents; fetchedAt: string; source: 'yahoo' | 'manual' /* manual prevalece e nunca é sobrescrita */ }
export interface Dataset { notes: Note[]; trades: Trade[]; events: CorporateEvent[]; dividends: Dividend[]; payments: DarfPayment[]; quotes: Quote[]; manualAssets: ManualAsset[] }

type TradeInput = Omit<Trade, 'id' | 'noteId' | 'broker' | 'tradeDate' | 'settleDate'>
type NoteInput = Omit<Note, 'id'>

export async function loadAll(db: Db): Promise<Dataset> {
  const [notes, trades, events, dividends, payments, quotes, manualAssets] = await Promise.all([
    db.select<Note>('SELECT id, number, broker, trade_date AS tradeDate, settle_date AS settleDate, source, source_key AS sourceKey, label FROM notes ORDER BY trade_date, number'),
    db.select<Trade>(`SELECT t.id, t.note_id AS noteId, t.seq, n.broker, n.trade_date AS tradeDate, n.settle_date AS settleDate, t.side, t.asset_type AS assetType,
        t.ticker, t.qty, t.price_cents AS priceCents, t.fees_cents AS feesCents, t.irrf_cents AS irrfCents
      FROM trades t JOIN notes n ON n.id = t.note_id ORDER BY n.trade_date, n.number, t.seq`),
    db.select<{ id: string; kind: CorporateEvent['kind']; ticker: string; newTicker: string | null; date: string; qtyDelta: number | null; unitCostCents: number | null }>(
      'SELECT id, kind, ticker, new_ticker AS newTicker, date, qty_delta AS qtyDelta, unit_cost_cents AS unitCostCents FROM corporate_events ORDER BY date, id'),
    db.select<Dividend>('SELECT id, ticker, kind, pay_date AS payDate, amount_cents AS amountCents, broker, source, source_key AS sourceKey FROM dividends ORDER BY pay_date, id'),
    db.select<DarfPayment>('SELECT month, paid_at AS paidAt, principal_cents AS principalCents, total_paid_cents AS totalPaidCents FROM darf_payments ORDER BY month'),
    db.select<Quote>('SELECT symbol, price_cents AS priceCents, fetched_at AS fetchedAt, source FROM quotes ORDER BY symbol'),
    db.select<ManualAsset>('SELECT id, name, asset_class AS assetClass, quote_symbol AS quoteSymbol, quantity, value_cents AS valueCents, updated_at AS updatedAt, source_key AS sourceKey FROM manual_assets ORDER BY name'),
  ])
  return {
    notes, trades, dividends, payments, quotes, manualAssets,
    events: events.map(e => {
      if (e.kind === 'mudanca_ticker') return { id: e.id, kind: e.kind, ticker: e.ticker, newTicker: e.newTicker!, date: e.date }
      if (e.kind === 'bonificacao') return { id: e.id, kind: e.kind, ticker: e.ticker, date: e.date, qtyDelta: e.qtyDelta!, unitCostCents: e.unitCostCents }
      return { id: e.id, kind: e.kind, ticker: e.ticker, date: e.date, qtyDelta: e.qtyDelta! }
    }),
  }
}

async function insertNote(db: Db, id: string, note: NoteInput, trades: (TradeInput & { id?: string })[]) {
  await db.execute(
    'INSERT INTO notes (id, number, broker, trade_date, settle_date, source, source_key, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, note.number, normalizeBroker(note.broker), note.tradeDate, note.settleDate, note.source, note.sourceKey, note.label],
  )
  if (!trades.length) return
  try {
    await db.execute(
      `INSERT INTO trades (id, note_id, seq, side, asset_type, ticker, qty, price_cents, fees_cents, irrf_cents) VALUES ${trades.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      trades.flatMap(t => [t.id ?? crypto.randomUUID(), id, t.seq, t.side, t.assetType, normalizeTicker(t.ticker), t.qty, t.priceCents, t.feesCents, t.irrfCents]),
    )
  } catch (e) {
    await db.execute('DELETE FROM notes WHERE id = ?', [id])
    throw e
  }
}

export async function saveNote(db: Db, note: NoteInput, trades: TradeInput[]): Promise<{ id: string } | { skipped: 'duplicada' }> {
  const dup = await db.select(
    'SELECT 1 FROM notes WHERE (broker = ? AND number = ? AND trade_date = ?) OR (source_key IS NOT NULL AND source_key = ?)',
    [normalizeBroker(note.broker), note.number, note.tradeDate, note.sourceKey],
  )
  if (dup.length) return { skipped: 'duplicada' }
  const id = crypto.randomUUID()
  await insertNote(db, id, note, trades)
  return { id }
}

export async function deleteNote(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM notes WHERE id = ?', [id])
}

export async function replaceNote(db: Db, id: string, note: NoteInput, trades: TradeInput[]): Promise<{ id: string }> {
  const { notes, trades: old } = await loadAll(db)
  const orig = notes.find(n => n.id === id)
  if (!orig) throw new Error('Nota não encontrada')
  await deleteNote(db, id)
  try {
    const r = await saveNote(db, note, trades)
    if ('id' in r) return r
    throw new Error('Já existe outra nota com a mesma corretora, número e data')
  } catch (e) {
    await insertNote(db, id, orig, old.filter(t => t.noteId === id)) // regrava o original
    throw e
  }
}

export async function saveEvent(db: Db, e: NewCorporateEvent & { sourceKey?: string }): Promise<{ id: string } | { skipped: 'duplicada' }> {
  if (e.sourceKey && (await db.select('SELECT 1 FROM corporate_events WHERE source_key = ?', [e.sourceKey])).length) return { skipped: 'duplicada' }
  const id = crypto.randomUUID()
  await db.execute(
    'INSERT INTO corporate_events (id, kind, ticker, new_ticker, date, qty_delta, unit_cost_cents, source_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, e.kind, normalizeTicker(e.ticker), e.kind === 'mudanca_ticker' ? normalizeTicker(e.newTicker) : null, e.date,
      e.kind === 'mudanca_ticker' ? null : e.qtyDelta, e.kind === 'bonificacao' ? e.unitCostCents : null, e.sourceKey ?? null],
  )
  return { id }
}

export async function deleteEvent(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM corporate_events WHERE id = ?', [id])
}

export async function setBonificacaoCost(db: Db, id: string, unitCostCents: Cents): Promise<void> {
  await db.execute("UPDATE corporate_events SET unit_cost_cents = ? WHERE id = ? AND kind = 'bonificacao'", [unitCostCents, id])
}

export async function upsertDividends(db: Db, list: Omit<Dividend, 'id'>[]): Promise<{ inserted: number; skipped: number; replaced: number }> {
  const out = { inserted: 0, skipped: 0, replaced: 0 }
  for (const d of list) {
    const ticker = normalizeTicker(d.ticker)
    const month = d.payDate.slice(0, 7)
    if (d.sourceKey && (await db.select('SELECT 1 FROM dividends WHERE source_key = ?', [d.sourceKey])).length) { out.skipped++; continue }
    // O extrato da B3 é mais preciso que a grade manual: B3 substitui planilha do mesmo ticker/mês, nunca o contrário.
    if (d.source === 'planilha' && (await db.select("SELECT 1 FROM dividends WHERE source = 'b3' AND ticker = ? AND substr(pay_date, 1, 7) = ?", [ticker, month])).length) { out.skipped++; continue }
    if (d.source === 'b3') out.replaced += (await db.execute("DELETE FROM dividends WHERE source = 'planilha' AND ticker = ? AND substr(pay_date, 1, 7) = ?", [ticker, month])).rowsAffected
    await db.execute(
      'INSERT INTO dividends (id, ticker, kind, pay_date, amount_cents, broker, source, source_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [crypto.randomUUID(), ticker, d.kind, d.payDate, d.amountCents, d.broker, d.source, d.sourceKey],
    )
    out.inserted++
  }
  return out
}

export async function deleteDividend(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM dividends WHERE id = ?', [id])
}

export async function savePayment(db: Db, p: DarfPayment): Promise<void> {
  await db.execute('INSERT OR REPLACE INTO darf_payments (month, paid_at, principal_cents, total_paid_cents) VALUES (?, ?, ?, ?)', [p.month, p.paidAt, p.principalCents, p.totalPaidCents])
}

export async function deletePayment(db: Db, month: Month): Promise<void> {
  await db.execute('DELETE FROM darf_payments WHERE month = ?', [month])
}

export async function upsertQuote(db: Db, q: Quote): Promise<void> {
  // A cotação manual nunca é sobrescrita por uma do Yahoo.
  await db.execute(
    `INSERT INTO quotes (symbol, price_cents, fetched_at, source) VALUES (?, ?, ?, ?)
     ON CONFLICT (symbol) DO UPDATE SET price_cents = excluded.price_cents, fetched_at = excluded.fetched_at, source = excluded.source
     WHERE excluded.source = 'manual' OR quotes.source <> 'manual'`,
    [q.symbol, q.priceCents, q.fetchedAt, q.source],
  )
}

export async function deleteQuote(db: Db, symbol: string): Promise<void> {
  await db.execute('DELETE FROM quotes WHERE symbol = ?', [symbol])
}

export async function saveManualAsset(db: Db, a: Omit<ManualAsset, 'id'> & { id?: string }): Promise<string | { skipped: 'duplicada' }> {
  if (!a.id && a.sourceKey && (await db.select('SELECT 1 FROM manual_assets WHERE source_key = ?', [a.sourceKey])).length) return { skipped: 'duplicada' }
  const id = a.id ?? crypto.randomUUID()
  await db.execute(
    'INSERT OR REPLACE INTO manual_assets (id, name, asset_class, quote_symbol, quantity, value_cents, updated_at, source_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, a.name, a.assetClass, a.quoteSymbol, a.quantity, a.valueCents, a.updatedAt, a.sourceKey],
  )
  return id
}

export async function deleteManualAsset(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM manual_assets WHERE id = ?', [id])
}

export async function getAlias(db: Db, spec: string): Promise<string | null> {
  return (await db.select<{ ticker: string }>('SELECT ticker FROM ticker_aliases WHERE spec = ?', [spec]))[0]?.ticker ?? null
}

export async function saveAlias(db: Db, spec: string, ticker: string): Promise<void> {
  await db.execute('INSERT OR REPLACE INTO ticker_aliases (spec, ticker) VALUES (?, ?)', [spec, normalizeTicker(ticker)])
}
