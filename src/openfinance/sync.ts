import type { Db } from '../db/client'
import { loadGastos, replaceWindow, setLastSync, upsertAccount } from '../db/gastosRepo'
import { withFingerprints } from '../domain/gastos'
import type { ISODate } from '../domain/types'
import { createPluggyClient, PluggyError, toTxnRow } from './pluggy'

export const SYNC_EVERY_MS = 6 * 60 * 60 * 1000
export interface SyncResult { accounts: number; inserted: number; removed: number; errors: { itemId: string; label: string; message: string }[] }

const addDays = (d: ISODate, n: number): ISODate => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10)

export async function syncPluggy(db: Db, creds: { clientId: string; clientSecret: string }, fetchFn: typeof fetch, today: ISODate, now: () => Date = () => new Date()): Promise<SyncResult> {
  const client = createPluggyClient(creds, fetchFn)
  const result: SyncResult = { accounts: 0, inserted: 0, removed: 0, errors: [] }
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
    }
  }
  return result
}
