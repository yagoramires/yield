import type { Db } from '../db/client'
import { loadGastos, replaceWindow, setLastSync, upsertAccount } from '../db/gastosRepo'
import { addTrades, saveNote } from '../db/repo'
import { withFingerprints } from '../domain/gastos'
import type { AssetType, ISODate } from '../domain/types'
import { assetTypeOf, settleDate } from '../import/b3'
import { normalizeBroker } from '../import/parse'
import { createPluggyClient, PluggyError, rendaVariavel, toTradeRow, toTxnRow } from './pluggy'

export const SYNC_EVERY_MS = 6 * 60 * 60 * 1000
/** `found`: investimentos de renda variável do item; `existing`: operações que já estavam no Yield e ficaram como estavam. */
export interface InvestmentCounts { itemId: string; label: string; found: number; inserted: number; updated: number; existing: number }
export interface SyncResult { accounts: number; inserted: number; removed: number; errors: { itemId: string; label: string; message: string }[]; investments: InvestmentCounts[] }
type PluggyTrade = NonNullable<ReturnType<typeof toTradeRow>> & { ticker: string; assetType: AssetType | null }

const addDays = (d: ISODate, n: number): ISODate => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10)

export async function syncPluggy(db: Db, creds: { clientId: string; clientSecret: string }, fetchFn: typeof fetch, today: ISODate, now: () => Date = () => new Date()): Promise<SyncResult> {
  const client = createPluggyClient(creds, fetchFn)
  const result: SyncResult = { accounts: 0, inserted: 0, removed: 0, errors: [], investments: [] }
  const items = (await loadGastos(db)).pluggyItems
  const dateTo = addDays(today, 31)
  let badCreds: string | null = null

  for (const item of items) {
    if (badCreds) { result.errors.push({ itemId: item.itemId, label: item.label, message: badCreds }); continue } // mesma credencial para todos os itens
    try {
      // Busca tudo do item antes de gravar: erro no meio não deixa o item pela metade.
      const fetched = []
      for (const pa of await client.listAccounts(item.itemId)) {
        const kind = pa.type === 'CREDIT' ? 'cartao' as const : 'conta' as const
        const externalId = `pluggy:${pa.id}`
        const stored = (await loadGastos(db)).accounts.find(a => a.externalId === externalId)
        const floor = addDays(today, -365) // a Pluggy não devolve além disso; ir mais longe apagaria linhas que não voltam
        const dateFrom = stored?.lastSyncAt ? [addDays(stored.lastSyncAt.slice(0, 10), -35), floor].sort()[1] : floor
        const txns = await client.listTransactions(pa.id, dateFrom, dateTo)
        fetched.push({ pa, kind, externalId, dateFrom, rows: txns.map(t => toTxnRow(t, kind)) })
      }
      for (const f of fetched) {
        const id = await upsertAccount(db, { source: 'pluggy', externalId: f.externalId, institution: item.label, name: f.pa.marketingName || f.pa.name, kind: f.kind, number: f.pa.number ?? null, itemId: item.itemId, lastSyncAt: null })
        const rows = withFingerprints(id, f.rows).map(r => ({ ...r, sourceKey: `pluggy:${r.fingerprint}` }))
        const { inserted, removed } = await replaceWindow(db, id, f.dateFrom, rows)
        await setLastSync(db, id, now().toISOString())
        result.accounts++; result.inserted += inserted; result.removed += removed
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Erro ao sincronizar'
      if (e instanceof PluggyError && e.kind === 'credenciais') badCreds = message
      result.errors.push({ itemId: item.itemId, label: item.label, message })
      continue
    }
    try {
      const trades: PluggyTrade[] = []
      let found = 0
      for (const inv of await client.listInvestments(item.itemId)) {
        const rv = rendaVariavel(inv)
        if (!rv) continue
        found++
        for (const t of await client.listInvestmentTransactions(inv.id)) {
          const row = toTradeRow(t)
          if (row) trades.push({ ...row, ...rv })
        }
      }
      result.investments.push({ itemId: item.itemId, label: item.label, found, ...await mergeTrades(db, normalizeBroker(item.label), trades) })
    } catch (e) {
      // as contas deste item acabaram de passar com a mesma chave: 403 aqui é falta do produto, não credencial ruim
      const message = e instanceof Error ? e.message : 'Erro ao sincronizar'
      result.errors.push({ itemId: item.itemId, label: item.label, message: `investimentos não lidos (${message})` })
    }
  }
  return result
}

/** Por (dia, ticker, lado), a quantidade que já está no Yield (qualquer nota) cobre a da Pluggy: nota em PDF ou à mão fica como está;
 * a operação única da Negociação da B3 ou da Pluggy só ganha as taxas; o que faltar entra numa operação só, a preço médio. */
async function mergeTrades(db: Db, broker: string, trades: PluggyTrade[]) {
  let inserted = 0, updated = 0, existing = 0
  const groups = new Map<string, PluggyTrade[]>()
  for (const t of trades) { const k = `${t.date}|${t.ticker}|${t.side}`; groups.set(k, [...(groups.get(k) ?? []), t]) }
  const fresh = new Map<ISODate, PluggyTrade[]>()
  const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0)
  // uma leitura só: as operações dos tickers que a Pluggy trouxe, em qualquer data
  const tickers = [...new Set(trades.map(t => t.ticker))]
  const known = tickers.length ? await db.select<{ id: string; date: ISODate; ticker: string; side: string; assetType: AssetType; source: string; sourceKey: string | null; qty: number; feesCents: number; irrfCents: number }>(
    `SELECT t.id, n.trade_date AS date, t.ticker, t.side, t.asset_type AS assetType, n.source, n.source_key AS sourceKey, t.qty, t.fees_cents AS feesCents, t.irrf_cents AS irrfCents
      FROM trades t JOIN notes n ON n.id = t.note_id WHERE t.ticker IN (${tickers.map(() => '?').join(', ')}) ORDER BY t.rowid`, tickers) : []
  const typeOf = new Map<string, AssetType>()
  for (const k of known) if (!typeOf.has(k.ticker)) typeOf.set(k.ticker, k.assetType)
  for (const list of groups.values()) {
    const t = list[0]
    const have = known.filter(k => k.date === t.date && k.ticker === t.ticker && k.side === t.side)
    const qty = sum(list, x => x.qty), haveQty = sum(have, x => x.qty)
    if (haveQty >= qty - 1e-9) {
      const m = have[0]
      const auto = have.length === 1 && list.length === 1 && m.qty === t.qty && m.source === 'sem_nota' && /^(b3neg|pluggy):/.test(m.sourceKey ?? '')
      if (auto && (t.feesCents > 0 || t.irrfCents > 0) && (t.feesCents !== m.feesCents || t.irrfCents !== m.irrfCents)) {
        await db.execute('UPDATE trades SET fees_cents = ?, irrf_cents = ? WHERE id = ?', [t.feesCents, t.irrfCents, m.id])
        updated++
      } else existing += list.length
      continue
    }
    const rest = qty - haveQty
    const share = (f: (x: PluggyTrade) => number) => Math.round(sum(list, f) * rest / qty)
    const rows = haveQty === 0 ? list
      : [{ ...t, qty: rest, priceCents: Math.round(sum(list, x => x.qty * x.priceCents) / qty), feesCents: share(x => x.feesCents), irrfCents: share(x => x.irrfCents) }]
    fresh.set(t.date, [...(fresh.get(t.date) ?? []), ...rows])
  }
  for (const [date, list] of fresh) {
    const rows = []
    for (const t of list) {
      // ETF de renda fixa a Pluggy chama só de ETF; o tipo já escolhido no Yield vale
      const assetType = t.assetType === 'ETF' && typeOf.get(t.ticker) === 'ETF RF' ? 'ETF RF' : t.assetType ?? typeOf.get(t.ticker) ?? assetTypeOf(t.ticker)
      rows.push({ side: t.side, assetType, ticker: t.ticker, qty: t.qty, priceCents: t.priceCents, feesCents: t.feesCents, irrfCents: t.irrfCents })
    }
    const sourceKey = `pluggy:${date}:${broker}`
    const [note] = await db.select<{ id: string; seq: number | null }>('SELECT n.id, max(t.seq) AS seq FROM notes n LEFT JOIN trades t ON t.note_id = n.id WHERE n.source_key = ? GROUP BY n.id', [sourceKey])
    if (note) await addTrades(db, note.id, rows.map((r, i) => ({ ...r, seq: (note.seq ?? 0) + i + 1 })))
    else await saveNote(db, { number: `Pluggy ${date}`, broker, tradeDate: date, settleDate: settleDate(date), source: 'sem_nota', sourceKey, label: 'Pluggy (sem nota)' }, rows.map((r, i) => ({ ...r, seq: i + 1 })))
    inserted += list.length
  }
  return { inserted, updated, existing }
}
