import { normalizeTicker } from '../domain/ledger'
import type { OpeningLoss } from '../domain/tax'
import type { Cents, CorporateEvent, DarfPayment, Dividend, ISODate, Month, NewCorporateEvent, Trade } from '../domain/types'
import { normalizeBroker } from '../import/parse'
import type { Db } from './client'
import { loadCryptoBalances, loadRfMoves, loadRfPositions, type CryptoBalance, type RfMove, type RfPosition } from './rendaFixaRepo'

export interface ManualAsset { id: string; name: string; assetClass: 'renda_fixa' | 'cripto' | 'dolar' | 'exterior' | 'outro'; currency: 'BRL' | 'USD' /* USD: cotação em dólar × BRL=X */; costCents: Cents | null /* aportado, na moeda do ativo */; quoteSymbol: string | null; quantity: number | null; valueCents: Cents | null; updatedAt: ISODate; sourceKey: string | null }
export interface Note { id: string; number: string; broker: string; tradeDate: ISODate; settleDate: ISODate; source: 'manual' | 'pdf' | 'planilha' | 'sem_nota'; sourceKey: string | null; label: string | null }
export interface Quote { symbol: string /* sempre yahooSymbol(ticker), ex. 'ITSA4.SA' */; priceCents: Cents; fetchedAt: string; source: 'yahoo' | 'manual' /* manual prevalece e nunca é sobrescrita */ }
export interface Dataset { notes: Note[]; trades: Trade[]; events: CorporateEvent[]; dividends: Dividend[]; payments: DarfPayment[]; quotes: Quote[]; manualAssets: ManualAsset[]; rfMoves: RfMove[]; rfPositions: RfPosition[]; cryptoBalances: CryptoBalance[]; openingLoss: OpeningLoss | null; proventos: ProventosMode }
// o que a pessoa faz com os proventos: reinvestir (entram na caixinha que paga as próximas compras) ou sacar
export type ProventosMode = 'reinvisto' | 'saco'

type TradeInput = Omit<Trade, 'id' | 'noteId' | 'broker' | 'tradeDate' | 'settleDate'>
type NoteInput = Omit<Note, 'id'>

export async function loadAll(db: Db): Promise<Dataset> {
  const [notes, trades, events, dividends, payments, quotes, manualAssets, rfMoves, rfPositions, cryptoBalances, opening, proventos] = await Promise.all([
    db.select<Note>('SELECT id, number, broker, trade_date AS tradeDate, settle_date AS settleDate, source, source_key AS sourceKey, label FROM notes ORDER BY trade_date, number'),
    db.select<Trade>(`SELECT t.id, t.note_id AS noteId, t.seq, n.broker, n.trade_date AS tradeDate, n.settle_date AS settleDate, t.side, t.asset_type AS assetType,
        t.ticker, t.qty, t.price_cents AS priceCents, t.fees_cents AS feesCents, t.irrf_cents AS irrfCents
      FROM trades t JOIN notes n ON n.id = t.note_id ORDER BY n.trade_date, n.number, t.seq`),
    db.select<{ id: string; kind: CorporateEvent['kind']; ticker: string; newTicker: string | null; date: string; qtyDelta: number | null; unitCostCents: number | null }>(
      'SELECT id, kind, ticker, new_ticker AS newTicker, date, qty_delta AS qtyDelta, unit_cost_cents AS unitCostCents FROM corporate_events ORDER BY date, id'),
    db.select<Dividend>('SELECT id, ticker, kind, pay_date AS payDate, amount_cents AS amountCents, broker, source, source_key AS sourceKey FROM dividends ORDER BY pay_date, id'),
    db.select<DarfPayment>('SELECT month, paid_at AS paidAt, principal_cents AS principalCents, total_paid_cents AS totalPaidCents FROM darf_payments ORDER BY month'),
    db.select<Quote>('SELECT symbol, price_cents AS priceCents, fetched_at AS fetchedAt, source FROM quotes ORDER BY symbol'),
    db.select<ManualAsset>('SELECT id, name, asset_class AS assetClass, currency, cost_cents AS costCents, quote_symbol AS quoteSymbol, quantity, value_cents AS valueCents, updated_at AS updatedAt, source_key AS sourceKey FROM manual_assets ORDER BY name'),
    loadRfMoves(db), loadRfPositions(db), loadCryptoBalances(db),
    db.select<{ value: string }>('SELECT value FROM meta WHERE key = ?', [OPENING_LOSS_KEY]),
    db.select<{ value: string }>("SELECT value FROM meta WHERE key = 'investimentos.proventos'"),
  ])
  return {
    notes, trades, dividends, payments, quotes, manualAssets, rfMoves, rfPositions, cryptoBalances,
    openingLoss: opening.length ? JSON.parse(opening[0].value) as OpeningLoss : null,
    proventos: proventos[0]?.value === 'saco' ? 'saco' : 'reinvisto',
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
    await addTrades(db, id, trades)
  } catch (e) {
    await db.execute('DELETE FROM notes WHERE id = ?', [id])
    throw e
  }
}

/** Acrescenta operações a uma nota que já existe (ex. dia da B3 importado antes, completado por uma Negociação mais nova). */
export async function addTrades(db: Db, noteId: string, trades: (TradeInput & { id?: string })[]): Promise<void> {
  await db.execute(
    `INSERT INTO trades (id, note_id, seq, side, asset_type, ticker, qty, price_cents, fees_cents, irrf_cents) VALUES ${trades.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
    trades.flatMap(t => [t.id ?? crypto.randomUUID(), noteId, t.seq, t.side, t.assetType, normalizeTicker(t.ticker), t.qty, t.priceCents, t.feesCents, t.irrfCents]),
  )
}

export async function saveNote(db: Db, note: NoteInput, trades: TradeInput[]): Promise<{ id: string } | { skipped: 'duplicada' }> {
  const dup = await db.select(
    'SELECT 1 FROM notes WHERE (broker = ? AND number = ? AND trade_date = ?) OR (source_key IS NOT NULL AND source_key = ?)',
    [normalizeBroker(note.broker), note.number, note.tradeDate, note.sourceKey],
  )
  if (dup.length) return { skipped: 'duplicada' }
  const id = crypto.randomUUID()
  await insertNote(db, id, note, trades)
  if (note.source === 'pdf' || note.source === 'manual') {
    try {
      await dropAutoTrades(db, note.tradeDate, trades)
    } catch (e) {
      await deleteNote(db, id) // sem isto, replaceNote regravaria a original ao lado da nova
      throw e
    }
  }
  return { id }
}

/** A nota tem as taxas certas: some a mesma operação (dia, ticker, lado, quantidade) vinda da Negociação da B3 ou da Pluggy, uma por uma. */
async function dropAutoTrades(db: Db, date: ISODate, trades: TradeInput[]) {
  const auto = await db.select<{ id: string; noteId: string; ticker: string; side: string; qty: number }>(
    `SELECT t.id, t.note_id AS noteId, t.ticker, t.side, t.qty FROM trades t JOIN notes n ON n.id = t.note_id
      WHERE n.trade_date = ? AND n.source = 'sem_nota' AND (n.source_key LIKE 'b3neg:%' OR n.source_key LIKE 'pluggy:%') ORDER BY n.source_key, t.seq`, [date])
  const gone = trades.flatMap(t => {
    const i = auto.findIndex(a => a.ticker === normalizeTicker(t.ticker) && a.side === t.side && a.qty === t.qty)
    return i < 0 ? [] : auto.splice(i, 1)
  })
  if (!gone.length) return
  await db.execute(`DELETE FROM trades WHERE id IN (${gone.map(() => '?').join(', ')})`, gone.map(g => g.id))
  const notes = [...new Set(gone.map(g => g.noteId))]
  await db.execute(`DELETE FROM notes WHERE id IN (${notes.map(() => '?').join(', ')}) AND NOT EXISTS (SELECT 1 FROM trades WHERE note_id = notes.id)`, notes)
}

const BROKERS_KEY = 'reparo.corretoras'
const BROKERS_VERSION = '1' // suba quando normalizeBroker mudar, para a rotina rodar de novo

/** Versões antigas gravavam por extenso as corretoras fora de CLEAR/INTER/BTG ('XP INVESTIMENTOS CCTVM S/A');
 * sem passar à chave curta, a mesma Negociação da B3 reimportada viraria outra nota. Roda uma vez por versão.
 * Se a nota com a chave curta já existe (mesmo número e data): se ela já tem todas as operações, a por extenso some;
 * com operações diferentes ficam as duas e entra em `conflicts`, para a pessoa conferir. */
export async function renormalizeBrokers(db: Db): Promise<{ conflicts: number }> {
  const [done] = await db.select<{ value: string }>('SELECT value FROM meta WHERE key = ?', [BROKERS_KEY])
  if (done?.value === BROKERS_VERSION) return { conflicts: 0 }
  let conflicts = 0
  type TradeRow = { ticker: string; side: string; qty: number; price_cents: number }
  const same = (a: TradeRow, b: TradeRow) => a.ticker === b.ticker && a.side === b.side && a.qty === b.qty && a.price_cents === b.price_cents
  const tradesOf = (id: string) => db.select<TradeRow>('SELECT ticker, side, qty, price_cents FROM trades WHERE note_id = ?', [id])
  const notes = await db.select<{ id: string; number: string; broker: string; trade_date: string }>('SELECT id, number, broker, trade_date FROM notes')
  for (const n of notes) {
    const key = normalizeBroker(n.broker)
    if (key === n.broker) continue
    const [target] = await db.select<{ id: string }>('SELECT id FROM notes WHERE broker = ? AND number = ? AND trade_date = ?', [key, n.number, n.trade_date])
    if (!target) {
      await db.execute('UPDATE notes SET broker = ?, source_key = replace(source_key, ?, ?) WHERE id = ?', [key, `:${n.broker}`, `:${key}`, n.id])
      continue
    }
    const pool = await tradesOf(target.id)
    // cada operação da por extenso precisa de uma igual (e ainda não usada) na curta
    const dup = (await tradesOf(n.id)).every(t => {
      const i = pool.findIndex(o => same(o, t))
      if (i >= 0) pool.splice(i, 1)
      return i >= 0
    })
    if (dup) await db.execute('DELETE FROM notes WHERE id = ?', [n.id])
    else conflicts++
  }
  const rows = await db.select<{ b: string }>('SELECT broker AS b FROM dividends WHERE broker IS NOT NULL UNION SELECT code FROM brokers')
  for (const { b } of rows) {
    const key = normalizeBroker(b)
    if (key === b) continue
    await db.execute('UPDATE dividends SET broker = ? WHERE broker = ?', [key, b])
    // OR IGNORE: se o cadastro do IR já existe com a chave curta, fica o que já estava
    await db.execute('UPDATE OR IGNORE brokers SET code = ? WHERE code = ?', [key, b])
  }
  await db.execute('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [BROKERS_KEY, BROKERS_VERSION])
  return { conflicts }
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
    // O mesmo provento vem tanto na Movimentação (b3:) quanto em Proventos Recebidos (b3prov:): o segundo relatório é pulado.
    const prefix = d.sourceKey?.split(':')[0]
    if (d.source === 'b3' && (await db.select("SELECT 1 FROM dividends WHERE source = 'b3' AND ticker = ? AND kind = ? AND pay_date = ? AND amount_cents = ? AND coalesce(broker, '') = ? AND source_key NOT LIKE ?", [ticker, d.kind, d.payDate, d.amountCents, d.broker ?? '', `${prefix}:%`])).length) { out.skipped++; continue }
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

export async function saveProventosMode(db: Db, mode: ProventosMode): Promise<void> {
  await db.execute("INSERT INTO meta (key, value) VALUES ('investimentos.proventos', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [mode])
}

const OPENING_LOSS_KEY = 'imposto.prejuizo_inicial'

/** Prejuízo a compensar informado à mão (anos antes do relatório da B3); null apaga. */
export async function saveOpeningLoss(db: Db, v: OpeningLoss | null): Promise<void> {
  if (!v) await db.execute('DELETE FROM meta WHERE key = ?', [OPENING_LOSS_KEY])
  else await db.execute('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [OPENING_LOSS_KEY, JSON.stringify(v)])
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
    'INSERT OR REPLACE INTO manual_assets (id, name, asset_class, currency, cost_cents, quote_symbol, quantity, value_cents, updated_at, source_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, a.name, a.assetClass, a.currency, a.costCents, a.quoteSymbol, a.quantity, a.valueCents, a.updatedAt, a.sourceKey],
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
