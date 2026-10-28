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
      const message = e instanceof Error ? e.message : 'Erro ao sincronizar'
      if (e instanceof PluggyError && e.kind === 'credenciais') badCreds = message
      result.errors.push({ itemId: item.itemId, label: item.label, message: `investimentos não lidos (${message})` })
    }
  }
  return result
}

/** Mesma operação (dia, ticker, lado, quantidade) já no Yield: nota em PDF ou à mão fica como está; a da Negociação da B3 ou da Pluggy só ganha as taxas. */
async function mergeTrades(db: Db, broker: string, trades: PluggyTrade[]) {
  let inserted = 0, updated = 0, existing = 0
  const used = new Set<string>()
  const fresh = new Map<ISODate, PluggyTrade[]>()
  for (const t of trades) {
    const cands = await db.select<{ id: string; source: string; sourceKey: string | null; feesCents: number; irrfCents: number }>(
      `SELECT t.id, n.source, n.source_key AS sourceKey, t.fees_cents AS feesCents, t.irrf_cents AS irrfCents FROM trades t JOIN notes n ON n.id = t.note_id
        WHERE n.trade_date = ? AND t.ticker = ? AND t.side = ? AND t.qty = ? ORDER BY n.source_key, t.seq, t.id`, [t.date, t.ticker, t.side, t.qty])
    const m = cands.find(c => !used.has(c.id)) // uma por uma: duas compras iguais no dia são duas operações
    if (!m) { fresh.set(t.date, [...(fresh.get(t.date) ?? []), t]); continue }
    used.add(m.id)
    const auto = m.source === 'sem_nota' && /^(b3neg|pluggy):/.test(m.sourceKey ?? '')
    if (auto && (t.feesCents > 0 || t.irrfCents > 0) && (t.feesCents !== m.feesCents || t.irrfCents !== m.irrfCents)) {
      await db.execute('UPDATE trades SET fees_cents = ?, irrf_cents = ? WHERE id = ?', [t.feesCents, t.irrfCents, m.id])
      updated++
    } else existing++
  }
  for (const [date, list] of fresh) {
    const rows = []
    for (const t of list) {
      const [known] = await db.select<{ assetType: AssetType }>('SELECT asset_type AS assetType FROM trades WHERE ticker = ? LIMIT 1', [t.ticker])
      // ETF de renda fixa a Pluggy chama só de ETF; o tipo já escolhido no Yield vale
      const assetType = t.assetType === 'ETF' && known?.assetType === 'ETF RF' ? 'ETF RF' : t.assetType ?? known?.assetType ?? assetTypeOf(t.ticker)
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
